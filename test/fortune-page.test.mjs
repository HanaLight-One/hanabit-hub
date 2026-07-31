import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("운세 화면은 날짜 선택과 TXT 다운로드 진입점을 제공한다", async () => {
  const server = createServer();
  await new Promise((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${baseUrl}/fortune`);
    const body = await page.text();
    const script = await (await fetch(`${baseUrl}/fortune/app.js`)).text();
    assert.equal(page.status, 200);
    assert.equal(body.includes('id="date-select"'), true);
    assert.equal(body.includes('id="download-link"'), true);
    assert.equal(script.includes('fetch(`/api/fortune${query}`'), true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
