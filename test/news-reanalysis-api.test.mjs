import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(processor, callback) {
  const server = createServer({ newsAnalysisProcessor: processor });
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

test("새 정책 재판정 API는 같은 출처의 명시적 확인만 실행한다", async () => {
  const id = "a".repeat(32);
  let calls = 0;
  await withServer({ async reprocess(value) { calls += 1; return { id: value, workflow: { status: "pending_review" } }; } }, async (baseUrl) => {
    const forbidden = await fetch(`${baseUrl}/api/news/${id}/reanalysis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "reclassify-news-item" }),
    });
    assert.equal(forbidden.status, 403);
    const response = await fetch(`${baseUrl}/api/news/${id}/reanalysis`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "reclassify-news-item" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "pending_review");
    assert.equal(calls, 1);
  });
});
