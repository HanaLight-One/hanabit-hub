import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createThemeThumbnailManager } from "../src/modules/images/theme-thumbnails.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-theme-thumbnails-"));
  const assetRoot = path.join(root, "assets");
  await mkdir(assetRoot);
  const png = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#ccff33" } }).png().toBuffer();
  await Promise.all([1, 2, 3].map((number) => writeFile(path.join(assetRoot, `${number}.png`), png)));
  const paths = {
    historyPath: path.join(root, "state", "daily-thumbnail-history.json"),
    catalogPath: path.join(root, "state", "daily-thumbnail-catalog.json"),
    forcedPath: path.join(root, "state", "daily-thumbnail-forced.json"),
  };
  const manager = createThemeThumbnailManager({
    assetRoot, ...paths, enabled: true,
    now: () => new Date("2026-08-02T03:00:00Z"),
  });
  return { root, assetRoot, paths, manager, png };
}

test("썸네일 목록은 기본 가중치와 안전한 미리보기 URL만 반환한다", async () => {
  const { root, assetRoot, manager } = await fixture();
  try {
    const result = await manager.state();
    assert.equal(result.today, "2026-08-02");
    assert.equal(result.assets.length, 3);
    assert.equal(result.assets[0].weight, 1);
    assert.equal(result.assets[0].previewUrl, "/api/images/theme-thumbnails/1.png/content");
    assert.equal(JSON.stringify(result).includes(assetRoot), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("설정 변경과 날짜별 강제 선택을 별도 상태 파일에 저장한다", async () => {
  const { root, paths, manager } = await fixture();
  try {
    await manager.update("2.png", { label: "크리스마스", weight: 0 });
    await assert.rejects(() => manager.force("2026-02-30", "2.png"), /YYYY-MM-DD/);
    const result = await manager.force("2026-12-25", "2.png");
    assert.deepEqual(result.forced.find((item) => item.date === "2026-12-25"), { date: "2026-12-25", filename: "2.png" });
    const catalog = JSON.parse(await readFile(paths.catalogPath, "utf8"));
    assert.deepEqual(catalog.assets["2.png"], { label: "크리스마스", weight: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("업로드는 실제 PNG를 확인하고 다음 숫자 파일명으로 저장한다", async () => {
  const { root, assetRoot, manager, png } = await fixture();
  try {
    const result = await manager.upload({ buffer: png, label: "만우절" });
    assert.equal(result.filename, "4.png");
    assert.equal(result.assets.find((asset) => asset.filename === "4.png").label, "만우절");
    await assert.rejects(() => manager.upload({ buffer: Buffer.from("not png"), label: "bad" }), /PNG/);
    assert.equal((await readFile(path.join(assetRoot, "4.png"))).equals(png), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("오늘 선택되었거나 미래에 예약된 썸네일 삭제를 막는다", async () => {
  const { root, paths, manager } = await fixture();
  try {
    await mkdir(path.dirname(paths.historyPath), { recursive: true });
    await writeFile(paths.historyPath, JSON.stringify({ version: 1, selections: [{ date: "2026-08-02", filename: "1.png" }] }));
    await manager.force("2026-12-25", "2.png");
    await assert.rejects(() => manager.remove("1.png"), /오늘/);
    await assert.rejects(() => manager.remove("2.png"), /예약/);
    const result = await manager.remove("3.png");
    assert.equal(result.deleted, true);
    assert.equal(result.assets.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
