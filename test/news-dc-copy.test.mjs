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
      contextTranslations: [{ index: 1, body: "관련 글 첫 문단\n\n- 첫 항목\n\n- 둘째 항목" }],
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
  assert.match(draft.bodyText, /관련 글 첫 문단\n\n• 첫 항목\n\n• 둘째 항목/u);
  assert.match(draft.bodyHtml, /관련 글 첫 문단<\/p><p><br><\/p><p[^>]*>• 첫 항목<\/p>/u);
  assert.match(draft.bodyText, /왜 중요한가/u);
  assert.match(draft.bodyText, /다른 환경에서도 동일하게 재현되는지는 원문만으로 확인되지 않았습니다/u);
  assert.doesNotMatch(draft.bodyText, /쓰세요|프레이밍하세요/u);
  assert.match(draft.bodyText, /원문 번역이 아니며/u);
  assert.match(draft.bodyText, /https:\/\/x\.com\/gregbrockman\/status\/123456/u);
  assert.equal(draft.bodyText.indexOf("원문 링크"), 0);
  assert.equal(
    draft.bodyText.indexOf("https://x.com/gregbrockman/status/123456") <
      draft.bodyText.indexOf("게시자: Greg Brockman"),
    true,
  );
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

test("DC 뉴스 원고는 번역 응답에 남은 Markdown 표식을 평문으로 정리한다", () => {
  const sample = record();
  sample.workflow.translation.title = "### 7.4.0";
  sample.workflow.translation.body = "### 빌드 시스템\n\n* **deps:** dotenv 업데이트";
  const draft = composeNewsDcCopy(sample);
  assert.equal(draft.title, "[사례] 7.4.0");
  assert.match(draft.bodyText, /빌드 시스템\n\n• deps: dotenv 업데이트/u);
  assert.doesNotMatch(draft.bodyText, /###|\*\*/u);
});

test("공식 GitHub 릴리스 제목에는 제품명을 결정적으로 붙인다", () => {
  const sample = record();
  sample.source = {
    type: "official-github-release",
    repository: "openai/openai-agents-js",
    url: "https://github.com/openai/openai-agents-js/releases/tag/v7.4.0",
  };
  sample.workflow.translation.title = "7.4.0";
  sample.workflow.triage.evidenceTag = "official";
  const draft = composeNewsDcCopy(sample);
  assert.equal(draft.title, "[공식] OpenAI Agents SDK JavaScript 7.4.0");
});

test("원문 이미지가 없을 때만 기본 커버를 이미지 수에 포함한다", () => {
  const sample = record();
  sample.media = [];
  const withCover = composeNewsDcCopy(sample, { fallbackCover: true });
  const withoutCover = composeNewsDcCopy(sample);
  assert.equal(withCover.imageCount, 1);
  assert.equal(withCover.sourceImageCount, 0);
  assert.equal(withCover.usesFallbackCover, true);
  assert.equal(withoutCover.imageCount, 0);
  assert.equal(withoutCover.usesFallbackCover, false);
});

test("Discord 공식 글은 직접 미디어 주소를 빼고 외부 원문 링크를 우선한다", () => {
  const sample = record();
  sample.source = {
    type: "discord-announcement",
    url: "https://discord.com/channels/1/2/3",
  };
  sample.original.links = [
    "https://video.twimg.com/amplify_video/example/vid/avc1/1920x1080/example.mp4",
    "https://openai.com/index/ten-advances-in-mathematics/",
  ];
  const draft = composeNewsDcCopy(sample);
  assert.match(draft.bodyText, /https:\/\/openai\.com\/index\/ten-advances-in-mathematics\//u);
  assert.doesNotMatch(draft.bodyText, /video\.twimg\.com|\.mp4|discord\.com\/channels/u);
});

test("공식 문서 보강은 관련 글과 구분한 주요 내용으로 표시한다", () => {
  const sample = record();
  sample.original.contexts = [{
    relation: "official-document",
    account: "OpenAI",
    label: "OpenAI 공식 문서",
    content: "Official source",
    url: "https://openai.com/index/example",
  }];
  sample.workflow.contextTranslations = [{
    index: 1,
    body: "문제 일부는 해결했고 나머지는 상당한 진전을 이뤘습니다.",
  }];
  const draft = composeNewsDcCopy(sample);
  assert.match(draft.bodyText, /공식 문서 주요 내용 · OpenAI 공식 문서/u);
  assert.doesNotMatch(draft.bodyText, /관련 글 번역 · OpenAI 공식 문서/u);
});
