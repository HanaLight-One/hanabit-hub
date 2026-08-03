import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const VIDEO_HOST = "video.twimg.com";
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_GIF_BYTES = 18 * 1024 * 1024;
const MAX_PREVIEW_SECONDS = 20;

function safeVideoUrl(value) {
  const target = new URL(String(value ?? ""));
  if (target.protocol !== "https:" || target.hostname !== VIDEO_HOST || !target.pathname.endsWith(".mp4")) {
    throw new Error("허용된 X 영상 주소가 아닙니다.");
  }
  return target;
}

async function downloadVideo(url, target, fetchImpl) {
  const response = await fetchImpl(safeVideoUrl(url), { redirect: "follow" });
  if (!response.ok) throw new Error("X 영상을 내려받지 못했습니다.");
  safeVideoUrl(response.url || url);
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error("X 영상이 변환 상한을 넘었습니다.");
  const contentType = String(response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  if (contentType && contentType !== "video/mp4" && contentType !== "application/octet-stream") {
    throw new Error("X 영상 형식이 MP4가 아닙니다.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_DOWNLOAD_BYTES) throw new Error("X 영상이 변환 상한을 넘었습니다.");
    chunks.push(chunk);
  }
  if (!size) throw new Error("X 영상이 비어 있습니다.");
  await writeFile(target, Buffer.concat(chunks, size));
}

function runFfmpeg(executablePath, args, { spawnImpl = spawn, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executablePath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("GIF 변환 시간이 초과되었습니다."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("GIF 변환에 실패했습니다."));
    });
  });
}

async function validateGif(target) {
  const info = await stat(target);
  if (!info.isFile() || info.size <= 16 || info.size > MAX_GIF_BYTES) {
    throw new Error("GIF 결과 크기가 허용 범위를 벗어났습니다.");
  }
  const signature = (await readFile(target)).subarray(0, 6).toString("ascii");
  if (!new Set(["GIF87a", "GIF89a"]).has(signature)) throw new Error("GIF 결과가 손상되었습니다.");
  return info.size;
}

async function convertAttempt({ input, output, executablePath, spawnImpl, width, fps, seconds }) {
  await rm(output, { force: true });
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
  await runFfmpeg(executablePath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-t", String(seconds),
    "-filter_complex", filter,
    "-loop", "0",
    output,
  ], { spawnImpl });
  return validateGif(output);
}

export function createXVideoPreviewService({
  executablePath = ffmpegPath,
  fetchImpl = fetch,
  spawnImpl = spawn,
} = {}) {
  async function prepare(record, { jobRoot }) {
    const video = record?.internal?.xVideo;
    if (!video?.variantUrl || !path.isAbsolute(jobRoot ?? "") || !path.isAbsolute(executablePath ?? "")) {
      return null;
    }
    await mkdir(jobRoot, { recursive: true });
    const input = path.join(jobRoot, "x-video-source.mp4");
    const output = path.join(jobRoot, "x-video-preview.gif");
    const seconds = Math.max(1, Math.min(MAX_PREVIEW_SECONDS, Math.ceil((Number(video.durationMs) || 0) / 1000) || MAX_PREVIEW_SECONDS));
    try {
      await downloadVideo(video.variantUrl, input, fetchImpl);
      let size;
      try {
        size = await convertAttempt({ input, output, executablePath, spawnImpl, width: 480, fps: 10, seconds });
      } catch {
        size = await convertAttempt({ input, output, executablePath, spawnImpl, width: 360, fps: 8, seconds: Math.min(seconds, 15) });
      }
      return { target: output, filename: "x-video-preview.gif", contentType: "image/gif", size };
    } catch {
      await rm(input, { force: true });
      await rm(output, { force: true });
      return null;
    }
  }

  async function cleanup({ jobRoot }) {
    if (!path.isAbsolute(jobRoot ?? "")) return;
    await Promise.all([
      rm(path.join(jobRoot, "x-video-source.mp4"), { force: true }),
      rm(path.join(jobRoot, "x-video-preview.gif"), { force: true }),
    ]);
  }

  return Object.freeze({ prepare, cleanup });
}

export function xVideoPreviewNotice(durationMs) {
  const duration = Number(durationMs) || 0;
  return duration > MAX_PREVIEW_SECONDS * 1000 || duration <= 0
    ? "첨부 GIF는 영상 앞부분 최대 20초를 변환한 소리 없는 미리보기입니다. 전체 영상과 음성은 상단 원문 링크에서 확인해 주세요."
    : "첨부 GIF는 소리 없는 미리보기입니다. 전체 영상과 음성은 상단 원문 링크에서 확인해 주세요.";
}

export const xVideoPreviewPolicy = Object.freeze({
  maxDownloadBytes: MAX_DOWNLOAD_BYTES,
  maxGifBytes: MAX_GIF_BYTES,
  maxPreviewSeconds: MAX_PREVIEW_SECONDS,
});
