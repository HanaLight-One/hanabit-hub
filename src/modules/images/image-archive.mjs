import crypto from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const IMAGE_ID_PATTERN = /^[a-f0-9]{64}$/;
const SOURCES = Object.freeze(["daily", "pilot"]);

function imageId(source, relative) {
  return crypto.createHash("sha256").update(`${source}:${relative}`).digest("hex");
}

function publicUrls(id, modifiedAtMs) {
  const encodedId = encodeURIComponent(id);
  return Object.freeze({
    contentUrl: `/api/images/${encodedId}/content`,
    thumbnailUrl: `/api/images/${encodedId}/thumbnail?v=${Math.trunc(modifiedAtMs)}`,
    downloadUrl: `/api/images/${encodedId}/download`,
    productionRecordUrl: `/api/images/${encodedId}/production-record`,
  });
}

function classify(relative) {
  const parts = relative.split("/");
  const album = parts[0] || "기타";
  const date = album.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const group = parts.length > 2 ? parts[1] : "미리보기";
  const category =
    group !== "extra-requests"
      ? "daily-theme"
      : parts[2] === "theme-followup"
        ? "theme-extra"
        : parts[2] === "free-play"
          ? "free-extra"
          : "legacy-extra";
  return { date, album, group, category };
}

async function walkImages(root, source) {
  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
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
          storageKey: relative,
          extension: path.extname(entry.name).toLowerCase(),
          publicRecord: Object.freeze({
          id,
          source,
          name: entry.name,
          modifiedAt: info.mtime.toISOString(),
          size: info.size,
          ...classify(relative),
          ...publicUrls(id, info.mtimeMs),
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

function uniqueRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    if (!root) return false;
    const normalized = path.resolve(root).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function createImageArchive({
  dailyImagesRoot,
  dailyImagesRoots = [],
  pilotImagesRoot,
}) {
  if (!Array.isArray(dailyImagesRoots)) {
    throw new TypeError("dailyImagesRoots는 배열이어야 합니다.");
  }

  const roots = {
    daily: uniqueRoots([...dailyImagesRoots, dailyImagesRoot]),
    pilot: uniqueRoots([pilotImagesRoot]),
  };

  for (const source of SOURCES) {
    for (const root of roots[source]) {
      if (!path.isAbsolute(root)) {
        throw new TypeError(`${source} 이미지 루트는 절대경로여야 합니다.`);
      }
    }
  }

  async function list() {
    const inspections = await Promise.all(
      SOURCES.map(async (source) => [
        source,
        await Promise.all(
          roots[source].map(async (root) => ({
            root,
            inspection: await inspectRoot(root),
          })),
        ),
      ]),
    );
    const sourceStates = Object.fromEntries(
      inspections.map(([source, rootInspections]) => [
        source,
        Object.freeze({
          available: rootInspections.some(({ inspection }) => inspection.available),
        }),
      ]),
    );
    const imageGroups = await Promise.all(
      inspections.flatMap(([source, rootInspections]) =>
        rootInspections.map(({ root, inspection }) =>
          inspection.available ? walkImages(root, source) : inspection.images,
        ),
      ),
    );

    const entriesById = new Map();
    for (const entry of imageGroups.flat()) {
      if (!entriesById.has(entry.publicRecord.id)) {
        entriesById.set(entry.publicRecord.id, entry);
      }
    }
    const entries = [...entriesById.values()];
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
      for (const root of roots[source]) {
        const inspection = await inspectRoot(root);
        if (!inspection.available) continue;
        const entries = await walkImages(root, source);
        const match = entries.find((entry) => entry.publicRecord.id === id);
        if (match) {
          return Object.freeze({
            target: match.target,
            storageKey: match.storageKey,
            extension: match.extension,
            record: match.publicRecord,
          });
        }
      }
    }
    return null;
  }

  async function findByTarget(target) {
    if (!path.isAbsolute(target ?? "")) return null;
    const resolvedTarget = path.resolve(target).toLowerCase();
    for (const source of SOURCES) {
      for (const root of roots[source]) {
        const inspection = await inspectRoot(root);
        if (!inspection.available) continue;
        const entries = await walkImages(root, source);
        const match = entries.find(
          (entry) => path.resolve(entry.target).toLowerCase() === resolvedTarget,
        );
        if (match) {
          return Object.freeze({
            target: match.target,
            storageKey: match.storageKey,
            extension: match.extension,
            record: match.publicRecord,
          });
        }
      }
    }
    return null;
  }

  async function listIndexable() {
    const entriesById = new Map();
    for (const source of SOURCES) {
      for (const root of roots[source]) {
        const inspection = await inspectRoot(root);
        if (!inspection.available) continue;
        for (const entry of await walkImages(root, source)) {
          if (!entriesById.has(entry.publicRecord.id)) {
            entriesById.set(entry.publicRecord.id, Object.freeze({
              storageKey: entry.storageKey,
              record: entry.publicRecord,
            }));
          }
        }
      }
    }
    return Object.freeze([...entriesById.values()]);
  }

  return Object.freeze({ find, findByTarget, list, listIndexable });
}
