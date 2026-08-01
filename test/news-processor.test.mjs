import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";
import { createNewsProcessor } from "../src/modules/news/news-processor.mjs";

async function fixture(source, analyze, callback, { codexReviewer = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-processor-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "test", "utf8");
  const store = createPendingNewsStore({ root });
  const id = "f".repeat(32);
  await store.create({ id, source, original: { content: "news", embeds: [] }, workflow: { status: "pending_translation", dcPublication: null } });
  try {
    const processor = createNewsProcessor({ stateRoot: root, runnerPath, analyze, codexReviewer, now: () => new Date("2026-08-01T04:00:00Z") });
    await callback({ processor, store, id });
  } finally { await rm(root, { recursive: true, force: true }); }
}

const result = (decision) => ({
  translation: { title: "번역 제목", body: "번역 본문" },
  triage: { decision, confidence: 0.9, importance: "medium", reason: "판정 이유", advice: "사람 검토 권장", signals: [] },
});

test("X 판정 결과를 게시 검토 또는 보류 상태로 결정적으로 저장한다", async () => {
  await fixture({ type: "x-post" }, async () => result("review"), async ({ processor, store, id }) => {
    await processor.process(id);
    assert.equal((await store.read(id)).workflow.status, "pending_review");
  });
  await fixture({ type: "x-post" }, async () => result("skip"), async ({ processor, store, id }) => {
    await processor.process(id);
    assert.equal((await store.read(id)).workflow.status, "ignored");
  });
});

test("OpenAI 공식 Announcement는 번역 후 반드시 게시 검토로 보낸다", async () => {
  await fixture({ type: "discord-announcement" }, async () => result("skip"), async ({ processor, store, id }) => {
    await processor.process(id);
    const saved = await store.read(id);
    assert.equal(saved.workflow.status, "pending_review");
    assert.equal(saved.workflow.triage.decision, "publish");
  });
});

test("무료 API 실패는 원문을 보존하고 자동 재시도하지 않는다", async () => {
  let calls = 0;
  await fixture({ type: "x-post" }, async () => { calls += 1; throw new Error("secret external error"); }, async ({ processor, store, id }) => {
    await processor.process(id);
    await processor.process(id);
    const saved = await store.read(id);
    assert.equal(calls, 1);
    assert.equal(saved.workflow.status, "translation_failed");
    assert.equal(saved.workflow.analysisFailure.code, "unknown");
    assert.equal(JSON.stringify(saved).includes("secret external error"), false);
  });
});

test("번역 실패 항목은 사람 요청으로만 한 번 다시 분석한다", async () => {
  let calls = 0;
  await fixture({ type: "x-post" }, async () => {
    calls += 1;
    if (calls === 1) throw new Error("무료 API 요청에 실패했습니다.");
    return result("review");
  }, async ({ processor, store, id }) => {
    await processor.process(id);
    assert.equal((await store.read(id)).workflow.analysisFailure.code, "provider_error");
    const retried = await processor.retry(id);
    assert.equal(retried.workflow.status, "pending_review");
    assert.equal(retried.workflow.analysisFailure, null);
    await assert.rejects(() => processor.retry(id), /번역 실패한 뉴스만/);
  });
});

test("애매한 무료 판정은 Codex 검토 결과를 최종 판정으로 보존한다", async () => {
  const codexReviewer = {
    async review() {
      return {
        status: "complete",
        reviewedAt: "2026-08-01T04:00:00.000Z",
        result: {
          decision: "publish",
          confidence: 0.88,
          importance: "medium",
          reason: "부모 글과 결합하면 제품 활용 범위 확장을 시사한다.",
          advice: "사람이 이미지를 확인한 뒤 게시 후보로 검토하세요.",
        },
      };
    },
  };
  await fixture({ type: "x-post" }, async () => result("review"), async ({ processor, store, id }) => {
    await processor.process(id);
    const saved = await store.read(id);
    assert.equal(saved.workflow.status, "pending_review");
    assert.equal(saved.workflow.freeTriage.decision, "review");
    assert.equal(saved.workflow.triage.decision, "publish");
    assert.equal(saved.workflow.codexReview.status, "complete");
  }, { codexReviewer });
});
