import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(systemControl, callback) {
  const server = createServer({ systemControl });
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

test("Codex 상태 API는 안전한 상태만 제공한다", async () => {
  const systemControl = {
    async status() {
      return { available: true, running: true, action: "restart-codex" };
    },
  };

  await withServer(systemControl, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/codex`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      available: true,
      running: true,
      action: "restart-codex",
    });
  });
});

test("Codex 재기동 API는 같은 출처의 정확한 확인만 허용한다", async () => {
  let calls = 0;
  const systemControl = {
    async status() {},
    async restart() {
      calls += 1;
      return { accepted: true, action: "restart-codex" };
    },
  };

  await withServer(systemControl, async (baseUrl) => {
    const host = new URL(baseUrl).host;
    const missingOrigin = await fetch(`${baseUrl}/api/system/codex/restart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "restart-codex" }),
    });
    assert.equal(missingOrigin.status, 403);

    const wrongConfirmation = await fetch(`${baseUrl}/api/system/codex/restart`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ confirmation: "anything-else" }),
    });
    assert.equal(wrongConfirmation.status, 400);

    const accepted = await fetch(`${baseUrl}/api/system/codex/restart`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host,
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ confirmation: "restart-codex" }),
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), {
      accepted: true,
      action: "restart-codex",
    });
    assert.equal(calls, 1);
  });
});

test("비활성 서버는 Codex 제어 API를 숨긴다", async () => {
  await withServer(null, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/system/codex`);
    assert.equal(response.status, 404);
  });
});
