import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

const ID = "c".repeat(32);

async function withServer(executor, callback) {
  const server = createServer({ generationExecutor: executor });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("1장 실행 API는 정확한 확인 후 허용된 1장 worker만 시작한다", async () => {
  let starts = 0;
  const executor = {
    async start(id) { starts += 1; return { id, status: "processing", route: "prompt-only", count: 1 }; },
    async status(id) { return { id, status: "processing", progress: { completed: 0, total: 1 }, message: "생성 중" }; },
    async list() {
      return {
        jobs: [{ id: ID, purpose: "free-play", status: "processing", stage: "planning", progress: { completed: 0, total: 1 } }],
        activeCount: 1,
        attentionCount: 0,
      };
    },
  };
  await withServer(executor, async (baseUrl) => {
    const headers = { origin: baseUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const bad = await fetch(`${baseUrl}/api/images/generation-drafts/${ID}/execute`, { method: "POST", headers, body: "{}" });
    assert.equal(bad.status, 400);
    assert.equal(starts, 0);
    const response = await fetch(`${baseUrl}/api/images/generation-drafts/${ID}/execute`, {
      method: "POST", headers, body: JSON.stringify({ confirmation: "generate-one-draft-image" }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).count, 1);
    assert.equal(starts, 1);
    assert.equal((await fetch(`${baseUrl}/api/images/generation-jobs/${ID}`)).status, 200);
    const listing = await fetch(`${baseUrl}/api/images/generation-jobs`);
    assert.equal(listing.status, 200);
    assert.equal((await listing.json()).activeCount, 1);
    assert.equal((await fetch(`${baseUrl}/api/images/generation-jobs`, { method: "POST" })).status, 405);
  });
});

test("1장 실행 API는 교차 출처 요청을 거부한다", async () => {
  await withServer({ async start() { throw new Error("호출 금지"); } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generation-drafts/${ID}/execute`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "generate-one-draft-image" }),
    });
    assert.equal(response.status, 403);
  });
});

test("배치 실행 API는 별도 확인값을 executor에 전달한다", async () => {
  let received = null;
  await withServer({
    async start(id, options) {
      received = { id, options };
      return { id, status: "processing", route: "prompt-only", count: 10 };
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/generation-drafts/${ID}/execute`, {
      method: "POST",
      headers: { origin: baseUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "generate-draft-image-batch" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(received, { id: ID, options: { confirmation: "generate-draft-image-batch" } });
  });
});
