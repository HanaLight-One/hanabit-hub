import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichOfficialDocument,
  findOfficialOpenAiArticle,
} from "../src/modules/news/official-document-enricher.mjs";

function record(links) {
  return {
    original: {
      links,
      contexts: [{ relation: "quoted", account: "Someone", content: "Parent post" }],
    },
  };
}

test("OpenAI 공식 발표 링크 한 개를 안전한 문서 후보로 고른다", () => {
  const item = record([
    "https://example.com/not-allowed",
    "https://openai.com/index/ten-advances-in-mathematics/#the-results",
  ]);
  assert.equal(
    findOfficialOpenAiArticle(item),
    "https://openai.com/index/ten-advances-in-mathematics",
  );
});

test("공식 발표를 읽어 별도 공식 문서 문맥으로 보강한다", async () => {
  const item = record(["https://openai.com/index/ten-advances-in-mathematics/"]);
  let requested;
  const enriched = await enrichOfficialDocument(item, {
    fetchImpl: async (url) => {
      requested = String(url);
      return new Response([
        "Title: Ten advances",
        "URL Source: https://openai.com/index/ten-advances-in-mathematics/",
        "Markdown Content:",
        "## The results",
        "Each result resolves or makes substantial progress.",
        "1. **Sphere packing.** New upper bounds.",
      ].join("\n"), { status: 200, headers: { "content-type": "text/plain" } });
    },
  });
  assert.equal(requested, "https://r.jina.ai/https://openai.com/index/ten-advances-in-mathematics");
  assert.equal(enriched.original.contexts[0].relation, "official-document");
  assert.equal(enriched.original.contexts[0].label, "OpenAI 공식 문서");
  assert.match(enriched.original.contexts[0].content, /resolves or makes substantial progress/u);
  assert.equal(enriched.original.contexts[1].account, "Someone");
});

test("응답 출처가 다르거나 읽기 실패면 기존 뉴스만 보존한다", async () => {
  const item = record(["https://openai.com/index/expected/"]);
  const wrong = await enrichOfficialDocument(item, {
    fetchImpl: async () => new Response([
      "URL Source: https://openai.com/index/other/",
      "Markdown Content:",
      "Unrelated",
    ].join("\n"), { status: 200 }),
  });
  assert.equal(wrong, item);

  const failed = await enrichOfficialDocument(item, {
    fetchImpl: async () => { throw new Error("network detail must not escape"); },
  });
  assert.equal(failed, item);
});

test("허용하지 않은 호스트와 OpenAI 비기사 경로는 읽지 않는다", async () => {
  let calls = 0;
  for (const links of [
    ["https://evil.example/index/news"],
    ["https://openai.com/api/unsafe"],
    ["http://openai.com/index/not-https"],
  ]) {
    const item = record(links);
    const result = await enrichOfficialDocument(item, {
      fetchImpl: async () => { calls += 1; return new Response("", { status: 200 }); },
    });
    assert.equal(result, item);
  }
  assert.equal(calls, 0);
});
