import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const NUMBERED_PNG = /^[1-9][0-9]*\.png$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function managerError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function readState(filePath, key) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (value?.version !== 1 || typeof value[key] !== "object" || value[key] === null) {
      throw new Error("invalid state");
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, [key]: key === "selections" && filePath.includes("history") ? [] : {} };
    throw managerError("INVALID_STATE", `${path.basename(filePath)} 상태 파일 형식이 올바르지 않아요.`);
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, filePath);
}

function calendarDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeLabel(value, fallback) {
  const label = String(value ?? "").normalize("NFC").trim();
  if (!label) return fallback;
  if (label.length > 60 || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw managerError("INVALID_LABEL", "표시 이름은 제어 문자 없이 60자 이하여야 해요.");
  }
  return label;
}

function normalizeWeight(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) {
    throw managerError("INVALID_WEIGHT", "가중치는 0부터 10 사이의 숫자여야 해요.");
  }
  return Math.round(value * 10) / 10;
}

function normalizeDate(value) {
  const date = String(value ?? "");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const canonical = Number.isNaN(parsed.valueOf())
    ? ""
    : `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  if (!ISO_DATE.test(date) || canonical !== date) {
    throw managerError("INVALID_DATE", "날짜는 YYYY-MM-DD 형식이어야 해요.");
  }
  return date;
}

export function createThemeThumbnailManager({
  assetRoot,
  historyPath,
  catalogPath,
  forcedPath,
  enabled = false,
  timeZone = "Asia/Seoul",
  now = () => new Date(),
}) {
  for (const value of [assetRoot, historyPath, catalogPath, forcedPath]) {
    if (!path.isAbsolute(value ?? "")) throw new TypeError("썸네일 관리 경로는 절대경로여야 합니다.");
  }
  let mutationInProgress = false;

  async function filenames() {
    const entries = await readdir(assetRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && NUMBERED_PNG.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number.parseInt(left) - Number.parseInt(right));
  }

  async function state() {
    const files = await filenames();
    const [catalog, history, forced] = await Promise.all([
      readState(catalogPath, "assets"),
      readState(historyPath, "selections"),
      readState(forcedPath, "selections"),
    ]);
    const today = calendarDate(now(), timeZone);
    const validHistory = history.selections.filter((item) => files.includes(item?.filename) && ISO_DATE.test(item?.date ?? ""));
    const counts = new Map();
    for (const item of validHistory) counts.set(item.filename, (counts.get(item.filename) ?? 0) + 1);
    const assets = await Promise.all(files.map(async (filename) => {
      const info = await stat(path.join(assetRoot, filename));
      const last = validHistory.filter((item) => item.filename === filename).at(-1)?.date ?? null;
      const configured = catalog.assets[filename] ?? {};
      return {
        filename,
        label: normalizeLabel(configured.label, `썸네일 ${path.parse(filename).name}`),
        weight: typeof configured.weight === "number" ? configured.weight : 1,
        size: info.size,
        selectionCount: counts.get(filename) ?? 0,
        lastSelectedDate: last,
        previewUrl: `/api/images/theme-thumbnails/${filename}/content`,
      };
    }));
    const todayHistory = validHistory.findLast((item) => item.date === today)?.filename ?? null;
    const forcedEntries = Object.entries(forced.selections)
      .filter(([date, filename]) => ISO_DATE.test(date) && files.includes(filename))
      .sort(([left], [right]) => left.localeCompare(right));
    return {
      enabled,
      today,
      todaySelection: forced.selections[today] ?? todayHistory,
      todayForced: Boolean(forced.selections[today]),
      assets,
      recent: [...validHistory].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14),
      forced: forcedEntries.map(([date, filename]) => ({ date, filename })),
    };
  }

  async function mutate(action) {
    if (!enabled) throw managerError("DISABLED", "썸네일 관리 기능이 잠겨 있어요.");
    if (mutationInProgress) throw managerError("BUSY", "다른 썸네일 변경을 처리하고 있어요.");
    mutationInProgress = true;
    try { return await action(); }
    finally { mutationInProgress = false; }
  }

  async function upload({ buffer, label }) {
    return mutate(async () => {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
        throw managerError("INVALID_UPLOAD", "20MB 이하 PNG 파일을 선택해 주세요.");
      }
      const metadata = await sharp(buffer).metadata().catch(() => null);
      if (metadata?.format !== "png" || !metadata.width || !metadata.height) {
        throw managerError("INVALID_UPLOAD", "실제 PNG 이미지 파일만 업로드할 수 있어요.");
      }
      const existing = await filenames();
      const next = `${Math.max(0, ...existing.map((name) => Number.parseInt(name))) + 1}.png`;
      await writeFile(path.join(assetRoot, next), buffer, { flag: "wx" });
      const catalog = await readState(catalogPath, "assets");
      catalog.assets[next] = { label: normalizeLabel(label, `썸네일 ${path.parse(next).name}`), weight: 1 };
      await writeJsonAtomic(catalogPath, catalog);
      return { uploaded: true, filename: next, ...(await state()) };
    });
  }

  async function update(filename, { label, weight }) {
    return mutate(async () => {
      if (!(await filenames()).includes(filename)) throw managerError("NOT_FOUND", "썸네일을 찾을 수 없어요.");
      const catalog = await readState(catalogPath, "assets");
      catalog.assets[filename] = {
        label: normalizeLabel(label, `썸네일 ${path.parse(filename).name}`),
        weight: normalizeWeight(weight),
      };
      await writeJsonAtomic(catalogPath, catalog);
      return { updated: true, ...(await state()) };
    });
  }

  async function force(dateInput, filename) {
    return mutate(async () => {
      const date = normalizeDate(dateInput);
      const forced = await readState(forcedPath, "selections");
      if (filename === null) delete forced.selections[date];
      else {
        if (!(await filenames()).includes(filename)) throw managerError("NOT_FOUND", "썸네일을 찾을 수 없어요.");
        forced.selections[date] = filename;
      }
      await writeJsonAtomic(forcedPath, forced);
      return { forced: filename !== null, date, filename, ...(await state()) };
    });
  }

  async function remove(filename) {
    return mutate(async () => {
      const current = await state();
      if (!current.assets.some((asset) => asset.filename === filename)) throw managerError("NOT_FOUND", "썸네일을 찾을 수 없어요.");
      if (current.assets.length <= 2) throw managerError("MINIMUM_ASSETS", "오테 썸네일은 최소 2장을 남겨야 해요.");
      if (current.todaySelection === filename) throw managerError("IN_USE", "오늘 선택된 썸네일은 삭제할 수 없어요.");
      if (current.forced.some((item) => item.date >= current.today && item.filename === filename)) {
        throw managerError("IN_USE", "오늘 또는 미래 날짜에 예약된 썸네일은 삭제할 수 없어요.");
      }
      await unlink(path.join(assetRoot, filename));
      const catalog = await readState(catalogPath, "assets");
      delete catalog.assets[filename];
      await writeJsonAtomic(catalogPath, catalog);
      return { deleted: true, filename, ...(await state()) };
    });
  }

  async function find(filename) {
    if (!NUMBERED_PNG.test(filename) || !(await filenames()).includes(filename)) return null;
    const target = path.join(assetRoot, filename);
    const info = await stat(target);
    return { target, size: info.size };
  }

  return Object.freeze({ state, upload, update, force, remove, find });
}
