import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNewsAutoPublish } from "../src/modules/news/news-auto-publish-policy.mjs";

const profile = {
  trustLevel: "high",
  affiliationConfirmed: true,
};

function record(evidenceTag, overrides = {}) {
  return {
    workflow: {
      status: "pending_review",
      translationReview: { status: "codex_verified" },
      analysisNotice: "주의: 아래 해설은 AI가 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다.",
      triage: {
        decision: "publish",
        evidenceTag,
        boardCategory: "news",
        confidence: 0.9,
        importance: "medium",
        ...overrides,
      },
    },
  };
}

test("공식과 핵심 인물의 고신뢰 유추 및 중요 사례는 자동 게시 가능 판정만 만든다", () => {
  assert.equal(evaluateNewsAutoPublish(record("official")).decision, "eligible");
  const inferred = evaluateNewsAutoPublish(record("inference"), profile);
  assert.equal(inferred.decision, "eligible");
  assert.equal(inferred.code, "trusted_inference");
  const useCase = evaluateNewsAutoPublish(record("use_case", { importance: "high", confidence: 0.9 }), profile);
  assert.equal(useCase.decision, "eligible");
  assert.equal(useCase.code, "trusted_use_case");
});

test("ChatGPT 학습 문서도 한국어 문맥 번역 없이는 자동 게시하지 않는다", () => {
  const item = record("official");
  item.original = {
    links: ["https://learn.chatgpt.com/docs/security/security-review"],
    contexts: [],
  };
  const missing = evaluateNewsAutoPublish(item, profile);
  assert.equal(missing.decision, "human_review");
  assert.equal(missing.code, "official_document_untranslated");
});

test("가치 있는 루머·의견은 허용하고 잡담·낮은 중요도는 제외한다", () => {
  assert.equal(evaluateNewsAutoPublish(record("rumor", { importance: "high" }), profile).decision, "eligible");
  assert.equal(evaluateNewsAutoPublish(record("opinion", { importance: "high" }), profile).decision, "eligible");
  assert.equal(evaluateNewsAutoPublish(record("rumor"), profile).decision, "blocked");
  assert.equal(evaluateNewsAutoPublish(record("use_case", { boardCategory: "chatter" }), profile).decision, "blocked");
  assert.equal(evaluateNewsAutoPublish(record("confirmed", { importance: "low" }), profile).decision, "blocked");
  assert.equal(evaluateNewsAutoPublish(record("inference", { confidence: 0.81 }), profile).decision, "human_review");
  const routineUseCase = evaluateNewsAutoPublish(record("use_case"), profile);
  assert.equal(routineUseCase.decision, "blocked");
  assert.equal(routineUseCase.code, "routine_use_case");
});

test("기존 승인·게시 영수증이 있으면 자동 처리하지 않는다", () => {
  const approved = record("official");
  approved.workflow.dcApproval = { status: "approved" };
  assert.equal(evaluateNewsAutoPublish(approved, profile).decision, "blocked");
});

test("관찰 후보의 초기 신호는 자동 게시하지 않는다", () => {
  const candidate = { trustLevel: "candidate", affiliationConfirmed: true };
  assert.equal(evaluateNewsAutoPublish(record("confirmed"), candidate).decision, "human_review");
  assert.equal(evaluateNewsAutoPublish(record("inference"), candidate).decision, "human_review");
  assert.equal(evaluateNewsAutoPublish(
    record("rumor", { importance: "high" }),
    candidate,
  ).decision, "blocked");
});

test("원문 귀속이 검증되지 않은 번역은 자동 게시하지 않는다", () => {
  const unverified = record("official");
  unverified.workflow.translationReview = { status: "free_unverified" };
  const result = evaluateNewsAutoPublish(unverified, profile);
  assert.equal(result.decision, "human_review");
  assert.equal(result.code, "translation_unverified");
});

test("로컬 원문 경계 검증은 확정·사례만 통과시키고 유추는 심층검토로 보낸다", () => {
  const useCase = record("use_case", { importance: "high", confidence: 0.9 });
  useCase.workflow.translationReview = { status: "local_verified" };
  assert.equal(evaluateNewsAutoPublish(useCase, profile).decision, "eligible");

  const inferred = record("inference");
  inferred.workflow.translationReview = { status: "local_verified" };
  const result = evaluateNewsAutoPublish(inferred, profile);
  assert.equal(result.decision, "human_review");
  assert.equal(result.code, "inference_deep_review");
});

test("연결된 OpenAI 공식 문서의 수집·번역이 없으면 자동 게시하지 않는다", () => {
  const item = record("official");
  item.original = {
    links: ["https://openai.com/index/security-update/"],
    contexts: [],
  };
  const missing = evaluateNewsAutoPublish(item, profile);
  assert.equal(missing.decision, "human_review");
  assert.equal(missing.code, "official_document_untranslated");

  item.original.contexts = [{
    relation: "official-document",
    url: "https://openai.com/index/security-update/",
    content: "Full official document",
  }];
  item.workflow.contextTranslations = [{ index: 1, body: "공식 문서 핵심 내용" }];
  assert.equal(evaluateNewsAutoPublish(item, profile).decision, "eligible");
});

test("신뢰 인물이 연결한 공식 활용 사례는 중간 중요도도 후보가 된다", () => {
  const item = record("use_case", { importance: "medium", confidence: 0.9 });
  item.original = {
    contexts: [{ relation: "linked-post", account: "ChatGPT", content: "Built with Codex" }],
  };
  const result = evaluateNewsAutoPublish(item, profile);
  assert.equal(result.decision, "eligible");
  assert.equal(result.code, "trusted_use_case");
});

test("인물 합류 공지는 공개 이력과 독자 설명이 있어야 자동 게시한다", () => {
  const item = record("official");
  item.original = {
    content: "Very excited to welcome @somebody to the Codex team",
    contexts: [],
  };
  const missing = evaluateNewsAutoPublish(item, profile);
  assert.equal(missing.decision, "human_review");
  assert.equal(missing.code, "person_context_missing");

  item.original.contexts = [{
    relation: "public-background",
    account: "somebody",
    content: "Public career facts",
  }];
  item.workflow.contextTranslations = [{ index: 1, body: "공개된 주요 경력" }];
  item.workflow.readerSummary = "이 인물의 주요 경력과 새 팀에서의 의미를 설명합니다.";
  assert.equal(evaluateNewsAutoPublish(item, profile).decision, "eligible");
});
