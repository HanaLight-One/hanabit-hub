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

test("이미지 상세 API가 경로 없이 안전한 메타데이터를 제공한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-detail-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  await mkdir(path.join(daily, "2026-07-29"), { recursive: true });
  await writeFile(path.join(daily, "2026-07-29", "heila.png"), "image");
  const archive = createImageArchive({ dailyImagesRoot: daily });
  const imageId = (await archive.list()).images[0].id;

  await withServer(archive, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/${imageId}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.image.id, imageId);
    assert.equal(body.image.name, "heila.png");
    assert.equal(JSON.stringify(body).includes(root), false);
  });
});

test("이미지 상세 API가 잘못된 ID와 쓰기 요청을 거부한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-detail-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archive = createImageArchive({ dailyImagesRoot: root });

  await withServer(archive, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/images/not-an-image-id`);
    const write = await fetch(`${baseUrl}/api/images/${"a".repeat(64)}`, {
      method: "DELETE",
    });

    assert.equal(invalid.status, 400);
    assert.equal(write.status, 405);
  });
});
