import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createXVideoPreviewService, xVideoPreviewNotice, xVideoPreviewPolicy } from "../src/modules/news/x-video-preview.mjs";

function fakeSpawn(_executable, args) {
  const child = new EventEmitter();
  child.kill = () => {};
  const output = args.at(-1);
  queueMicrotask(async () => {
    await writeFile(output, Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]));
    child.emit("close", 0);
  });
  return child;
}

test("X MP4를 격리 GIF로 만들고 게시 성공 뒤 두 임시 파일을 지운다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-x-video-"));
  try {
    const service = createXVideoPreviewService({
      executablePath: path.join(root, "ffmpeg.exe"),
      spawnImpl: fakeSpawn,
      async fetchImpl() {
        return new Response(Buffer.from("safe-mp4-fixture"), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      },
    });
    const result = await service.prepare({
      internal: { xVideo: { variantUrl: "https://video.twimg.com/a/video.mp4", durationMs: 4_000 } },
    }, { jobRoot: root });
    assert.equal(result.filename, "x-video-preview.gif");
    assert.equal((await readFile(result.target)).subarray(0, 6).toString("ascii"), "GIF89a");
    await service.cleanup({ jobRoot: root });
    await assert.rejects(() => stat(path.join(root, "x-video-source.mp4")), { code: "ENOENT" });
    await assert.rejects(() => stat(path.join(root, "x-video-preview.gif")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("허용되지 않은 영상 주소는 변환하지 않고 기존 이미지 폴백을 유지한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-x-video-"));
  try {
    let downloads = 0;
    const service = createXVideoPreviewService({
      executablePath: path.join(root, "ffmpeg.exe"),
      spawnImpl: fakeSpawn,
      async fetchImpl() { downloads += 1; },
    });
    const result = await service.prepare({
      internal: { xVideo: { variantUrl: "https://example.com/video.mp4" } },
    }, { jobRoot: root });
    assert.equal(result, null);
    assert.equal(downloads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GIF 안내는 실제 영상 길이에 따라 전체 또는 최대 60초 미리보기로 구분한다", () => {
  assert.equal(xVideoPreviewPolicy.maxPreviewSeconds, 60);
  assert.doesNotMatch(xVideoPreviewNotice(59_000), /최대 60초/u);
  assert.match(xVideoPreviewNotice(61_000), /앞부분 최대 60초/u);
  assert.match(xVideoPreviewNotice(0), /앞부분 최대 60초/u);
  assert.match(xVideoPreviewNotice(59_000), /소리 없는 미리보기/u);
  assert.match(xVideoPreviewNotice(59_000), /상단 원문 링크/u);
});
