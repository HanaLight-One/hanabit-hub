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

test("Discord 일회성 설정 화면은 보안 헤더와 비밀번호 입력칸을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/setup/discord`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(body.includes('type="password"'), true);
    assert.equal(body.includes('autocomplete="off"'), true);
    assert.equal(body.includes("일회성 보관함"), true);
  });
});

test("Discord 설정 화면은 토큰을 브라우저 저장소에 보관하지 않는다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/setup/discord/app.js`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body.includes("localStorage"), false);
    assert.equal(body.includes("sessionStorage"), false);
    assert.equal(body.includes('tokenInput.value = "";'), true);
  });
});
