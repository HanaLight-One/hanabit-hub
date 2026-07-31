import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TEXT_BYTES = 512 * 1024;

function validateDate(date) {
  if (!DATE_PATTERN.test(date)) throw new TypeError("올바른 날짜가 필요합니다.");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError("올바른 날짜가 필요합니다.");
  }
  return date;
}

function seoulDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && url.hostname === "gall.dcinside.com" ? url.href : null;
  } catch {
    return null;
  }
}

async function readJsonIfPresent(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function normalizePublication(runState, publishState) {
  const publishStatus = String(publishState?.status ?? "");
  const runStatus = String(runState?.status ?? "");
  if (publishStatus === "ambiguous-no-retry") {
    return {
      status: "attention",
      updatedAt: String(publishState?.submittedAt ?? runState?.updatedAt ?? ""),
      url: null,
    };
  }
  if (publishStatus === "posted" || runStatus === "posted") {
    return {
      status: "posted",
      updatedAt: String(publishState?.submittedAt ?? runState?.updatedAt ?? ""),
      url: safeHttpUrl(publishState?.redirectUrl),
    };
  }
  if (["running", "publishing", "generated"].includes(runStatus)) {
    return { status: "running", updatedAt: String(runState?.updatedAt ?? ""), url: null };
  }
  if (["failed", "blocked"].includes(runStatus)) {
    return { status: "attention", updatedAt: String(runState?.updatedAt ?? ""), url: null };
  }
  return { status: "pending", updatedAt: String(runState?.updatedAt ?? ""), url: null };
}

export function createFortuneArchive({ outputRoot, publisherStateRoot, now = () => new Date() }) {
  if (!path.isAbsolute(outputRoot) || !path.isAbsolute(publisherStateRoot)) {
    throw new TypeError("운세 저장소는 절대경로여야 합니다.");
  }

  function textPath(date) {
    return path.join(outputRoot, validateDate(date), "fortune.txt");
  }

  async function dates() {
    let entries;
    try {
      entries = await readdir(outputRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const available = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !DATE_PATTERN.test(entry.name)) continue;
      try {
        const info = await stat(textPath(entry.name));
        if (info.isFile() && info.size <= MAX_TEXT_BYTES) available.push(entry.name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return available.sort().reverse();
  }

  async function get(requestedDate) {
    const date = validateDate(requestedDate ?? seoulDate(now()));
    let text = null;
    try {
      const info = await stat(textPath(date));
      if (!info.isFile() || info.size > MAX_TEXT_BYTES) throw new Error("운세 본문 크기가 안전 한도를 넘었습니다.");
      text = await readFile(textPath(date), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const [runState, publishState] = await Promise.all([
      readJsonIfPresent(path.join(publisherStateRoot, `fortune-run-${date}.json`)),
      readJsonIfPresent(path.join(publisherStateRoot, `fortune-${date}.json`)),
    ]);
    return {
      date,
      available: text !== null,
      text,
      publication: normalizePublication(runState, publishState),
    };
  }

  async function text(date) {
    const result = await get(date);
    return result.available ? { date: result.date, text: result.text } : null;
  }

  return Object.freeze({ dates, get, text });
}
