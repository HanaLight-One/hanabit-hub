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
    assert.equal(body.includes('id="codex-usage-value"'), true);
    assert.equal(body.includes('class="status-usage"'), true);
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
