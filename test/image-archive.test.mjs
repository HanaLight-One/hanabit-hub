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
  assert.equal(dailyImage.category, "daily-theme");
  assert.match(dailyImage.id, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal("relative" in dailyImage, false);
});

test("추가 생성 목적과 기존 출력을 이동 없이 분류한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-image-category-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  const files = [
    ["theme-followup", "theme.png"],
    ["free-play", "free.png"],
  ];
  for (const [purpose, name] of files) {
    const directory = path.join(daily, "2026-08-01", "extra-requests", purpose, "job");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, name), purpose);
  }
  const legacy = path.join(daily, "2026-08-01", "extra-requests", "legacy-job");
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, "legacy.png"), "legacy");

  const result = await createImageArchive({ dailyImagesRoot: daily }).list();
  assert.equal(result.images.find((image) => image.name === "theme.png").category, "theme-extra");
  assert.equal(result.images.find((image) => image.name === "free.png").category, "free-extra");
  assert.equal(result.images.find((image) => image.name === "legacy.png").category, "legacy-extra");
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

test("신규·기존 날짜별 저장소를 합치고 같은 이미지는 신규 저장소를 우선한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-images-layered-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const primary = path.join(root, "daily-v2");
  const legacy = path.join(root, "daily-images");
  const relative = path.join("2026-07-30", "고딕", "01.png");
  await mkdir(path.dirname(path.join(primary, relative)), { recursive: true });
  await mkdir(path.dirname(path.join(legacy, relative)), { recursive: true });
  await mkdir(path.join(legacy, "2026-07-29"), { recursive: true });
  await writeFile(path.join(primary, relative), "primary");
  await writeFile(path.join(legacy, relative), "legacy");
  await writeFile(path.join(legacy, "2026-07-29", "legacy.png"), "legacy-only");

  const archive = createImageArchive({
    dailyImagesRoots: [primary, legacy],
  });
  const result = await archive.list();
  const shared = result.images.find((image) => image.name === "01.png");
  const resolved = await archive.find(shared.id);

  assert.equal(result.images.length, 2);
  assert.equal(resolved.target.startsWith(primary), true);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("내부 점 폴더의 이미지 산출물을 아카이브에서 제외한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-images-hidden-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  await mkdir(path.join(daily, "2026-07-30", ".responses-artifacts"), {
    recursive: true,
  });
  await mkdir(path.join(daily, "2026-07-30", "final"), { recursive: true });
  await writeFile(
    path.join(daily, "2026-07-30", ".responses-artifacts", "01.png"),
    "internal",
  );
  await writeFile(path.join(daily, "2026-07-30", "final", "01.png"), "final");

  const archive = createImageArchive({ dailyImagesRoots: [daily] });
  const result = await archive.list();

  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].group, "final");
});
