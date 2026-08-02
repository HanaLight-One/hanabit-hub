import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const EXTRA_CATEGORIES = new Set(["theme-extra", "free-extra", "legacy-extra", "source-upload"]);
const TRASH_ID_PATTERN = /^[a-f0-9]{32}$/u;

function operationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function publicItem(receipt) {
  return Object.freeze({
    id: receipt.id,
    imageId: receipt.imageId,
    trashedAt: receipt.trashedAt,
    image: Object.freeze({
      ...receipt.image,
      contentUrl: `/api/images/trash/${receipt.id}/content`,
    }),
    productionRecord: receipt.productionRecord ?? null,
  });
}

export function createImageTrashService({
  archive,
  root,
  recordStore = null,
  thumbnails = null,
  enabled = false,
  now = () => new Date(),
}) {
  if (!archive?.find || !archive?.containsTarget) throw new TypeError("이미지 아카이브가 필요합니다.");
  if (!path.isAbsolute(root ?? "")) throw new TypeError("휴지통 루트는 절대경로여야 합니다.");

  const receiptRoot = path.join(root, "receipts");
  const fileRoot = path.join(root, "files");
  const receiptPath = (id) => path.join(receiptRoot, `${id}.json`);
  const filePath = (id, extension) => path.join(fileRoot, `${id}${extension}`);

  async function readReceipt(id) {
    if (!TRASH_ID_PATTERN.test(id ?? "")) throw operationError("INVALID_ID", "올바르지 않은 휴지통 항목입니다.");
    try {
      return JSON.parse(await readFile(receiptPath(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function list() {
    if (!enabled) return { enabled: false, items: [] };
    let entries;
    try { entries = await readdir(receiptRoot, { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOENT") return { enabled: true, items: [] };
      throw error;
    }
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const receipt = await readReceipt(entry.name.slice(0, -5));
      if (receipt) items.push(publicItem(receipt));
    }
    items.sort((left, right) => right.trashedAt.localeCompare(left.trashedAt));
    return { enabled: true, items };
  }

  async function move(imageId) {
    if (!enabled) throw operationError("DISABLED", "이미지 휴지통 작업이 허용되지 않았습니다.");
    const found = await archive.find(imageId);
    if (!found) throw operationError("NOT_FOUND", "이미지를 찾을 수 없습니다.");
    if (!EXTRA_CATEGORIES.has(found.record.category)) {
      throw operationError("PROTECTED", "오늘의 테마 본편은 이 화면에서 삭제할 수 없습니다.");
    }
    if (!archive.containsTarget(found.target)) throw operationError("UNSAFE_PATH", "허용된 저장소 밖의 파일입니다.");

    const id = crypto.randomUUID().replaceAll("-", "");
    const target = filePath(id, found.extension);
    const receipt = {
      schemaVersion: 1,
      id,
      imageId: found.record.id,
      originalTarget: found.target,
      extension: found.extension,
      trashTarget: target,
      trashedAt: now().toISOString(),
      image: found.record,
      productionRecord: recordStore?.get ? await recordStore.get(found.record.id) : null,
    };
    await mkdir(receiptRoot, { recursive: true });
    await mkdir(fileRoot, { recursive: true });
    const temporaryReceipt = `${receiptPath(id)}.${process.pid}.tmp`;
    await writeFile(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    try {
      await rename(found.target, target);
      await rename(temporaryReceipt, receiptPath(id));
    } catch (error) {
      await rm(temporaryReceipt, { force: true });
      try { await rename(target, found.target); } catch {}
      throw error;
    }
    return publicItem(receipt);
  }

  async function restore(id) {
    if (!enabled) throw operationError("DISABLED", "이미지 휴지통 작업이 허용되지 않았습니다.");
    const receipt = await readReceipt(id);
    if (!receipt) throw operationError("NOT_FOUND", "휴지통 항목을 찾을 수 없습니다.");
    if (!archive.containsTarget(receipt.originalTarget)) throw operationError("UNSAFE_PATH", "복원 위치가 허용된 저장소 밖입니다.");
    try {
      await stat(receipt.originalTarget);
      throw operationError("TARGET_EXISTS", "복원 위치에 같은 파일이 이미 있습니다.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(path.dirname(receipt.originalTarget), { recursive: true });
    await rename(receipt.trashTarget, receipt.originalTarget);
    await rm(receiptPath(id), { force: true });
    return { restored: true, imageId: receipt.imageId };
  }

  async function permanentlyDelete(id) {
    if (!enabled) throw operationError("DISABLED", "이미지 휴지통 작업이 허용되지 않았습니다.");
    const receipt = await readReceipt(id);
    if (!receipt) throw operationError("NOT_FOUND", "휴지통 항목을 찾을 수 없습니다.");
    const expectedTrashTarget = filePath(receipt.id, receipt.extension);
    if (path.resolve(receipt.trashTarget) !== path.resolve(expectedTrashTarget)) {
      throw operationError("UNSAFE_PATH", "휴지통 파일 경로가 올바르지 않습니다.");
    }
    await rm(expectedTrashTarget, { force: true });
    await thumbnails?.remove?.(receipt.imageId, receipt.image.modifiedAt);
    recordStore?.deleteImage?.(receipt.imageId);
    await rm(receiptPath(id), { force: true });
    return { deleted: true };
  }

  async function findContent(id) {
    const receipt = await readReceipt(id);
    if (!receipt) return null;
    const expectedTrashTarget = filePath(receipt.id, receipt.extension);
    if (path.resolve(receipt.trashTarget) !== path.resolve(expectedTrashTarget)) return null;
    try {
      const info = await stat(expectedTrashTarget);
      return info.isFile() ? { target: expectedTrashTarget, extension: receipt.extension, size: info.size } : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  return Object.freeze({ list, move, restore, permanentlyDelete, findContent });
}
