import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(oracle, callback) {
  const server = createServer({ promptOracleService: oracle });
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

function sameOrigin(baseUrl) {
  return { origin: baseUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" };
}

test("신탁 설정과 리롤 API는 같은 출처 요청만 처리한다", async () => {
  const calls = [];
  const oracle = {
    async readSettings() { return { chaos: 68, ingredients: [], limits: { ingredients: 40 } }; },
    async updateSettings(body) { calls.push(["settings", body]); return body; },
    async reroll(body) { calls.push(["reroll", body]); return { scene: "예상하지 못한 빛의 정원이 열린다.", chaos: body.chaos, ingredients: [] }; },
  };
  await withServer(oracle, async (baseUrl) => {
    const settings = await fetch(`${baseUrl}/api/images/prompt-oracle/settings`);
    assert.equal(settings.status, 200);

    const forbidden = await fetch(`${baseUrl}/api/images/prompt-oracle/reroll`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(forbidden.status, 403);

    const update = await fetch(`${baseUrl}/api/images/prompt-oracle/settings`, {
      method: "PUT",
      headers: { ...sameOrigin(baseUrl), "x-prompt-oracle-confirmation": "update-prompt-oracle-settings" },
      body: JSON.stringify({ chaos: 77, ingredients: [{ id: "x", name: "빛", weight: 20, enabled: true }] }),
    });
    assert.equal(update.status, 200);

    const reroll = await fetch(`${baseUrl}/api/images/prompt-oracle/reroll`, {
      method: "POST", headers: sameOrigin(baseUrl), body: JSON.stringify({ chaos: 77 }),
    });
    assert.equal(reroll.status, 200);
    assert.deepEqual(calls.map(([name]) => name), ["settings", "reroll"]);
  });
});

