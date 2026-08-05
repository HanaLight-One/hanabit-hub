import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalOpenAiDeveloperDocUrl,
  normalizeOfficialMarkdownLink,
} from "../src/modules/news/official-doc-url.mjs";

test("OpenAI 문서 프리뷰 링크를 공개 개발자 문서 주소로 교정한다", () => {
  const preview = "https://developers-site-git-agent-add-fast-openai.vercel.app/api/docs/pricing?latest-pricing=fast";
  assert.equal(
    canonicalOpenAiDeveloperDocUrl(preview),
    "https://developers.openai.com/api/docs/pricing?latest-pricing=fast",
  );
  assert.equal(normalizeOfficialMarkdownLink(preview), canonicalOpenAiDeveloperDocUrl(preview));
});

test("OpenAI 프리뷰처럼 보이는 외부 주소와 비문서 경로는 교정하지 않는다", () => {
  assert.equal(canonicalOpenAiDeveloperDocUrl("https://developers-site-openai.vercel.app/api/docs/pricing"), null);
  assert.equal(canonicalOpenAiDeveloperDocUrl("https://developers-site-git-demo-openai.vercel.app/admin"), null);
  assert.equal(normalizeOfficialMarkdownLink("https://example.com/news"), "https://example.com/news");
});
