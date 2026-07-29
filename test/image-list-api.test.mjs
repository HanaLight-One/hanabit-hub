import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";

async function withServer(archive, callback) {
  const server = createServer({ archive });
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

test("이미지 목록 API가 안전한 읽기 전용 응답을 제공한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-list-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  const pilot = path.join(root, "pilot");
  await mkdir(path.join(daily, "2026-07-29"), { recursive: true });
  await mkdir(pilot, { recursive: true });
  await writeFile(path.join(daily, "2026-07-29", "heila.png"), "image");
  const archive = createImageArchive({
    dailyImagesRoot: daily,
    pilotImagesRoot: pilot,
  });

  await withServer(archive, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.images.length, 1);
    assert.equal(body.images[0].date, "2026-07-29");
    assert.equal(JSON.stringify(body).includes(root), false);
  });
});

test("이미지 목록 API는 쓰기 요청을 거부한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-list-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archive = createImageArchive({
    dailyImagesRoot: root,
    pilotImagesRoot: root,
  });

  await withServer(archive, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images`, { method: "DELETE" });
    assert.equal(response.status, 405);
  });
});

test("이미지 연동이 없으면 목록 기능을 노출하지 않는다", async () => {
  await withServer(null, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, "Not found");
  });
});
