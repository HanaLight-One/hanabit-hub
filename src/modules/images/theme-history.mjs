import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { operationalDate } from "./operational-date.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_THEME_LENGTH = 500;

function validateDate(value) {
  if (!DATE_PATTERN.test(value)) throw new TypeError("날짜 형식은 YYYY-MM-DD여야 합니다.");

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError("유효하지 않은 날짜입니다.");
  }
  return value;
}

function normalizeTheme(value) {
  const theme = String(value ?? "").trim();
  if (!theme) throw new TypeError("테마가 비어 있습니다.");
  if (theme.length > MAX_THEME_LENGTH) {
    throw new RangeError(`테마는 ${MAX_THEME_LENGTH}자를 넘을 수 없습니다.`);
  }
  return theme;
}

async function readJsonIfPresent(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function publicRecord(record) {
  if (!record) return null;
  return {
    date: record.date,
    theme: record.theme,
    firstObservedAt: record.firstObservedAt,
    lastObservedAt: record.lastObservedAt,
  };
}

export function createThemeHistory({
  root,
  timezone = "Asia/Seoul",
  dayStartsAtHour = 2,
}) {
  if (!path.isAbsolute(root)) throw new TypeError("테마 기록 루트는 절대경로여야 합니다.");

  const resolvedRoot = path.resolve(root);

  function targetForDate(date) {
    return path.join(resolvedRoot, `${validateDate(date)}.json`);
  }

  async function get(date) {
    return publicRecord(await readJsonIfPresent(targetForDate(date)));
  }

  async function record(themeInput, observedAt = new Date()) {
    const theme = normalizeTheme(themeInput);
    const date = operationalDate(observedAt, { timezone, dayStartsAtHour });
    const target = targetForDate(date);
    const observedAtIso = observedAt.toISOString();
    const current = await readJsonIfPresent(target);
    const recordValue = {
      schemaVersion: 1,
      date,
      theme,
      firstObservedAt:
        current?.theme === theme && current.firstObservedAt
          ? current.firstObservedAt
          : observedAtIso,
      lastObservedAt: observedAtIso,
    };

    await mkdir(resolvedRoot, { recursive: true });
    const temporary = path.join(
      resolvedRoot,
      `.${date}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${JSON.stringify(recordValue, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return publicRecord(recordValue);
  }

  return Object.freeze({ get, record });
}
