import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";
import { createSourceUploadManager } from "../src/modules/images/source-uploads.mjs";

test("직접 업로드한 이미지는 오테와 분리된 소스 보관함에 저장된다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-source-upload-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const uploadRoot = path.join(root, "uploads");
  const archive = createImageArchive({ sourceUploadsRoot: uploadRoot });
  const manager = createSourceUploadManager({
    root: uploadRoot,
    archive,
    enabled: true,
    now: () => new Date("2026-08-02T12:00:00+09:00"),
  });
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#ff66aa" },
  }).png().toBuffer();

  const result = await manager.upload({ buffer, originalName: "내 참조 이미지.png" });

  assert.equal(result.uploaded, true);
  assert.equal(result.image.source, "upload");
  assert.equal(result.image.category, "source-upload");
  assert.equal(result.image.date, "2026-08-02");
  assert.equal(result.image.group, "직접 업로드");
  assert.equal("target" in result.image, false);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test("이미지가 아닌 바이트는 직접 소스로 업로드할 수 없다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-source-upload-invalid-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archive = createImageArchive({ sourceUploadsRoot: root });
  const manager = createSourceUploadManager({ root, archive, enabled: true });

  await assert.rejects(
    () => manager.upload({ buffer: Buffer.from("not an image"), originalName: "fake.png" }),
    (error) => error.code === "INVALID_UPLOAD",
  );
});
