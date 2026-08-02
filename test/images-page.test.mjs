import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(callback) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("/images가 읽기 전용 이미지 화면을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/images`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /이미지 아카이브 · Hanabit Hub/);
    assert.match(body, /id="detail-panel"/);
    assert.match(body, /aria-hidden="true" inert/);
    assert.match(body, /id="date-filter"/);
    assert.match(body, /id="theme-card"/);
    assert.match(body, /오늘의 테마/);
    assert.match(body, /id="category-tabs"/);
    assert.match(body, /오테 추가/);
    assert.match(body, /자유 추가/);
    assert.match(body, /id="generation-status"/);
    assert.match(body, /id="prompt-record"/);
    assert.equal(body.includes("삭제"), false);
  });
});

test("이미지 화면의 스크립트와 스타일을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const [script, style] = await Promise.all([
      fetch(`${baseUrl}/images/app.js`),
      fetch(`${baseUrl}/images/styles.css`),
    ]);
    const scriptBody = await script.text();

    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /javascript/);
    assert.match(scriptBody, /currentOperationalDate/);
    assert.match(scriptBody, /· 오늘/);
    assert.match(scriptBody, /\/api\/images\/generation-jobs/);
    assert.match(scriptBody, /theme-extra/);
    assert.match(scriptBody, /프롬프트 펼치기/);
    assert.match(scriptBody, /이미지 앵커/);
    assert.match(scriptBody, /hydrateImageCard/);
    assert.match(scriptBody, /인물 유지/);
    assert.match(scriptBody, /화풍 유지/);
    assert.equal(style.status, 200);
    assert.match(style.headers.get("content-type"), /text\/css/);
  });
});
