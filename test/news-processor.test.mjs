import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";
import { createNewsProcessor } from "../src/modules/news/news-processor.mjs";
import { NEWS_ANALYSIS_POLICY_VERSION } from "../src/modules/news/news-auto-publish-policy.mjs";

async function fixture(source, analyze, callback, {
  codexReviewer = null,
  sourceProfiles = new Map(),
  officialDocumentEnricher = async (record) => record,
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-processor-"));
  const runnerPath = path.join(root, "runner.ps1");
  const pythonExecutablePath = path.join(root, "free-python.exe");
  const keyStorePath = path.join(root, "openai-api-key.dpapi");
  await writeFile(runnerPath, "test", "utf8");
  const store = createPendingNewsStore({ root });
  const id = "f".repeat(32);
  await store.create({ id, source, original: { content: "news", embeds: [] }, workflow: { status: "pending_translation", dcPublication: null } });
  try {
    const processor = createNewsProcessor({
      stateRoot: root,
      runnerPath,
      pythonExecutablePath,
      keyStorePath,
      analyze,
      codexReviewer,
      officialDocumentEnricher,
      sourceProfiles,
      now: () => new Date("2026-08-01T04:00:00Z"),
    });
    await callback({ processor, store, id, pythonExecutablePath, keyStorePath });
  } finally { await rm(root, { recursive: true, force: true }); }
}

const result = (decision) => ({
  readerSummary: "복잡한 변경 내용을 일반 독자가 이해하기 쉽게 정리합니다.",
  translation: { title: "번역 제목", body: "번역 본문" },
  contextTranslations: [],
  triage: { decision, confidence: 0.9, importance: "medium", evidenceTag: "inference", boardCategory: "news", reason: "판정 이유", advice: "[유추] 게시 권장", signals: [] },
});

test("뉴스 분석기에 추적 실행기와 외부 Python·키 저장소 경계를 함께 전달한다", async () => {
  let received;
  await fixture(
    { type: "x-post" },
    async (_record, options) => {
      received = options;
      return result("review");
    },
    async ({ processor, pythonExecutablePath, keyStorePath }) => {
      await processor.process("f".repeat(32));
      assert.equal(received.pythonExecutablePath, pythonExecutablePath);
      assert.equal(received.keyStorePath, keyStorePath);
      assert.match(received.runnerPath, /runner\.ps1$/u);
    },
  );
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

test("원문 경계를 통과한 무료 번역은 자동 검증 영수증으로 저장한다", async () => {
  await fixture({ type: "x-post" }, async () => ({
    ...result("publish"),
    triage: { ...result("publish").triage, evidenceTag: "use_case" },
  }), async ({ processor, store, id }) => {
    await processor.process(id);
    const saved = await store.read(id);
    assert.equal(saved.workflow.translationReview.status, "local_verified");
    assert.equal(saved.workflow.translationReview.reviewer, "local-source-boundary-v3");
    assert.equal(saved.workflow.readerSummary, "복잡한 변경 내용을 일반 독자가 이해하기 쉽게 정리합니다.");
    assert.match(saved.workflow.translationReview.reason, /원문·관련 글 분리/u);
  });
});

test("OpenAI 공식 GitHub 릴리스도 번역 후 반드시 게시 검토로 보낸다", async () => {
  await fixture({ type: "official-github-release", repository: "openai/codex" }, async () => result("skip"), async ({ processor, store, id }) => {
    await processor.process(id);
    const saved = await store.read(id);
    assert.equal(saved.workflow.status, "pending_review");
    assert.equal(saved.workflow.triage.decision, "publish");
    assert.equal(saved.workflow.triage.evidenceTag, "official");
  });
});

test("OpenAI 공식 Announcement는 번역 후 반드시 게시 검토로 보낸다", async () => {
  await fixture({ type: "discord-announcement" }, async () => result("skip"), async ({ processor, store, id }) => {
    await processor.process(id);
    const saved = await store.read(id);
    assert.equal(saved.workflow.status, "pending_review");
    assert.equal(saved.workflow.triage.decision, "publish");
    assert.equal(saved.workflow.triage.evidenceTag, "official");
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
    if (calls === 1) throw Object.assign(
      new Error("무료 API 요청에 실패했습니다."),
      { providerReason: "rate_limit" },
    );
    return result("review");
  }, async ({ processor, store, id }) => {
    await processor.process(id);
    assert.equal((await store.read(id)).workflow.analysisFailure.code, "provider_error");
    assert.equal((await store.read(id)).workflow.analysisFailure.providerReason, "rate_limit");
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
          translationAudit: {
            status: "corrected",
            title: "원문 전용 제목",
            body: "원문에 있는 내용만 번역했습니다.",
            reason: "무료 번역이 부모 문맥을 섞었다.",
          },
          contextTranslationAudits: [],
          decision: "publish",
          confidence: 0.88,
          importance: "medium",
          evidenceTag: "inference",
          boardCategory: "news",
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
    assert.equal(saved.workflow.triage.evidenceTag, "inference");
    assert.equal(saved.workflow.codexReview.status, "complete");
    assert.equal(saved.workflow.translation.body, "원문에 있는 내용만 번역했습니다.");
    assert.equal(saved.workflow.translationReview.status, "codex_corrected");
    assert.deepEqual(saved.workflow.contextTranslations, []);
  }, { codexReviewer });
});

test("판정 모델에는 등록된 출처 역할과 추적 이유를 함께 전달한다", async () => {
  const profile = {
    displayName: "Greg Brockman",
    affiliation: "OpenAI",
    roles: ["사장·공동 창립자"],
    topics: ["모델"],
    trustLabel: "핵심 인물",
    whyTracked: "OpenAI 방향을 직접 언급할 수 있는 핵심 인물이에요.",
  };
  await fixture(
    { type: "x-post", account: "gdb" },
    async (record) => {
      assert.equal(record.source.profile.roles[0], "사장·공동 창립자");
      assert.equal(record.source.profile.trustLabel, "핵심 인물");
      return result("publish");
    },
    async ({ processor, store, id }) => {
      await processor.process(id);
      assert.equal((await store.read(id)).workflow.status, "pending_review");
    },
    { sourceProfiles: new Map([["gdb", profile]]) },
  );
});

test("승인 전 기존 뉴스는 분석 세대를 올려 새 정책으로 다시 판정한다", async () => {
  let calls = 0;
  await fixture({ type: "x-post" }, async () => {
    calls += 1;
    return result(calls === 1 ? "review" : "publish");
  }, async ({ processor, store, id }) => {
    await processor.process(id);
    await store.update(id, (record) => ({
      ...record,
      workflow: {
        ...record.workflow,
        triage: { ...record.workflow.triage, evidenceTag: null },
        analysisPolicyVersion: null,
      },
    }));
    const reprocessed = await processor.reprocess(id);
    assert.equal(calls, 2);
    assert.equal(reprocessed.workflow.status, "pending_review");
    assert.equal(reprocessed.workflow.triage.decision, "publish");
    assert.equal(reprocessed.workflow.analysisRevision, 2);
    assert.equal(reprocessed.workflow.analysisPolicyVersion, NEWS_ANALYSIS_POLICY_VERSION);
    assert.equal(typeof reprocessed.workflow.reanalysisRequestedAt, "string");
    await store.update(id, (record) => ({
      ...record,
      workflow: { ...record.workflow, dcApproval: { status: "approved" } },
    }));
    await assert.rejects(() => processor.reprocess(id), /승인·게시 전/);
  });
});

test("분석 전에 공식 문서 보강 결과를 저장하고 번역기에 함께 전달한다", async () => {
  let analyzedContext;
  await fixture(
    { type: "discord-announcement" },
    async (record) => {
      analyzedContext = record.original.contexts[0];
      return { ...result("publish"), contextTranslations: [{ index: 1, body: "공식 문서 주요 내용" }] };
    },
    async ({ processor, store, id }) => {
      await processor.process(id);
      const saved = await store.read(id);
      assert.equal(analyzedContext.relation, "official-document");
      assert.equal(saved.original.contexts[0].content, "Official document body");
      assert.equal(saved.workflow.contextTranslations[0].body, "공식 문서 주요 내용");
    },
    {
      officialDocumentEnricher: async (record) => ({
        ...record,
        original: {
          ...record.original,
          contexts: [{
            relation: "official-document",
            account: "OpenAI",
            label: "OpenAI 공식 문서",
            content: "Official document body",
            url: "https://openai.com/index/example",
          }],
        },
      }),
    },
  );
});
