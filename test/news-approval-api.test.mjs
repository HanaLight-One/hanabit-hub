import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(newsApprovalService, callback) {
  const server = createServer({ newsApprovalService });
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

test("뉴스 DC 승인 API는 명시적 확인값을 요구한다", async () => {
  let calls = 0;
  const service = { async approveForDc(id) { calls += 1; return { id, changed: true }; } };
  await withServer(service, async (baseUrl) => {
    const target = `${baseUrl}/api/news/${"a".repeat(32)}/dc-approval`;
    assert.equal((await fetch(target, { method: "GET" })).status, 405);
    assert.equal((await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "no" }),
    })).status, 400);
    const approved = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "approve-dc-publication" }),
    });
    assert.equal(approved.status, 200);
    assert.equal(calls, 1);
  });
});
