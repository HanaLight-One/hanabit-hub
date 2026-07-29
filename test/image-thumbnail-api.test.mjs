import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createServer } from "../src/server.mjs";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";
import { createImageThumbnailService } from "../src/modules/images/image-thumbnails.mjs";

async function withServer(thumbnails, callback) {
  const server = createServer({ thumbnails });
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

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-thumbnail-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  const pilot = path.join(root, "pilot");
  const cache = path.join(root, "state", "thumbnails", "hub-v1");
  await mkdir(path.join(daily, "2026-07-29"), { recursive: true });
  await mkdir(pilot, { recursive: true });
  await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: "#d8ff52",
    },
  })
    .png()
    .toFile(path.join(daily, "2026-07-29", "heila.png"));
  const archive = createImageArchive({
    dailyImagesRoot: daily,
    pilotImagesRoot: pilot,
  });
  const thumbnails = createImageThumbnailService({ archive, cacheRoot: cache });
  return { archive, root, thumbnails };
}

test("이미지 ID로 WebP 썸네일을 제공한다", async (context) => {
  const { archive, root, thumbnails } = await fixture(context);
  const { images } = await archive.list();

  await withServer(thumbnails, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${images[0].thumbnailUrl}`);
    const body = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(body).metadata();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(metadata.format, "webp");
    assert.equal(
      response.headers.get("cache-control"),
      "private, max-age=31536000, immutable",
    );
    assert.equal([...response.headers.values()].join(" ").includes(root), false);
  });
});

test("썸네일 API는 잘못된 ID와 쓰기 요청을 거부한다", async (context) => {
  const { archive, thumbnails } = await fixture(context);
  const { images } = await archive.list();

  await withServer(thumbnails, async (baseUrl) => {
    const invalid = await fetch(
      `${baseUrl}/api/images/${encodeURIComponent("../secret")}/thumbnail`,
    );
    const write = await fetch(`${baseUrl}${images[0].thumbnailUrl}`, {
      method: "DELETE",
    });

    assert.equal(invalid.status, 400);
    assert.equal(write.status, 405);
  });
});
