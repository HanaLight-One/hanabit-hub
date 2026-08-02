import crypto from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export function createImageThumbnailService({
  archive,
  cacheRoot,
  width = 480,
  height = 480,
}) {
  if (!archive || typeof archive.find !== "function") {
    throw new TypeError("이미지 아카이브가 필요합니다.");
  }
  if (!path.isAbsolute(cacheRoot)) {
    throw new TypeError("썸네일 캐시 루트는 절대경로여야 합니다.");
  }

  const resolvedCacheRoot = path.resolve(cacheRoot);
  const jobs = new Map();

  async function cachedThumbnail(target) {
    try {
      const info = await stat(target);
      return info.isFile() && info.size > 0 ? { target, size: info.size } : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function ensure(imageId) {
    const image = await archive.find(imageId);
    if (!image) return null;

    const cacheKey = crypto
      .createHash("sha256")
      .update(`${image.record.id}:${image.record.modifiedAt}`)
      .digest("hex");
    const directory = path.join(resolvedCacheRoot, cacheKey.slice(0, 2));
    const target = path.join(directory, `${cacheKey}.webp`);
    const cached = await cachedThumbnail(target);
    if (cached) return Object.freeze(cached);

    if (!jobs.has(cacheKey)) {
      const job = (async () => {
        await mkdir(directory, { recursive: true });
        const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
          await sharp(image.target)
            .rotate()
            .resize({ width, height, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 72, effort: 4 })
            .toFile(temporary);
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
        return cachedThumbnail(target);
      })().finally(() => jobs.delete(cacheKey));
      jobs.set(cacheKey, job);
    }

    return Object.freeze(await jobs.get(cacheKey));
  }

  async function remove(imageId, modifiedAt) {
    const cacheKey = crypto
      .createHash("sha256")
      .update(`${imageId}:${modifiedAt}`)
      .digest("hex");
    await rm(path.join(resolvedCacheRoot, cacheKey.slice(0, 2), `${cacheKey}.webp`), {
      force: true,
    });
  }

  return Object.freeze({ ensure, remove });
}
