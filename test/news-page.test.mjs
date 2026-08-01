import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("React 뉴스 검수실 화면과 승인 스크립트를 제공한다", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${baseUrl}/news`);
    const body = await page.text();
    const script = await (await fetch(`${baseUrl}/news/app.js`)).text();
    assert.equal(page.status, 200);
    assert.equal(body.includes("뉴스 검수실"), true);
    assert.equal(body.includes('id="news-root"'), true);
    assert.equal(script.includes("localStorage"), false);
    assert.equal(script.includes('fetch("/api/news"'), true);
    assert.equal(script.includes("translation-box"), true);
    assert.equal(script.includes("retry-news-analysis"), true);
    assert.equal(script.includes("확인 필요"), true);
    assert.equal(script.includes("하나빛 조언"), true);
    assert.equal(script.includes("이미지 확인"), true);
    assert.equal(script.includes("이미지 픽셀을 보지 않았어요"), true);
    assert.equal(script.includes("무료 API 1차 판정"), true);
    assert.equal(script.includes("Codex 하나빛 심층검토"), true);
    assert.equal(script.includes("approve-dc-publication"), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
