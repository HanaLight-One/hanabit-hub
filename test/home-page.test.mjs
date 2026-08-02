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

test("홈의 긴급 재기동 제어는 기본적으로 접혀 있다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body.includes('<details class="emergency-control">'), true);
    assert.equal(body.includes("<summary>"), true);
    assert.equal(body.includes("Codex가 멈췄을 때만 펼쳐주세요"), true);
    assert.equal(body.includes('id="restart-codex"'), true);
    assert.equal(body.includes('/codex-usage-indicator.js'), true);
    assert.equal(body.includes('/codex-usage-indicator.css'), true);
    assert.equal(body.includes('id="codex-usage-value"'), false);
    assert.equal(body.includes("CODEX WEEKLY LIMIT"), false);
  });
});

test("이미지 화면은 오늘 이미지 부재를 경로 오류와 구분한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/images/app.js`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(
      body.includes(
        "오늘의 테마는 정상 연결되어 있지만, 오늘 이미지는 아직 저장소에 없어요.",
      ),
      true,
    );
  });
});

test("공용 파비콘과 기존 favicon.ico 요청을 모두 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const [homeResponse, svgResponse, legacyResponse] = await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/favicon.svg`),
      fetch(`${baseUrl}/favicon.ico`),
    ]);
    const homeBody = await homeResponse.text();
    const svgBody = await svgResponse.text();

    assert.equal(homeBody.includes('rel="icon" href="/favicon.svg"'), true);
    assert.equal(svgResponse.status, 200);
    assert.match(svgResponse.headers.get("content-type"), /^image\/svg\+xml/u);
    assert.equal(svgBody.includes("하나빛 H"), true);
    assert.equal(legacyResponse.status, 200);
    assert.match(legacyResponse.headers.get("content-type"), /^image\/svg\+xml/u);
  });
});
