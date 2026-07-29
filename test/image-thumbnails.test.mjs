import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";
import { createImageThumbnailService } from "../src/modules/images/image-thumbnails.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-thumbnails-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  const pilot = path.join(root, "pilot");
  const cache = path.join(root, "state", "thumbnails", "hub-v1");
  await mkdir(path.join(daily, "2026-07-29"), { recursive: true });
  await mkdir(pilot, { recursive: true });
  await sharp({
    create: {
      width: 800,
      height: 600,
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
  return { archive, cache, root };
}

test("원본을 변경하지 않고 격리된 WebP 썸네일을 생성한다", async (context) => {
  const { archive, cache, root } = await fixture(context);
  const thumbnails = createImageThumbnailService({ archive, cacheRoot: cache });
  const { images } = await archive.list();

  const first = await thumbnails.ensure(images[0].id);
  const second = await thumbnails.ensure(images[0].id);
  const metadata = await sharp(await readFile(first.target)).metadata();

  assert.equal(first.target, second.target);
  assert.equal(first.target.startsWith(cache), true);
  assert.equal(first.target.startsWith(path.join(root, "daily")), false);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width <= 480, true);
  assert.equal(metadata.height <= 480, true);
});

test("상대 썸네일 캐시 루트를 거부한다", async (context) => {
  const { archive } = await fixture(context);

  assert.throws(
    () => createImageThumbnailService({ archive, cacheRoot: "state/thumbnails" }),
    /절대경로/,
  );
});

test("없는 이미지 ID에는 썸네일을 만들지 않는다", async (context) => {
  const { archive, cache } = await fixture(context);
  const thumbnails = createImageThumbnailService({ archive, cacheRoot: cache });

  assert.equal(await thumbnails.ensure("0".repeat(64)), null);
});
