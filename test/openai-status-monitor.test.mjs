import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createOpenAIStatusMonitor,
  normalizeOpenAIStatusSummary,
  OPENAI_STATUS_SUMMARY_URL,
} from "../src/modules/news/openai-status-monitor.mjs";

function incident({ id = "incident-1", update = "update-1", status = "investigating" } = {}) {
  return {
    id,
    name: "Elevated ChatGPT errors",
    status,
    impact: "minor",
    created_at: "2026-08-04T12:43:44Z",
    updated_at: status === "monitoring" ? "2026-08-04T12:57:49Z" : "2026-08-04T12:43:44Z",
    incident_updates: [{
      id: update,
      status,
      body: status === "monitoring" ? "Mitigation applied." : "We are investigating.",
      created_at: status === "monitoring" ? "2026-08-04T12:57:49Z" : "2026-08-04T12:43:44Z",
    }],
  };
}

function component({ id = "component-1", name = "Codex CLI", status = "operational" } = {}) {
  return {
    id,
    name,
    status,
    updated_at: status === "operational" ? "2026-08-04T12:40:00Z" : "2026-08-04T13:00:00Z",
  };
}

function responder(snapshots) {
  let index = 0;
  return async (url, options) => {
    const parsed = new URL(url);
    assert.equal(`${parsed.origin}${parsed.pathname}`, OPENAI_STATUS_SUMMARY_URL);
    assert.match(parsed.searchParams.get("hanabit"), /^\d+$/u);
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["cache-control"], "no-cache");
    const value = snapshots[Math.min(index++, snapshots.length - 1)];
    const snapshot = Array.isArray(value) ? { incidents: value, components: [] } : value;
    return { ok: true, async json() { return snapshot; } };
  };
}

test("첫 실행은 진행 중 장애를 기준선으로만 저장한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const monitor = createOpenAIStatusMonitor({ stateRoot: root, fetchImpl: responder([[incident()]]) });
  assert.equal((await monitor.poll()).status, "baselined");
  const state = JSON.parse(await readFile(path.join(root, "openai-status-monitor.json"), "utf8"));
  assert.equal(state.currentPost, null);
});

test("상태 API 요청마다 CDN 캐시를 우회한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const urls = [];
  const times = [new Date("2026-08-05T00:00:00Z"), new Date("2026-08-05T00:00:20Z")];
  const monitor = createOpenAIStatusMonitor({
    stateRoot: root,
    now: () => times.shift(),
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(options.cache, "no-store");
      return { ok: true, async json() { return { incidents: [], components: [] }; } };
    },
  });
  await monitor.poll();
  await monitor.poll();
  assert.notEqual(urls[0], urls[1]);
  assert.equal(new URL(urls[0]).searchParams.get("hanabit"), "1785888000000");
  assert.equal(new URL(urls[1]).searchParams.get("hanabit"), "1785888020000");
});

test("정상화 응답에서 생략된 incidents는 활성 장애 0건으로 해석한다", () => {
  const snapshot = normalizeOpenAIStatusSummary({
    status: { indicator: "none" },
    components: [component()],
  });
  assert.equal(snapshot.incidents.length, 0);
  assert.equal(snapshot.degradedComponents.length, 0);
});

test("새 공식 업데이트를 한 번만 뉴스 후보로 만든다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const fetchImpl = responder([[incident()], [incident({ update: "update-2", status: "monitoring" })]]);
  const monitor = createOpenAIStatusMonitor({ stateRoot: root, fetchImpl });
  await monitor.poll();
  const created = await monitor.poll();
  assert.equal(created.status, "created");
  assert.equal(created.phase, "updated");
  assert.equal((await monitor.poll()).status, "unchanged");
});

test("자동 게시 영수증이 있는 장애가 사라지면 복구완료 후보를 만든다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const fetchImpl = responder([[], [incident()], []]);
  const monitor = createOpenAIStatusMonitor({ stateRoot: root, fetchImpl });
  await monitor.poll();
  const outage = await monitor.poll();
  await monitor.confirmPublished(outage.snapshotHash, { postId: "120600", url: "https://gall.dcinside.com/example" });
  const recovered = await monitor.poll();
  assert.equal(recovered.status, "created");
  assert.equal(recovered.phase, "recovered");
});

test("수동 기준선 장애가 바로 끝나도 복구 글을 만들지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const monitor = createOpenAIStatusMonitor({ stateRoot: root, fetchImpl: responder([[incident()], []]) });
  await monitor.poll();
  assert.equal((await monitor.poll()).status, "observed");
});

test("보호된 수동 장애 글은 삭제 대상이 아니면서 복구완료 기준선이 된다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const monitor = createOpenAIStatusMonitor({ stateRoot: root, fetchImpl: responder([[incident()], []]) });
  await monitor.poll();
  const adopted = await monitor.adoptProtectedPost({
    postId: "120497",
    url: "https://m.dcinside.com/board/chatgpt/120497",
  });
  assert.equal(adopted.status, "adopted");
  assert.equal(adopted.currentPost.ownership, "manual-protected");
  const recovered = await monitor.poll();
  assert.equal(recovered.status, "created");
  assert.equal(recovered.phase, "recovered");
});

test("사용자가 지정한 보호 글만 다음 상태 글의 교체 대상으로 전환한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const monitor = createOpenAIStatusMonitor({
    stateRoot: root,
    fetchImpl: responder([[incident()], [incident({ update: "update-2", status: "monitoring" })]]),
  });
  await monitor.poll();
  await monitor.adoptProtectedPost({
    postId: "120497",
    url: "https://m.dcinside.com/board/chatgpt/120497",
  });
  const authorized = await monitor.authorizeAdoptedPostReplacement("120497");
  assert.equal(authorized.status, "authorized");
  assert.equal(authorized.currentPost.ownership, "adopted-replaceable");
  await assert.rejects(() => monitor.authorizeAdoptedPostReplacement("120498"), /일치하지 않습니다/u);
  const update = await monitor.poll();
  const confirmed = await monitor.confirmPublished(update.snapshotHash, {
    postId: "120700",
    url: "https://gall.dcinside.com/example",
  });
  assert.equal(confirmed.previousPost.postId, "120497");
  assert.equal((await monitor.readState()).pendingReplacement.postId, "120497");
});

test("ChatGPT 장애 중 Codex 구성요소가 나빠지면 장애확대 후보를 만든다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const chat = component({ id: "chat", name: "Conversations", status: "degraded_performance" });
  const codex = component({ id: "codex-cli", name: "Codex CLI", status: "partial_outage" });
  const monitor = createOpenAIStatusMonitor({
    stateRoot: root,
    fetchImpl: responder([
      { incidents: [incident()], components: [chat] },
      { incidents: [incident()], components: [chat, codex] },
    ]),
  });
  await monitor.poll();
  const expanded = await monitor.poll();
  assert.equal(expanded.status, "created");
  assert.equal(expanded.phase, "expanded");
  assert.equal(expanded.incidentCount, 1);
  assert.equal(expanded.componentCount, 2);
  const record = JSON.parse(await readFile(path.join(root, "pending", expanded.id, "item.json"), "utf8"));
  assert.match(record.original.content, /Conversations: degraded_performance/u);
  assert.match(record.original.content, /Codex CLI: partial_outage/u);
});

test("사건 등록 전 구성요소 노란불만 생겨도 장애발생 후보를 만든다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const monitor = createOpenAIStatusMonitor({
    stateRoot: root,
    fetchImpl: responder([
      { incidents: [], components: [component()] },
      { incidents: [], components: [component({ status: "degraded_performance" })] },
    ]),
  });
  await monitor.poll();
  const outage = await monitor.poll();
  assert.equal(outage.status, "created");
  assert.equal(outage.phase, "outage");
  assert.equal(outage.componentCount, 1);
});

test("여러 장애 신호 중 구성요소 하나가 정상화되면 부분복구 후보를 만든다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const chat = component({ id: "chat", name: "Conversations", status: "degraded_performance" });
  const codex = component({ id: "codex", name: "Codex Web", status: "major_outage" });
  const monitor = createOpenAIStatusMonitor({
    stateRoot: root,
    fetchImpl: responder([
      { incidents: [incident()], components: [chat, codex] },
      { incidents: [incident()], components: [chat, component({ id: "codex", name: "Codex Web" })] },
    ]),
  });
  await monitor.poll();
  const partial = await monitor.poll();
  assert.equal(partial.status, "created");
  assert.equal(partial.phase, "partial-recovery");
  assert.equal(partial.componentCount, 1);
});

test("기존 v1 영수증은 현재 구성요소를 조용히 기준선으로 이식한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  await writeFile(path.join(root, "openai-status-monitor.json"), JSON.stringify({
    schemaVersion: 1,
    initializedAt: "2026-08-04T12:00:00.000Z",
    lastCheckedAt: "2026-08-04T12:00:00.000Z",
    lastSnapshotHash: "legacy",
    activeIncidents: [],
    currentPost: { postId: "120497", ownership: "adopted-replaceable" },
    pendingSnapshot: null,
    history: [],
  }), "utf8");
  const monitor = createOpenAIStatusMonitor({
    stateRoot: root,
    fetchImpl: responder([{
      incidents: [incident()],
      components: [component({ id: "chat", name: "Conversations", status: "degraded_performance" })],
    }]),
  });
  const migrated = await monitor.poll();
  assert.equal(migrated.status, "components-baselined");
  const state = await monitor.readState();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.currentPost.postId, "120497");
  assert.equal(state.degradedComponents.length, 1);
});
