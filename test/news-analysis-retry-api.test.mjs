import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("뉴스 다시 분석 API는 명시적 확인과 실패 상태를 요구한다", async () => {
  let calls = 0;
  const processor = {
    async retry(id) {
      calls += 1;
      return { id, workflow: { status: "pending_review" } };
    },
  };
  const server = createServer({ newsAnalysisProcessor: processor });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const target = `http://127.0.0.1:${server.address().port}/api/news/${"b".repeat(32)}/analysis-retry`;
    assert.equal((await fetch(target, { method: "GET" })).status, 405);
    assert.equal((await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "no" }),
    })).status, 400);
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "retry-news-analysis" }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
