import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { validateComposeJob } = require("../scripts/publish-dc-compose.cjs");

test("일반 DC 게시자는 격리 작업 폴더의 정확한 첨부와 내용 해시만 허용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-dc-job-"));
  try {
    const id = "a".repeat(32);
    const jobRoot = path.join(root, "publication-jobs", id);
    const mediaRoot = path.join(jobRoot, "media");
    const mediaPath = path.join(mediaRoot, "01.png");
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(mediaPath, "image");
    const mediaHash = createHash("sha256").update("image").digest("hex");
    const value = {
      schemaVersion: 1, id, galleryId: "chatgpt", headTextName: "AI창작",
      title: "제목", bodyText: "본문",
      media: [{ path: mediaPath, filename: "01.png", contentType: "image/png", sha256: mediaHash }],
      resultPath: path.join(jobRoot, "result.json"),
    };
    value.contentHash = createHash("sha256").update(JSON.stringify({ headText: value.headTextName, title: value.title, bodyText: value.bodyText, media: [{ filename: "01.png", sha256: mediaHash }] })).digest("hex");
    const jobPath = path.join(jobRoot, "job.json");
    assert.equal(validateComposeJob(value, jobPath).title, "제목");
    assert.throws(() => validateComposeJob({ ...value, title: "바뀐 제목" }, jobPath), /CONTENT_CHANGED/u);
    assert.throws(() => validateComposeJob({ ...value, media: [{ ...value.media[0], path: path.join(root, "outside.png") }] }, jobPath), /INVALID_MEDIA/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
