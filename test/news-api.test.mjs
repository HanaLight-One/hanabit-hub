import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(news, callback) {
  const server = createServer({ news });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("뉴스 API는 읽기 전용 목록만 제공한다", async () => {
  const news = { async list() { return { items: [], total: 0, skipped: 0 }; } };
  await withServer(news, async (baseUrl) => {
    const get = await fetch(`${baseUrl}/api/news`);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { items: [], total: 0, skipped: 0 });
    assert.equal((await fetch(`${baseUrl}/api/news`, { method: "POST" })).status, 405);
  });
});

test("뉴스 미디어 API는 기록된 이미지만 스트리밍한다", async () => {
  const news = { async findMedia(id, filename) { assert.equal(id, "a".repeat(32)); assert.equal(filename, "01-news.png"); return null; } };
  await withServer(news, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/news/${"a".repeat(32)}/media/01-news.png`);
    assert.equal(response.status, 404);
  });
});
