import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

const TEST_TOKEN = `${"a".repeat(24)}.${"b".repeat(12)}.${"c".repeat(30)}`;

async function withServer(discordSetup, callback) {
  const server = createServer({ discordSetup });
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

function postHeaders(baseUrl) {
  return {
    "content-type": "application/json",
    origin: baseUrl,
    "sec-fetch-site": "same-origin",
  };
}

test("Discord 토큰 API는 설정 여부만 제공한다", async () => {
  const discordSetup = {
    async status() {
      return { configured: false };
    },
  };

  await withServer(discordSetup, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup/discord-token`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { configured: false });
  });
});

test("Discord 토큰 API는 같은 출처의 정확한 저장 요청만 허용한다", async () => {
  let savedToken = null;
  const discordSetup = {
    async status() {
      return { configured: false };
    },
    async save(token) {
      savedToken = token;
      return { saved: true, configured: true };
    },
  };

  await withServer(discordSetup, async (baseUrl) => {
    const missingOrigin = await fetch(`${baseUrl}/api/setup/discord-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: TEST_TOKEN,
        confirmation: "save-discord-bot-token",
      }),
    });
    assert.equal(missingOrigin.status, 403);

    const wrongConfirmation = await fetch(`${baseUrl}/api/setup/discord-token`, {
      method: "POST",
      headers: postHeaders(baseUrl),
      body: JSON.stringify({
        token: TEST_TOKEN,
        confirmation: "anything-else",
      }),
    });
    assert.equal(wrongConfirmation.status, 400);

    const accepted = await fetch(`${baseUrl}/api/setup/discord-token`, {
      method: "POST",
      headers: postHeaders(baseUrl),
      body: JSON.stringify({
        token: TEST_TOKEN,
        confirmation: "save-discord-bot-token",
      }),
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), {
      saved: true,
      configured: true,
    });
    assert.equal(savedToken, TEST_TOKEN);
  });
});

test("Discord 토큰 API 오류 응답은 전달받은 토큰을 포함하지 않는다", async () => {
  const discordSetup = {
    async status() {
      return { configured: false };
    },
    async save() {
      throw Object.assign(new Error(`bad ${TEST_TOKEN}`), {
        code: "STORE_FAILURE",
      });
    },
  };

  await withServer(discordSetup, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/setup/discord-token`, {
      method: "POST",
      headers: postHeaders(baseUrl),
      body: JSON.stringify({
        token: TEST_TOKEN,
        confirmation: "save-discord-bot-token",
      }),
    });
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.equal(body.includes(TEST_TOKEN), false);
  });
});
