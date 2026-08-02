import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const MAX_BYTES = 20 * 1024 * 1024;
const FORMATS = Object.freeze({ png: ".png", jpeg: ".jpg", webp: ".webp" });

function uploadError(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeStem(value) {
  const source = path.parse(String(value ?? "image").normalize("NFC")).name;
  const cleaned = source.replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/\s+/gu, "-")
    .replace(/-+/gu, "-").replace(/^[._ -]+|[._ -]+$/gu, "").slice(0, 50);
  return cleaned || "image";
}

function seoulDate(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function createSourceUploadManager({ root, archive, enabled = false, now = () => new Date() }) {
  if (!path.isAbsolute(root ?? "")) throw new TypeError("소스 업로드 루트는 절대경로여야 합니다.");
  if (!archive) throw new TypeError("이미지 아카이브가 필요합니다.");

  async function upload({ buffer, originalName }) {
    if (!enabled) throw uploadError("DISABLED", "소스 이미지 업로드가 잠겨 있어요.");
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_BYTES) {
      throw uploadError("INVALID_UPLOAD", "20MB 이하 PNG, JPG 또는 WebP 이미지를 선택해 주세요.");
    }
    const metadata = await sharp(buffer).metadata().catch(() => null);
    const extension = FORMATS[metadata?.format];
    if (!extension || !metadata.width || !metadata.height) {
      throw uploadError("INVALID_UPLOAD", "실제 PNG, JPG 또는 WebP 이미지만 업로드할 수 있어요.");
    }
    const date = seoulDate(now());
    const filename = `${safeStem(originalName)}-${randomUUID().slice(0, 8)}${extension}`;
    const directory = path.join(root, date);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), buffer, { flag: "wx" });
    const listing = await archive.list();
    const image = listing.images.find((item) => item.source === "upload" && item.name === filename);
    if (!image) throw uploadError("INDEX_FAILED", "업로드 이미지를 소스 보관함에서 확인하지 못했어요.");
    return Object.freeze({ uploaded: true, image });
  }

  return Object.freeze({ upload });
}

