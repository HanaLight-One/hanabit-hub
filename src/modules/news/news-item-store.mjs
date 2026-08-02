import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function validateId(id) {
  if (!/^[a-f0-9]{32}$/u.test(id)) throw new TypeError("안전한 뉴스 ID가 필요합니다.");
  return id;
}

async function exists(target) {
  try {
    await readFile(path.join(target, "item.json"), "utf8");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function createPendingNewsStore({ root }) {
  if (!path.isAbsolute(root)) throw new TypeError("뉴스 상태 루트는 절대경로여야 합니다.");
  const pendingRoot = path.join(root, "pending");

  function targetFor(id) {
    return path.join(pendingRoot, validateId(id));
  }

  async function has(id) {
    return exists(targetFor(id));
  }

  async function read(id) {
    return JSON.parse(await readFile(path.join(targetFor(id), "item.json"), "utf8"));
  }

  async function update(id, transform) {
    const safeId = validateId(id);
    const current = await read(safeId);
    const next = await transform(structuredClone(current));
    if (!next || next.id !== safeId) {
      throw new TypeError("뉴스 갱신 결과의 ID가 일치하지 않습니다.");
    }
    await writeJsonAtomic(path.join(targetFor(safeId), "item.json"), next);
    return next;
  }

  async function mediaFiles(id) {
    const safeId = validateId(id);
    const target = targetFor(safeId);
    const record = await read(safeId);
    return (Array.isArray(record.media) ? record.media : []).map((entry) => {
      const filename = path.basename(String(entry.file ?? ""));
      if (!/^[a-zA-Z0-9_-]+\.(gif|jpe?g|png|webp)$/u.test(filename)) {
        throw new TypeError("안전하지 않은 뉴스 미디어 이름입니다.");
      }
      return { target: path.join(target, "media", filename), filename };
    });
  }

  async function list({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new TypeError("뉴스 목록 상한이 올바르지 않습니다.");
    }
    let entries;
    try {
      entries = await readdir(pendingRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/u.test(entry.name)) continue;
      try {
        const record = await read(entry.name);
        if (record.id === entry.name) records.push(record);
      } catch {
        // 손상된 단일 항목이 자동 게시 후보 전체를 막지 않게 제외한다.
      }
    }
    records.sort((left, right) =>
      String(right.source?.publishedAt ?? right.collectedAt ?? "")
        .localeCompare(String(left.source?.publishedAt ?? left.collectedAt ?? "")),
    );
    return records.slice(0, limit);
  }

  async function create(record, { writeMedia = async () => [] } = {}) {
    const target = targetFor(record.id);
    if (await exists(target)) return { created: false, id: record.id };

    await mkdir(pendingRoot, { recursive: true });
    const temporary = path.join(pendingRoot, `.tmp-${record.id}-${randomUUID()}`);
    const mediaRoot = path.join(temporary, "media");

    try {
      await mkdir(mediaRoot, { recursive: true });
      const media = await writeMedia(mediaRoot);
      await writeFile(
        path.join(temporary, "item.json"),
        `${JSON.stringify({ ...record, media }, null, 2)}\n`,
        "utf8",
      );
      await rename(temporary, target);
      return { created: true, id: record.id, mediaCount: media.length };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (["EEXIST", "ENOTEMPTY"].includes(error.code) && (await exists(target))) {
        return { created: false, id: record.id };
      }
      throw error;
    }
  }

  return Object.freeze({ has, read, update, mediaFiles, list, create });
}
