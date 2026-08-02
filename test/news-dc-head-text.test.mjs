import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedNewsDcHeadText,
  selectNewsDcHeadText,
} from "../src/modules/news/news-dc-head-text.mjs";

function record({ type = "x-post", account = "someone", evidenceTag = "opinion", boardCategory = "chatter" } = {}) {
  return {
    source: { type, account },
    workflow: { triage: { evidenceTag, boardCategory } },
  };
}

test("공식 소식은 모델 제안과 무관하게 뉴스/소식 말머리를 사용한다", () => {
  assert.equal(selectNewsDcHeadText(record({ account: "OpenAI", boardCategory: "chatter" })), "뉴스/소식");
  assert.equal(selectNewsDcHeadText(record({ type: "discord-announcement", boardCategory: "information" })), "뉴스/소식");
});

test("신뢰 인물의 활용 사례는 뉴스로, 일반 활용 사례는 잡담으로 분리한다", () => {
  const useCase = record({ evidenceTag: "use_case", boardCategory: "chatter" });
  assert.equal(selectNewsDcHeadText(useCase, { trustLevel: "high", affiliationConfirmed: true }), "뉴스/소식");
  assert.equal(selectNewsDcHeadText(useCase), "잡담");
});

test("허용된 게시 분류만 네 개의 안전한 말머리로 변환한다", () => {
  assert.equal(selectNewsDcHeadText(record({ boardCategory: "information" })), "💡 정보");
  assert.equal(selectNewsDcHeadText(record({ boardCategory: "ai_creation" })), "AI창작");
  assert.equal(selectNewsDcHeadText(record({ boardCategory: "notice" })), "잡담");
  assert.deepEqual(
    ["뉴스/소식", "정보", "💡 정보", "잡담", "AI창작", "공지", "후방"].filter(isAllowedNewsDcHeadText),
    ["뉴스/소식", "💡 정보", "잡담", "AI창작"],
  );
});
