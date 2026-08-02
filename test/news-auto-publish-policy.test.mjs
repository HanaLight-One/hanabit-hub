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
        confidence: 0.9,
        importance: "medium",
        ...overrides,
      },
    },
  };
}

test("공식과 핵심 인물의 고신뢰 유추는 자동 게시 가능 판정만 만든다", () => {
  assert.equal(evaluateNewsAutoPublish(record("official")).decision, "eligible");
  const inferred = evaluateNewsAutoPublish(record("inference"), profile);
  assert.equal(inferred.decision, "eligible");
  assert.equal(inferred.code, "trusted_inference");
  const useCase = evaluateNewsAutoPublish(record("use_case"), profile);
  assert.equal(useCase.decision, "eligible");
  assert.equal(useCase.code, "trusted_use_case");
});

test("루머·의견·낮은 신뢰 유추는 사람 확인으로 남긴다", () => {
  assert.equal(evaluateNewsAutoPublish(record("rumor"), profile).decision, "human_review");
  assert.equal(evaluateNewsAutoPublish(record("opinion"), profile).decision, "human_review");
  assert.equal(evaluateNewsAutoPublish(record("inference", { confidence: 0.81 }), profile).decision, "human_review");
});

test("기존 승인·게시 영수증이 있으면 자동 처리하지 않는다", () => {
  const approved = record("official");
  approved.workflow.dcApproval = { status: "approved" };
  assert.equal(evaluateNewsAutoPublish(approved, profile).decision, "blocked");
});

test("원문 귀속이 검증되지 않은 번역은 자동 게시하지 않는다", () => {
  const unverified = record("official");
  unverified.workflow.translationReview = { status: "free_unverified" };
  const result = evaluateNewsAutoPublish(unverified, profile);
  assert.equal(result.decision, "human_review");
  assert.equal(result.code, "translation_unverified");
});

test("로컬 원문 경계 검증은 확정·사례만 통과시키고 유추는 심층검토로 보낸다", () => {
  const useCase = record("use_case");
  useCase.workflow.translationReview = { status: "local_verified" };
  assert.equal(evaluateNewsAutoPublish(useCase, profile).decision, "eligible");

  const inferred = record("inference");
  inferred.workflow.translationReview = { status: "local_verified" };
  const result = evaluateNewsAutoPublish(inferred, profile);
  assert.equal(result.decision, "human_review");
  assert.equal(result.code, "inference_deep_review");
});
