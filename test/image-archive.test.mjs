import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-images-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  const pilot = path.join(root, "pilot");
  await mkdir(path.join(daily, "2026-07-29", "고딕"), { recursive: true });
  await mkdir(path.join(pilot, "테스트"), { recursive: true });
  await writeFile(path.join(daily, "2026-07-29", "고딕", "heila.png"), "daily");
  await writeFile(path.join(daily, "2026-07-29", "notes.txt"), "not an image");
  await writeFile(path.join(pilot, "테스트", "preview.webp"), "pilot");
  return { root, daily, pilot };
}

test("날짜별 이미지 목록을 경로 없이 반환한다", async (context) => {
  const { root, daily, pilot } = await fixture(context);
  const archive = createImageArchive({
    dailyImagesRoot: daily,
    pilotImagesRoot: pilot,
  });

  const result = await archive.list();
  const dailyImage = result.images.find((image) => image.source === "daily");

  assert.equal(result.images.length, 2);
  assert.equal(dailyImage.date, "2026-07-29");
  assert.equal(dailyImage.album, "2026-07-29");
  assert.equal(dailyImage.group, "고딕");
  assert.match(dailyImage.id, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal("relative" in dailyImage, false);
});

test("이미지 ID 기반 후속 API 주소를 제공한다", async (context) => {
  const { daily, pilot } = await fixture(context);
  const archive = createImageArchive({
    dailyImagesRoot: daily,
    pilotImagesRoot: pilot,
  });

  const { images } = await archive.list();
  for (const image of images) {
    assert.equal(image.contentUrl, `/api/images/${image.id}/content`);
    assert.match(
      image.thumbnailUrl,
      new RegExp(`^/api/images/${image.id}/thumbnail\\?v=\\d+$`),
    );
    assert.equal(image.downloadUrl, `/api/images/${image.id}/download`);
    assert.equal(
      image.productionRecordUrl,
      `/api/images/${image.id}/production-record`,
    );
  }
});

test("이미지 ID를 허용된 저장소 안의 파일로만 해석한다", async (context) => {
  const { root, daily, pilot } = await fixture(context);
  const archive = createImageArchive({
    dailyImagesRoot: daily,
    pilotImagesRoot: pilot,
  });
  const { images } = await archive.list();

  const resolved = await archive.find(images[0].id);

  assert.equal(resolved.record.id, images[0].id);
  assert.equal(resolved.target.startsWith(root), true);
  assert.equal("target" in images[0], false);
  await assert.rejects(() => archive.find("../secret"), /64자리/);
});

test("없는 저장소는 경로 대신 안전한 준비 상태만 반환한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-images-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archive = createImageArchive({
    dailyImagesRoot: path.join(root, "missing-daily"),
    pilotImagesRoot: path.join(root, "missing-pilot"),
  });

  const result = await archive.list();

  assert.deepEqual(result.images, []);
  assert.deepEqual(result.sources, {
    daily: { available: false },
    pilot: { available: false },
  });
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("상대 이미지 루트를 거부한다", () => {
  assert.throws(
    () =>
      createImageArchive({
        dailyImagesRoot: "relative/daily",
        pilotImagesRoot: "",
      }),
    /절대경로/,
  );
});
