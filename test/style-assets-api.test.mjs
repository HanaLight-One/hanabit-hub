import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(manager, callback) {
  const server = createServer({ styleAssetManager: manager });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("화풍 API는 목록·업로드·재색인을 같은 출처 요청으로만 제공한다", async () => {
  const calls = [];
  const manager = {
    async list() { return { count: 1, indexedCount: 1, styles: [] }; },
    async upload(body) { calls.push(["upload", body.filename]); return { uploaded: true }; },
    async reindex() { calls.push(["reindex"]); return { updated: true }; },
  };
  await withServer(manager, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/images/styles`)).status, 200);
    const denied = await fetch(`${baseUrl}/api/images/styles/reindex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "reindex-styles" }),
    });
    assert.equal(denied.status, 403);
    const headers = { "content-type": "application/json", origin: baseUrl, "sec-fetch-site": "same-origin" };
    const uploaded = await fetch(`${baseUrl}/api/images/styles/upload`, {
      method: "POST", headers,
      body: JSON.stringify({ filename: "[화풍] 새빛.txt", content: "prompt", confirmation: "upload-style" }),
    });
    assert.equal(uploaded.status, 201);
    const reindexed = await fetch(`${baseUrl}/api/images/styles/reindex`, {
      method: "POST", headers,
      body: JSON.stringify({ confirmation: "reindex-styles" }),
    });
    assert.equal(reindexed.status, 200);
    assert.deepEqual(calls, [["upload", "[화풍] 새빛.txt"], ["reindex"]]);
  });
});

test("화풍 다운로드는 기록된 TXT만 첨부로 제공한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-style-download-"));
  const target = path.join(root, "style.txt");
  await writeFile(target, "style prompt", "utf8");
  try {
    await withServer({
      async find(id) {
        return id === "고딕" ? { filename: "[화풍] 고딕.txt", size: 12, target } : null;
      },
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/images/styles/${encodeURIComponent("고딕")}/download`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-disposition"), /attachment/);
      assert.equal(await response.text(), "style prompt");
      assert.equal((await fetch(`${baseUrl}/api/images/styles/${encodeURIComponent("없음")}/download`)).status, 404);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

