import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichOfficialDocument,
  findOfficialOpenAiArticle,
  findOfficialOpenAiPricing,
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

test("GPT-5.6 Fast 변경 기록의 프리뷰 가격 링크를 공개 표 문맥으로 보강한다", async () => {
  const preview = "https://developers-site-git-agent-add-fast-openai.vercel.app/api/docs/pricing?latest-pricing=fast";
  const item = {
    source: { type: "official-changelog" },
    original: {
      content: "GPT-5.6 Fast mode now supports long-context requests exceeding 272K tokens.",
      links: [preview],
      contexts: [],
    },
  };
  assert.equal(
    findOfficialOpenAiPricing(item),
    "https://developers.openai.com/api/docs/pricing?latest-pricing=fast",
  );
  let requested;
  const enriched = await enrichOfficialDocument(item, {
    fetchImpl: async (url) => {
      requested = String(url);
      return new Response([
        "# Pricing",
        "### Fast pricing data",
        "",
        "| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| gpt-5.6-sol | $10.00 | $1.00 | $12.50 | $60.00 | $20.00 | $2.00 | $25.00 | $90.00 |",
        "| gpt-5.6-terra | $4.00 | $0.40 | $5.00 | $24.00 | $8.00 | $0.80 | $10.00 | $36.00 |",
        "| gpt-5.6-luna | $0.40 | $0.04 | $0.50 | $2.40 | $0.80 | $0.08 | $1.00 | $3.60 |",
      ].join("\n"), { status: 200, headers: { "content-type": "text/markdown" } });
    },
  });
  assert.equal(requested, "https://developers.openai.com/api/docs/pricing.md?latest-pricing=fast");
  assert.equal(enriched.original.contexts[0].label, "OpenAI 공식 Fast 가격표");
  assert.equal(enriched.original.contexts[0].url, "https://developers.openai.com/api/docs/pricing?latest-pricing=fast");
  assert.match(enriched.original.contexts[0].content, /1M tokens \(100만 tokens\)/u);
  assert.match(enriched.original.contexts[0].content, /gpt-5\.6-sol.*\$20\.00.*\$90\.00/u);
  assert.match(enriched.original.contexts[0].content, /gpt-5\.6-luna.*\$0\.80.*\$3\.60/u);

  const stale = structuredClone(item);
  stale.original.contexts = [{
    relation: "official-document",
    account: "OpenAI",
    label: "OpenAI 공식 Fast 가격표",
    content: "Fast mode prices in USD per 1M tokens.",
    url: "https://developers.openai.com/api/docs/pricing?latest-pricing=fast",
  }];
  const refreshed = await enrichOfficialDocument(stale, {
    fetchImpl: async () => new Response([
      "### Fast pricing data",
      "| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| gpt-5.6-sol | $10.00 | $1.00 | $12.50 | $60.00 | $20.00 | $2.00 | $25.00 | $90.00 |",
      "| gpt-5.6-terra | $4.00 | $0.40 | $5.00 | $24.00 | $8.00 | $0.80 | $10.00 | $36.00 |",
      "| gpt-5.6-luna | $0.40 | $0.04 | $0.50 | $2.40 | $0.80 | $0.08 | $1.00 | $3.60 |",
    ].join("\n"), { status: 200, headers: { "content-type": "text/markdown" } }),
  });
  assert.equal(refreshed.original.contexts.length, 1);
  assert.match(refreshed.original.contexts[0].content, /1M tokens \(100만 tokens\)/u);
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
