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
      readerSummary: "반복 작업을 자동으로 처리하는 흐름을 더 쉽게 구성할 수 있다는 뜻이에요.",
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
  assert.equal(draft.title, "반복 작업을 맡겨보세요");
  assert.match(draft.bodyText, /게시자: Greg Brockman/u);
  assert.match(draft.bodyText, /게시자: Greg Brockman · OpenAI · 사장·공동 창립자 · 핵심 인물/u);
  assert.doesNotMatch(draft.bodyText, /주요 분야:|출처 구분:|소속 확인:/u);
  assert.match(draft.bodyText, /본문 번역\nChatGPT로 반복 작업/u);
  assert.match(draft.bodyText, /관련 글 번역 · OpenAI/u);
  assert.match(draft.bodyText, /관련 글 첫 문단\n\n• 첫 항목\n\n• 둘째 항목/u);
  assert.match(draft.bodyHtml, /관련 글 첫 문단<\/p><p><br><\/p><p[^>]*>• 첫 항목<\/p>/u);
  assert.doesNotMatch(draft.bodyText, /왜 중요한가|evidenceTag|SOURCE|CONTEXT|use_case/u);
  assert.match(draft.bodyText, /다른 환경에서도 동일하게 재현되는지는 원문만으로 확인되지 않았습니다/u);
  assert.doesNotMatch(draft.bodyText, /쓰세요|프레이밍하세요/u);
  assert.match(draft.bodyText, /원문 번역이 아니며/u);
  assert.match(draft.bodyText, /https:\/\/x\.com\/gregbrockman\/status\/123456/u);
  assert.match(draft.bodyText, /한눈에 보면\n반복 작업을 자동으로 처리/u);
  assert.equal(draft.bodyText.indexOf("한눈에 보면") < draft.bodyText.indexOf("본문 번역"), true);
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

test("이모지뿐인 원문 제목은 관련 글 번역에서 정보성 제목을 복구한다", () => {
  const sample = record();
  sample.workflow.translation.title = "🚀";
  sample.workflow.translation.body = "🚀";
  sample.workflow.contextTranslations = [{
    index: 1,
    body: "ChatGPT에서 Chat은 점점 Work처럼 행동하기 시작하고 있다. 둘은 올해 안에 합쳐질 것으로 예상한다.",
  }];
  sample.workflow.triage.evidenceTag = "opinion";
  const draft = composeNewsDcCopy(sample);

  assert.equal(draft.title, "ChatGPT에서 Chat은 점점 Work처럼 행동하기 시작하고 있다");
  assert.equal(draft.preflight.emojiRemovedCount, 2);
});

test("관련 글 작성자 이름의 이모지도 DC 소제목에서 제거한다", () => {
  const sample = record();
  sample.original.contexts[0].label = "Diego | AI 🚀 - e/acc";
  const draft = composeNewsDcCopy(sample);

  assert.match(draft.bodyText, /관련 글 번역 · Diego \| AI - e\/acc/u);
  assert.doesNotMatch(`${draft.title}\n${draft.bodyText}`, /\p{Extended_Pictographic}/u);
  assert.equal(draft.preflight.emojiRemovedCount, 2);
  assert.equal(draft.preflight.ready, true);
});

test("사용자 코멘트는 표찰 없이 모든 해설 뒤의 마지막 문단에 넣는다", () => {
  const sample = record();
  sample.workflow.dcEditorNote = "ㅋㅋㅋ 뭐라는 거야 🚀\n그래도 흥미롭네";
  const draft = composeNewsDcCopy(sample);

  assert.equal(draft.editorNote, "ㅋㅋㅋ 뭐라는 거야\n그래도 흥미롭네");
  assert.equal(draft.bodyText.includes("작성자 한마디"), false);
  assert.equal(draft.bodyText.indexOf("아직 확인되지 않은 점") < draft.bodyText.indexOf("ㅋㅋㅋ 뭐라는 거야"), true);
  assert.equal(draft.bodyText.endsWith("ㅋㅋㅋ 뭐라는 거야\n그래도 흥미롭네"), true);
  assert.doesNotMatch(draft.bodyText, /\p{Extended_Pictographic}/u);
});

test("DC 뉴스 원고는 번역 응답에 남은 Markdown 표식을 평문으로 정리한다", () => {
  const sample = record();
  sample.workflow.translation.title = "### 7.4.0";
  sample.workflow.translation.body = "### 빌드 시스템\n\n* **deps:** dotenv 업데이트";
  const draft = composeNewsDcCopy(sample);
  assert.equal(draft.title, "7.4.0");
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
  assert.equal(draft.title, "OpenAI Agents SDK JavaScript 7.4.0");
});

test("허브 분류 태그는 DC 제목에서만 반복 제거한다", () => {
  const sample = record();
  sample.workflow.publicHeadline = "[공식] [장애발생] OpenAI 서비스 장애 발생";
  sample.workflow.translation.title = "허브에 보일 번역 제목";
  sample.workflow.triage.evidenceTag = "official";
  const draft = composeNewsDcCopy(sample);

  assert.equal(sample.workflow.publicHeadline, "[공식] [장애발생] OpenAI 서비스 장애 발생");
  assert.equal(draft.title, "OpenAI 서비스 장애 발생");
});

test("허브 소유가 아닌 대괄호 제목은 DC 게시에서도 보존한다", () => {
  const sample = record();
  sample.workflow.publicHeadline = "[OpenAI] 새로운 연구 결과 공개";
  const draft = composeNewsDcCopy(sample);

  assert.equal(draft.title, "[OpenAI] 새로운 연구 결과 공개");
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

test("인물 공개 이력은 관련 글과 구분한 소개로 표시한다", () => {
  const sample = record();
  sample.original.content = "Very excited to welcome @nikitabier to the Codex team";
  sample.original.contexts = [{
    relation: "public-background",
    account: "nikitabier",
    label: "Nikita Bier 공개 이력",
    content: "Public career background",
  }];
  sample.workflow.contextTranslations = [{
    index: 1,
    body: "tbh와 Gas를 만든 소비자 제품 전문가입니다.",
  }];
  const draft = composeNewsDcCopy(sample);
  assert.match(draft.bodyText, /인물 소개 · Nikita Bier 공개 이력/u);
  assert.match(draft.bodyText, /Codex 팀에서 맡을 구체적인 역할과 업무 범위/u);
  assert.doesNotMatch(draft.bodyText, /제공 범위와 적용 시점/u);
  assert.doesNotMatch(draft.bodyText, /관련 글 번역 · Nikita Bier 공개 이력/u);
});

test("DC 원고의 OpenAI 문서 프리뷰 링크는 공개 주소로 교정한다", () => {
  const sample = record();
  sample.source.type = "official-changelog";
  sample.source.url = "https://developers.openai.com/api/docs/changelog#aug-5";
  sample.original.links = [
    "https://developers-site-git-agent-add-fast-openai.vercel.app/api/docs/pricing?latest-pricing=fast",
  ];
  const copy = composeNewsDcCopy(sample);
  assert.match(copy.bodyText, /https:\/\/developers\.openai\.com\/api\/docs\/pricing\?latest-pricing=fast/u);
  assert.doesNotMatch(copy.bodyText, /vercel\.app/u);
});

test("OpenAI Fast 가격표는 DC 모바일에서 읽기 쉬운 문단으로 바꾼다", () => {
  const sample = record();
  sample.original.contexts = [{
    relation: "official-document",
    account: "OpenAI",
    label: "OpenAI 공식 Fast 가격표",
    url: "https://developers.openai.com/api/docs/pricing?latest-pricing=fast",
  }];
  sample.workflow.contextTranslations = [{
    index: 1,
    body: [
      "Fast 모드의 USD 기준 100만 토큰당 가격입니다.",
      "",
      "| 모델 | 짧은 문맥 입력 | 짧은 문맥 캐시 입력 | 짧은 문맥 캐시 쓰기 | 짧은 문맥 출력 | 긴 문맥 입력 | 긴 문맥 캐시 입력 | 긴 문맥 캐시 쓰기 | 긴 문맥 출력 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| gpt-5.6-sol | $10.00 | $1.00 | $12.50 | $60.00 | $20.00 | $2.00 | $25.00 | $90.00 |",
      "| gpt-5.6-terra | $4.00 | $0.40 | $5.00 | $24.00 | $8.00 | $0.80 | $10.00 | $36.00 |",
      "| gpt-5.6-luna | $0.40 | $0.04 | $0.50 | $2.40 | $0.80 | $0.08 | $1.00 | $3.60 |",
    ].join("\n"),
  }];

  const copy = composeNewsDcCopy(sample);
  assert.match(copy.bodyText, /Fast 모드 가격 · 100만 토큰 기준\(USD\)/u);
  assert.match(copy.bodyText, /GPT-5\.6 Sol\n짧은 문맥: 입력 \$10\.00 · 캐시 입력 \$1\.00 · 캐시 쓰기 \$12\.50 · 출력 \$60\.00/u);
  assert.match(copy.bodyText, /긴 문맥: 입력 \$0\.80 · 캐시 입력 \$0\.08 · 캐시 쓰기 \$1\.00 · 출력 \$3\.60/u);
  assert.doesNotMatch(copy.bodyText, /^\|/mu);
  assert.doesNotMatch(copy.bodyText, /\| ---/u);
});

test("DC 제목은 별도 게시 제목을 쓰고 긴 문장을 중간에서 자르지 않는다", () => {
  const profiles = new Map();
  const withHeadline = record();
  withHeadline.workflow.publicHeadline = "GPT-Live·Codex로 만든 새 식별 도우미";
  withHeadline.workflow.translation.title = "🐥🐥";
  assert.match(composeNewsDcCopy(withHeadline, { sourceProfiles: profiles }).title, /새 식별 도우미$/u);

  const withoutHeadline = record();
  withoutHeadline.workflow.publicHeadline = null;
  withoutHeadline.workflow.translation.title = "가".repeat(70);
  withoutHeadline.workflow.contextTranslations = [];
  withoutHeadline.workflow.translation.body = "나".repeat(70);
  withoutHeadline.workflow.triage.reason = "다".repeat(70);
  const draft = composeNewsDcCopy(withoutHeadline, { sourceProfiles: profiles });
  assert.equal(draft.title.includes("가".repeat(56)), false);
  assert.equal(draft.preflight.ready, false);
  assert.match(draft.preflight.warnings.join(" "), /제목 확인/u);
});
