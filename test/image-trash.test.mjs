import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";
import { createImageTrashService } from "../src/modules/images/image-trash.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-image-trash-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archiveRoot = path.join(root, "archive");
  const extraRoot = path.join(archiveRoot, "2026-08-02", "extra-requests", "free-play", "job");
  const dailyRoot = path.join(archiveRoot, "2026-08-02", "final");
  await mkdir(extraRoot, { recursive: true });
  await mkdir(dailyRoot, { recursive: true });
  await writeFile(path.join(extraRoot, "extra.png"), "extra");
  await writeFile(path.join(dailyRoot, "daily.png"), "daily");
  const archive = createImageArchive({ dailyImagesRoot: archiveRoot });
  const images = (await archive.list()).images;
  const deletedIds = [];
  const removedThumbnails = [];
  const service = createImageTrashService({
    archive,
    root: path.join(root, "trash"),
    enabled: true,
    recordStore: {
      async get(imageId) { return { imageId, characters: ["테스트"], style: "테스트 화풍" }; },
      deleteImage(imageId) { deletedIds.push(imageId); },
    },
    thumbnails: { async remove(imageId, modifiedAt) { removedThumbnails.push([imageId, modifiedAt]); } },
    now: () => new Date("2026-08-02T12:00:00.000Z"),
  });
  return {
    root,
    archive,
    service,
    extra: images.find((image) => image.name === "extra.png"),
    daily: images.find((image) => image.name === "daily.png"),
    deletedIds,
    removedThumbnails,
  };
}

test("추가 생성 이미지를 휴지통으로 옮긴 뒤 원래 위치로 복원한다", async (context) => {
  const { root, archive, service, extra } = await fixture(context);
  const original = (await archive.find(extra.id)).target;

  const item = await service.move(extra.id);
  assert.equal(await archive.find(extra.id), null);
  assert.equal(item.image.id, extra.id);
  assert.equal(JSON.stringify(item).includes(root), false);
  assert.equal((await service.list()).items.length, 1);

  const result = await service.restore(item.id);
  assert.deepEqual(result, { restored: true, imageId: extra.id });
  assert.equal(await readFile(original, "utf8"), "extra");
  assert.equal((await service.list()).items.length, 0);
});

test("오늘의 테마 본편은 휴지통 이동을 거부한다", async (context) => {
  const { service, daily } = await fixture(context);
  await assert.rejects(() => service.move(daily.id), (error) => error.code === "PROTECTED");
});

test("영구 삭제는 휴지통 파일과 DB 기록 및 썸네일 캐시를 제거한다", async (context) => {
  const { service, extra, deletedIds, removedThumbnails } = await fixture(context);
  const item = await service.move(extra.id);
  const content = await service.findContent(item.id);
  assert.ok((await stat(content.target)).isFile());

  assert.deepEqual(await service.permanentlyDelete(item.id), { deleted: true });
  assert.equal(await service.findContent(item.id), null);
  assert.deepEqual(deletedIds, [extra.id]);
  assert.equal(removedThumbnails[0][0], extra.id);
  assert.equal((await service.list()).items.length, 0);
});

test("allowlist가 꺼져 있으면 쓰기 작업을 거부한다", async (context) => {
  const { root, archive, extra } = await fixture(context);
  const disabled = createImageTrashService({ archive, root: path.join(root, "disabled"), enabled: false });
  assert.deepEqual(await disabled.list(), { enabled: false, items: [] });
  await assert.rejects(() => disabled.move(extra.id), (error) => error.code === "DISABLED");
});
