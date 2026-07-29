import crypto from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const IMAGE_ID_PATTERN = /^[a-f0-9]{64}$/;
const SOURCES = Object.freeze(["daily", "pilot"]);

function imageId(source, relative) {
  return crypto.createHash("sha256").update(`${source}:${relative}`).digest("hex");
}

function publicUrls(id) {
  const encodedId = encodeURIComponent(id);
  return Object.freeze({
    contentUrl: `/api/images/${encodedId}/content`,
    thumbnailUrl: `/api/images/${encodedId}/thumbnail`,
    downloadUrl: `/api/images/${encodedId}/download`,
    productionRecordUrl: `/api/images/${encodedId}/production-record`,
  });
}

function classify(relative) {
  const parts = relative.split("/");
  const album = parts[0] || "기타";
  const date = album.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const group = parts.length > 2 ? parts[1] : "미리보기";
  return { date, album, group };
}

async function walkImages(root, source) {
  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".trash") continue;
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const info = await stat(fullPath);
      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      const id = imageId(source, relative);
      results.push(
        Object.freeze({
          target: fullPath,
          extension: path.extname(entry.name).toLowerCase(),
          publicRecord: Object.freeze({
          id,
          source,
          name: entry.name,
          modifiedAt: info.mtime.toISOString(),
          size: info.size,
          ...classify(relative),
          ...publicUrls(id),
          }),
        }),
      );
    }
  }

  return results;
}

async function inspectRoot(root) {
  if (!root) return { available: false, images: [] };

  try {
    const info = await stat(root);
    if (!info.isDirectory()) return { available: false, images: [] };
    return { available: true, images: null };
  } catch (error) {
    if (error.code === "ENOENT") return { available: false, images: [] };
    throw error;
  }
}

export function createImageArchive({ dailyImagesRoot, pilotImagesRoot }) {
  const roots = {
    daily: dailyImagesRoot,
    pilot: pilotImagesRoot,
  };

  for (const source of SOURCES) {
    if (roots[source] && !path.isAbsolute(roots[source])) {
      throw new TypeError(`${source} 이미지 루트는 절대경로여야 합니다.`);
    }
  }

  async function list() {
    const inspections = await Promise.all(
      SOURCES.map(async (source) => [source, await inspectRoot(roots[source])]),
    );
    const sourceStates = Object.fromEntries(
      inspections.map(([source, inspection]) => [
        source,
        Object.freeze({ available: inspection.available }),
      ]),
    );
    const imageGroups = await Promise.all(
      inspections.map(([source, inspection]) =>
        inspection.available ? walkImages(roots[source], source) : inspection.images,
      ),
    );

    const entries = imageGroups.flat();
    const images = entries
      .map((entry) => entry.publicRecord)
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));

    return Object.freeze({
      images: Object.freeze(images),
      sources: Object.freeze(sourceStates),
    });
  }

  async function find(id) {
    if (!IMAGE_ID_PATTERN.test(id)) {
      throw new TypeError("imageId는 64자리 소문자 16진수여야 합니다.");
    }

    for (const source of SOURCES) {
      const inspection = await inspectRoot(roots[source]);
      if (!inspection.available) continue;
      const entries = await walkImages(roots[source], source);
      const match = entries.find((entry) => entry.publicRecord.id === id);
      if (match) {
        return Object.freeze({
          target: match.target,
          extension: match.extension,
          record: match.publicRecord,
        });
      }
    }
    return null;
  }

  return Object.freeze({ find, list });
}
