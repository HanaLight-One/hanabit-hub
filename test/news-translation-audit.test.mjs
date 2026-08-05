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

test("이모지 원문의 제목은 관련 글 근거를 요약해도 본문 경계를 통과한다", () => {
  const audit = auditFreeNewsTranslation(
    record({ source: "🚀", context: "ChatGPT Chat is starting to behave more like Work." }),
    {
      translation: { title: "ChatGPT의 Chat이 Work처럼 변해간다는 관측", body: "로켓" },
      contextTranslations: [{ index: 1, body: "ChatGPT의 Chat이 점점 Work처럼 행동하기 시작합니다." }],
    },
  );
  assert.equal(audit.status, "passed");
  assert.equal(audit.code, "local_source_boundary");
});

test("관련 글에도 없는 제품명을 제목에 추가하면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(
    record({ source: "🚀", context: "Chat is changing." }),
    {
      translation: { title: "GPT-7의 Chat 변화", body: "로켓" },
      contextTranslations: [{ index: 1, body: "Chat이 변하고 있습니다." }],
    },
  );
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "title_invariant_added");
});

test("원문에 없는 제품명이나 수치를 번역에 추가하면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({ source: "A new model is available." }), {
    translation: { title: "GPT-6 공개", body: "GPT-6 모델이 공개되었습니다." },
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "source_invariant_added");
});

test("제목만 한국어이고 본문이 영문이면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({
    source: "Builders are finding new ways to build out loud with Voice in Codex.",
  }), {
    translation: {
      title: "Codex 음성으로 아이디어를 말하며 빌드",
      body: "Builders are finding new ways to build out loud with Voice in Codex.",
    },
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "body_korean_missing");
});

test("한국어가 조금 섞여도 본문 대부분이 영문이면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({
    source: "Builders can talk through an idea, start a new session, and check other threads along the way.",
  }), {
    translation: {
      title: "음성 작업 흐름 소개",
      body: "새 기능: Builders can talk through an idea, start a new session, and check other threads along the way.",
    },
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "body_english_dominant");
});

test("원문 영문 복수형의 단수형은 새 식별자로 오인하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({
    source: "Normalize strict object schemas and apply policies.",
  }), {
    translation: {
      title: "객체 스키마 정규화",
      body: "strict object schema를 정규화하고 policy를 적용합니다.",
    },
    contextTranslations: [],
  });
  assert.equal(audit.status, "passed");
  assert.equal(audit.code, "local_source_boundary");
});

test("원문에 없는 문자 체계가 번역에 섞이면 자동 검증하지 않는다", () => {
  const audit = auditFreeNewsTranslation(record({ source: "Jump to blog post" }), {
    translation: { title: "블로그 글", body: "블로그 पोस्ट로 이동" },
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "unexpected_script");
});

test("reader summary keeps names and numbers inside the evidence boundary", () => {
  const audit = auditFreeNewsTranslation(record({
    source: "OpenAI Agents SDK Python 0.19.3 fixes tool collisions and session records.",
  }), {
    translation: {
      title: "OpenAI Agents SDK Python 0.19.3 공개",
      body: "도구 충돌과 세션 기록 문제를 수정했습니다.",
    },
    readerSummary: "OpenAI Agents SDK Python 0.19.3에서 도구 충돌과 세션 기록 문제를 줄였어요.",
    contextTranslations: [],
  });
  assert.equal(audit.status, "passed");
});

test("reader summary cannot add a product name absent from the evidence", () => {
  const audit = auditFreeNewsTranslation(record({ source: "The update fixes tool collisions." }), {
    translation: { title: "도구 충돌 수정", body: "도구 충돌 문제를 수정했습니다." },
    readerSummary: "GPT-6의 도구 충돌을 줄였어요.",
    contextTranslations: [],
  });
  assert.equal(audit.status, "failed");
  assert.equal(audit.code, "reader_summary_invariant_added");
});

test("독자 요약은 출처 계정명과 표시 이름을 근거로 사용할 수 있다", () => {
  const item = record();
  item.source = { account: "derrickcchoi", label: "Derrick Choi" };
  item.original.content = "I am moving to Singapore to lead Codex efforts across APAC.";
  const result = auditFreeNewsTranslation(item, {
    translation: {
      title: "싱가포르로 옮겨 APAC Codex 업무를 이끈다",
      body: "저는 APAC 전역의 Codex 업무를 이끌기 위해 싱가포르로 옮깁니다.",
    },
    readerSummary: "Derrick Choi가 APAC Codex 업무를 맡는다는 소식입니다.",
    contextTranslations: [],
  });
  assert.equal(result.status, "passed");
});

test("OpenAI 공식 문서 소스는 독자 요약에서 OpenAI 출처명을 사용할 수 있다", () => {
  const item = record({ source: "Customers can filter usage data by API key." });
  item.source = { type: "official-changelog", provider: "openai-docs" };
  const result = auditFreeNewsTranslation(item, {
    translation: {
      title: "API 키별 사용량 필터 지원",
      body: "고객은 API 키별로 사용량 데이터를 필터링할 수 있습니다.",
    },
    readerSummary: "OpenAI API의 사용량 관리 도구에서 API 키별 데이터를 나눠 볼 수 있게 됐습니다.",
    contextTranslations: [],
  });
  assert.equal(result.status, "passed");
  assert.equal(result.code, "local_source_boundary");
});
