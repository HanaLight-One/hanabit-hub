import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenAIStatusMonitor, OPENAI_STATUS_SUMMARY_URL } from "../src/modules/news/openai-status-monitor.mjs";

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

function responder(snapshots) {
  let index = 0;
  return async (url) => {
    assert.equal(url, OPENAI_STATUS_SUMMARY_URL);
    const value = snapshots[Math.min(index++, snapshots.length - 1)];
    return { ok: true, async json() { return { incidents: value }; } };
  };
}

test("첫 실행은 진행 중 장애를 기준선으로만 저장한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-status-"));
  const monitor = createOpenAIStatusMonitor({ stateRoot: root, fetchImpl: responder([[incident()]]) });
  assert.deepEqual(await monitor.poll(), { status: "baselined", activeCount: 1 });
  const state = JSON.parse(await readFile(path.join(root, "openai-status-monitor.json"), "utf8"));
  assert.equal(state.currentPost, null);
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
  assert.deepEqual(await monitor.poll(), { status: "observed", activeCount: 0 });
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
