import assert from "node:assert/strict";
import test from "node:test";
import { auditFreeNewsTranslation } from "../src/modules/news/news-translation-audit.mjs";

function record({ source = "ChatGPT for empowering your dad to build:", context = null } = {}) {
  return {
    original: {
      content: source,
      embeds: [],
      contexts: context ? [{ content: context }] : [],
    },
  };
}

test("원문과 관련 글을 분리한 무료 번역은 로컬 경계 감사를 통과한다", () => {
  const audit = auditFreeNewsTranslation(
    record({ context: "My dad used ChatGPT to build a webpage." }),
    {
      translation: {
        title: "아빠가 직접 무언가를 만들 수 있게 해주는 ChatGPT",
        body: "ChatGPT로 아빠가 직접 무언가를 만들 수 있게 해주기:",
      },
      contextTranslations: [{ index: 1, body: "아빠가 ChatGPT를 사용해 웹페이지를 만들었습니다." }],
    },
  );
  assert.equal(audit.status, "passed");
  assert.equal(audit.code, "local_source_boundary");
});

test("관련 글 번역을 원문 번역에 그대로 섞으면 자동 검증하지 않는다", () => {
  const contextBody = "ChatGPT Work는 새로운 크론 작업입니다.";
  const audit = auditFreeNewsTranslation(
    record({ source: "Use ChatGPT for recurring tasks.", context: "ChatGPT Work is the new cron job." }),
    {
      translation: { title: "반복 작업", body: contextBody },
      contextTranslations: [{ index: 1, body: contextBody }],
    },
  );
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "context_mixed_into_source");
});

test("원문에 없는 제품명이나 수치를 번역에 추가하면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({ source: "A new model is available." }), {
    translation: { title: "GPT-6 공개", body: "GPT-6 모델이 공개되었습니다." },
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "source_invariant_added");
});

test("원문에 없는 문자 체계가 번역에 섞이면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({ source: "Jump to blog post" }), {
    translation: { title: "블로그 글", body: "블로그 पोस्ट로 이동" },
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "unexpected_script");
});
