import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

export function createPendingNewsStore({ root }) {
  if (!path.isAbsolute(root)) throw new TypeError("뉴스 상태 루트는 절대경로여야 합니다.");
  const pendingRoot = path.join(root, "pending");

  function targetFor(id) {
    return path.join(pendingRoot, validateId(id));
  }

  async function has(id) {
    return exists(targetFor(id));
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

  return Object.freeze({ has, create });
}
