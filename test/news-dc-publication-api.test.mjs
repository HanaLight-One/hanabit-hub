import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";

const ID = "c".repeat(32);

async function withServer(service, callback) {
  const server = createServer({ newsDcPublicationService: service });
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

test("DC 원고 미리보기 API는 읽기만 수행한다", async () => {
  let previews = 0;
  await withServer({
    async preview(id) { previews += 1; return { id, title: "[공식] 뉴스", bodyText: "본문" }; },
    async publish() { throw new Error("not called"); },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/news/${ID}/dc-preview`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, "[공식] 뉴스");
    assert.equal(previews, 1);
  });
});

test("실제 DC 게시 API는 같은 출처와 정확한 확인값을 모두 요구한다", async () => {
  let publications = 0;
  await withServer({
    async preview() { return {}; },
    async publish(id) { publications += 1; return { id, publication: { status: "posted" } }; },
  }, async (baseUrl) => {
    const body = JSON.stringify({ confirmation: "publish-news-to-dc-now" });
    assert.equal((await fetch(`${baseUrl}/api/news/${ID}/dc-publication`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/news/${ID}/dc-publication`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ confirmation: "wrong" }),
    })).status, 400);
    const response = await fetch(`${baseUrl}/api/news/${ID}/dc-publication`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.equal(publications, 1);
  });
});

test("게시 코멘트 저장 API는 같은 출처와 정확한 확인값을 요구한다", async () => {
  let stored = null;
  await withServer({
    async preview() { return {}; },
    async saveEditorNote(id, note) { stored = { id, note }; return { id, editorNote: note }; },
  }, async (baseUrl) => {
    const target = `${baseUrl}/api/news/${ID}/dc-editor-note`;
    const body = JSON.stringify({ confirmation: "save-news-dc-editor-note", note: "ㅋㅋㅋ 뭐라는 거야" });
    assert.equal((await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 403);
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl, "sec-fetch-site": "same-origin" },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(stored, { id: ID, note: "ㅋㅋㅋ 뭐라는 거야" });
  });
});

test("DC 기본 커버 API는 고정된 커버만 읽기 전용으로 제공한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-cover-route-"));
  const target = path.join(root, "news.png");
  await writeFile(target, "png-cover", "utf8");
  try {
    await withServer({
      async findCover(id) {
        return id === "news"
          ? { target, size: 9, contentType: "image/png" }
          : null;
      },
    }, async (baseUrl) => {
      const found = await fetch(`${baseUrl}/api/news/dc-covers/news`);
      assert.equal(found.status, 200);
      assert.equal(found.headers.get("content-type"), "image/png");
      assert.equal(await found.text(), "png-cover");
      assert.equal((await fetch(`${baseUrl}/api/news/dc-covers/unknown`)).status, 404);
      assert.equal((await fetch(`${baseUrl}/api/news/dc-covers/news`, { method: "POST" })).status, 405);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
