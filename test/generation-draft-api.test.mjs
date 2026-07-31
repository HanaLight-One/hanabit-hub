import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(drafts, callback) {
  const server = createServer({ drafts });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("생성 초안 API는 같은 출처 JSON만 저장하고 실행하지 않는다", async () => {
  const drafts = {
    async create(body) {
      assert.equal(body.prompt, "아무거나 자유롭게");
      return { id: "b".repeat(32), status: "draft", route: "prompt-only", promptLength: 9, executionEnabled: false };
    },
  };
  await withServer(drafts, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generation-drafts`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "아무거나 자유롭게" }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).executionEnabled, false);
  });
});

test("생성 초안 API는 교차 출처와 다른 메서드를 거부한다", async () => {
  await withServer({ async create() { throw new Error("호출되면 안 됩니다."); } }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/images/generation-drafts`)).status, 405);
    assert.equal((await fetch(`${baseUrl}/api/images/generation-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).status, 403);
  });
});
