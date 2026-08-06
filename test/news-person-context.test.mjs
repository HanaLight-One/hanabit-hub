import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichMentionedPersonContext,
  isPersonnelAnnouncement,
} from "../src/modules/news/news-person-context.mjs";

test("알려진 인물의 팀 합류 공지에 검증된 공개 이력을 붙인다", () => {
  const record = {
    original: {
      content: "very excited to welcome @nikitabier to the codex team",
      contexts: [],
    },
  };
  const enriched = enrichMentionedPersonContext(record);
  assert.equal(isPersonnelAnnouncement(record), true);
  assert.equal(enriched.original.contexts.length, 1);
  assert.equal(enriched.original.contexts[0].relation, "public-background");
  assert.equal(enriched.original.contexts[0].account, "nikitabier");
  assert.match(enriched.original.contexts[0].content, /tbh and Gas/u);
  assert.match(enriched.original.contexts[0].content, /exact role/u);
});

test("공개 이력이 없는 인물은 지어내지 않는다", () => {
  const record = {
    original: {
      content: "very excited to welcome @unknownperson to the codex team",
      contexts: [],
    },
  };
  assert.equal(enrichMentionedPersonContext(record), record);
});
