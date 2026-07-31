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

test("/images/create가 안전한 추가생성 초안 화면을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/images/create`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /추가 이미지 생성실 · Hanabit Hub/);
    assert.match(body, /id="creation-form"/);
    assert.match(body, /id="style-grid"/);
    assert.match(body, /id="style-toggle"/);
    assert.match(body, /id="character-grid"/);
    assert.match(body, /id="character-toggle"/);
    assert.match(body, /aria-expanded="false"/);
    assert.match(body, /격리 초안 저장/);
    assert.match(body, /maxlength="12000"/);
    assert.match(body, /id="preview-route"/);
    assert.match(body, /id="execute-button"/);
    assert.match(body, /1장 실제 생성/);
    assert.match(body, /disabled/);
    assert.equal(body.includes("<form action="), false);
  });
});

test("추가생성 초안 화면의 스크립트와 스타일을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const [script, style] = await Promise.all([
      fetch(`${baseUrl}/images/create/app.js`),
      fetch(`${baseUrl}/images/create/styles.css`),
    ]);
    const scriptBody = await script.text();

    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.match(scriptBody, /fetch\(`\/api\/images\//);
    assert.match(scriptBody, /\/api\/images\/creation-options/);
    assert.match(scriptBody, /화풍 없음/);
    assert.match(scriptBody, /등장인물 없음/);
    assert.match(scriptBody, /PINK_BRIDGE_ID/);
    assert.match(scriptBody, /\/api\/images\/generation-drafts/);
    assert.match(scriptBody, /method: "POST"/);
    assert.match(scriptBody, /prompt-only/);
    assert.match(scriptBody, /generate-one-prompt-only-image/);
    assert.match(scriptBody, /window\.confirm/);
    assert.match(scriptBody, /\/api\/images\/generation-jobs/);
    assert.equal(scriptBody.includes('method: "PUT"'), false);
    assert.equal(scriptBody.includes('method: "DELETE"'), false);
    assert.equal(scriptBody.includes("localStorage"), false);
    assert.match(scriptBody, /SAFE_SOURCE_ID/);
  });
});
