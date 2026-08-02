import assert from "node:assert/strict";
import test from "node:test";
import { composeNewsDcCopy } from "../src/modules/news/news-dc-copy.mjs";

function record() {
  return {
    source: {
      type: "x-post",
      account: "gregbrockman",
      url: "https://x.com/gregbrockman/status/123456",
    },
    original: {
      links: ["https://openai.com/sk/blocked", "https://openai.com/news/safe"],
      contexts: [{ account: "OpenAI", label: "OpenAI", content: "Context" }],
    },
    workflow: {
      translation: { title: "반복 작업을 맡겨보세요 🤣", body: "ChatGPT로 반복 작업을 실행할 수 있습니다." },
      contextTranslations: [{ index: 1, body: "관련 문서의 별도 번역입니다." }],
      triage: {
        decision: "publish",
        confidence: 0.9,
        evidenceTag: "use_case",
        boardCategory: "news",
        reason: "반복 작업 자동화 방향을 보여주는 초기 신호입니다.",
        advice: "‘제작 보조’ 쪽으로 조심스럽게 쓰세요. 공개 기능처럼 단정하지 말고 프레이밍하세요.",
      },
      analysisNotice: "주의: 아래 해설은 GPT-5.4 mini가 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다.",
    },
    media: [{ file: "media/01.png" }, { file: "media/02.png" }],
  };
}

test("DC 뉴스 원고는 태그·번역·AI 해설·출처를 결정적으로 분리한다", () => {
  const profiles = new Map([["gregbrockman", {
    displayName: "Greg Brockman",
    affiliation: "OpenAI",
    affiliationConfirmed: true,
    roles: ["사장·공동 창립자"],
    topics: ["엔지니어링", "모델"],
    trustLabel: "핵심 인물",
    trustLevel: "high",
    verifiedAt: "2026-08-02",
    whyTracked: "OpenAI 핵심 인물이라서 주목해요.",
  }]]);
  const draft = composeNewsDcCopy(record(), { sourceProfiles: profiles });

  assert.equal(draft.headText, "뉴스/소식");
  assert.equal(draft.title, "[사례] 반복 작업을 맡겨보세요");
  assert.match(draft.bodyText, /게시자: Greg Brockman/u);
  assert.match(draft.bodyText, /게시자: Greg Brockman · OpenAI · 사장·공동 창립자 · 핵심 인물/u);
  assert.doesNotMatch(draft.bodyText, /주요 분야:|출처 구분:|소속 확인:/u);
  assert.match(draft.bodyText, /본문 번역\nChatGPT로 반복 작업/u);
  assert.match(draft.bodyText, /관련 글 번역 · OpenAI/u);
  assert.match(draft.bodyText, /왜 중요한가/u);
  assert.match(draft.bodyText, /다른 환경에서도 동일하게 재현되는지는 원문만으로 확인되지 않았습니다/u);
  assert.doesNotMatch(draft.bodyText, /쓰세요|프레이밍하세요/u);
  assert.match(draft.bodyText, /원문 번역이 아니며/u);
  assert.match(draft.bodyText, /https:\/\/x\.com\/gregbrockman\/status\/123456/u);
  assert.doesNotMatch(`${draft.title}\n${draft.bodyText}`, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(draft.bodyText, /openai\.com\/sk\//u);
  assert.equal(draft.imageCount, 2);
  assert.equal(draft.preflight.emojiRemovedCount, 1);
  assert.equal(draft.preflight.omittedRiskyLinkCount, 1);
  assert.equal(draft.preflight.ready, true);
});

test("DC 뉴스 원고는 결합문자가 남으면 실제 게시 준비를 막는다", () => {
  const sample = record();
  sample.workflow.translation.body = "위험한 결합문자 o\u0325";
  const draft = composeNewsDcCopy(sample);
  assert.equal(draft.preflight.ready, false);
  assert.equal(draft.preflight.combiningMarkCount, 1);
});
