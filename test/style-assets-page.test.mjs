import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("화풍 관리 화면은 업로드·다운로드·재색인 진입점을 제공한다", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const [page, script, style] = await Promise.all([
      fetch(`${baseUrl}/images/styles`),
      fetch(`${baseUrl}/images/styles/app.js`),
      fetch(`${baseUrl}/images/styles/page.css`),
    ]);
    const body = await page.text();
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(body, /id="upload-form"/);
    assert.match(body, /id="reindex-button"/);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
