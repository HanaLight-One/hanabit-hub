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
