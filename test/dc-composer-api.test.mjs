import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(composer, callback) {
  const server = createServer({ archive: null, dcComposer: composer });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("DC 편집실 API는 안전한 초기 상태와 같은 출처 업로드만 제공한다", async () => {
  const calls = [];
  const composer = {
    async status() { return { enabled: true, publisherReady: true, headTexts: ["잡담"] }; },
    async listUploads() { return []; },
    async latestDraft() { return null; },
    async upload(input) { calls.push([input.filename, input.contentType, input.buffer.toString()]); return { id: "a".repeat(32) }; },
  };
  await withServer(composer, async (baseUrl) => {
    const initial = await (await fetch(`${baseUrl}/api/dc/composer`)).json();
    assert.equal(initial.enabled, true);
    assert.deepEqual(initial.uploads, []);
    const denied = await fetch(`${baseUrl}/api/dc/uploads`, { method: "POST", headers: { "content-type": "image/png", "x-upload-filename": "test.png" }, body: "image" });
    assert.equal(denied.status, 403);
    const accepted = await fetch(`${baseUrl}/api/dc/uploads`, { method: "POST", headers: { "content-type": "image/png", "x-upload-filename": "test.png", origin: baseUrl, "sec-fetch-site": "same-origin" }, body: "image" });
    assert.equal(accepted.status, 201);
    assert.deepEqual(calls, [["test.png", "image/png", "image"]]);
  });
});

test("DC 실제 게시 API는 미리보기와 별개로 정확한 확인값을 요구한다", async () => {
  const calls = [];
  const id = "b".repeat(32);
  const composer = {
    async preview(value) { return { id: value, canPublish: true }; },
    async publish(value) { calls.push(value); return { id: value, publication: { status: "posted" } }; },
  };
  await withServer(composer, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/dc/drafts/${id}/preview`)).status, 200);
    const headers = { "content-type": "application/json", origin: baseUrl, "sec-fetch-site": "same-origin" };
    const denied = await fetch(`${baseUrl}/api/dc/drafts/${id}/publish`, { method: "POST", headers, body: JSON.stringify({ confirmation: "preview-only" }) });
    assert.equal(denied.status, 400);
    const accepted = await fetch(`${baseUrl}/api/dc/drafts/${id}/publish`, { method: "POST", headers, body: JSON.stringify({ confirmation: "publish-dc-compose-now" }) });
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls, [id]);
  });
});
