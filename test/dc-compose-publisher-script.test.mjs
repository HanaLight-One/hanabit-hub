import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { validateComposeJob, composeInlineContent } = require("../scripts/publish-dc-compose.cjs");

test("DC 편집기는 기존 하나빛 계정 변수를 유지한다", () => {
  const source = readFileSync(new URL("../scripts/publish-dc-compose.cjs", import.meta.url), "utf8");
  assert.match(source, /process\.env\.DC_ID/u);
  assert.match(source, /process\.env\.DC_PW/u);
  assert.doesNotMatch(source, /DC_ADMIN_BLUE_BADGE/u);
});

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

    const media = [];
    for (let index = 1; index <= 50; index += 1) {
      const filename = `${String(index).padStart(2, "0")}.png`;
      const target = path.join(mediaRoot, filename);
      const contents = `image-${index}`;
      await writeFile(target, contents);
      media.push({ path: target, filename, contentType: "image/png", sha256: createHash("sha256").update(contents).digest("hex") });
    }
    const blocks = [{ type: "text", text: "시작" }];
    for (let index = 0; index < media.length; index += 1) {
      blocks.push({ type: "image", mediaIndex: index }, { type: "text", text: `${index + 1}번 설명` });
    }
    const fifty = { ...value, schemaVersion: 2, bodyText: blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n\n"), blocks, media };
    fifty.contentHash = createHash("sha256").update(JSON.stringify({
      headText: fifty.headTextName,
      title: fifty.title,
      bodyText: fifty.bodyText,
      blocks,
      media: media.map(({ filename, sha256 }) => ({ filename, sha256 })),
    })).digest("hex");
    assert.equal(validateComposeJob(fifty, jobPath).media.length, 50);
    assert.throws(() => validateComposeJob({ ...fifty, media: [...media, {}] }, jobPath), /INVALID_MEDIA/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("혼합 원고는 이미지 표식을 본문 사이에 정확한 순서로 만든다", async () => {
  const job = {
    schemaVersion: 2,
    bodyText: "첫 문단\n\n끝 문단",
    media: [{}, {}],
    blocks: [
      { type: "text", text: "첫 문단" },
      { type: "image", mediaIndex: 0 },
      { type: "text", text: "중간 문단" },
      { type: "image", mediaIndex: 1 },
      { type: "text", text: "끝 문단" },
    ],
  };
  const composed = composeInlineContent(job);
  assert.equal(composed.imagePosition, "inline");
  assert.match(composed.content, /첫 문단[\s\S]*\{\{DC_IMAGE_1\}\}[\s\S]*중간 문단[\s\S]*\{\{DC_IMAGE_2\}\}[\s\S]*끝 문단/u);
  assert.throws(() => composeInlineContent({ ...job, blocks: [...job.blocks, { type: "image", mediaIndex: 1 }] }), /INVALID_BLOCKS/u);
});
