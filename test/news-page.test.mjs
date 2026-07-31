import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("뉴스 대기함 화면과 스크립트를 제공한다", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${baseUrl}/news`);
    const body = await page.text();
    const script = await (await fetch(`${baseUrl}/news/app.js`)).text();
    assert.equal(page.status, 200);
    assert.equal(body.includes("뉴스 대기함"), true);
    assert.equal(body.includes('id="news-list"'), true);
    assert.equal(script.includes("localStorage"), false);
    assert.equal(script.includes('fetch("/api/news"'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
