import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const IMAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_FIELDS = new Set([
  "schemaVersion",
  "imageId",
  "jobId",
  "characters",
  "relationGroup",
  "style",
  "createdAt",
  "durationMs",
  "retryCount",
]);

function requiredText(value, field, maxLength = 120) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} 값이 필요합니다.`);
  if (normalized.length > maxLength) {
    throw new RangeError(`${field} 값은 ${maxLength}자를 넘을 수 없습니다.`);
  }
  return normalized;
}

function optionalText(value, field, maxLength = 120) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, field, maxLength);
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("createdAt이 유효하지 않습니다.");
  return date.toISOString();
}

function normalizeCharacters(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("characters에는 한 명 이상의 등장인물이 필요합니다.");
  }
  if (value.length > 20) throw new RangeError("등장인물은 20명을 넘을 수 없습니다.");

  const characters = value.map((item) => requiredText(item, "character", 80));
  return [...new Set(characters)];
}

function nonNegativeInteger(value, field, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} 값의 범위가 올바르지 않습니다.`);
  }
  return value;
}

export function normalizeProductionRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("제작 기록은 객체여야 합니다.");
  }

  const unknownFields = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknownFields.length > 0) {
    throw new TypeError(`허용되지 않은 제작 기록 필드: ${unknownFields.join(", ")}`);
  }

  const imageId = requiredText(input.imageId, "imageId", 128);
  if (!IMAGE_ID_PATTERN.test(imageId)) {
    throw new TypeError("imageId는 안전한 영문·숫자 식별자여야 합니다.");
  }

  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
    throw new RangeError("지원하지 않는 제작 기록 버전입니다.");
  }

  return Object.freeze({
    schemaVersion: 1,
    imageId,
    jobId: optionalText(input.jobId, "jobId", 128),
    characters: Object.freeze(normalizeCharacters(input.characters)),
    relationGroup: optionalText(input.relationGroup, "relationGroup", 120),
    style: optionalText(input.style, "style", 120),
    createdAt: normalizeDate(input.createdAt),
    durationMs: nonNegativeInteger(input.durationMs, "durationMs", 24 * 60 * 60 * 1000),
    retryCount: nonNegativeInteger(input.retryCount, "retryCount", 100),
  });
}

export function createProductionRecordStore({ root }) {
  if (!path.isAbsolute(root)) throw new TypeError("제작 기록 루트는 절대경로여야 합니다.");
  const resolvedRoot = path.resolve(root);

  function targetFor(imageId) {
    if (!IMAGE_ID_PATTERN.test(imageId)) {
      throw new TypeError("imageId는 안전한 영문·숫자 식별자여야 합니다.");
    }
    return path.join(resolvedRoot, `${imageId}.json`);
  }

  async function get(imageId) {
    try {
      return normalizeProductionRecord(
        JSON.parse(await readFile(targetFor(imageId), "utf8")),
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function save(input) {
    const record = normalizeProductionRecord(input);
    await mkdir(resolvedRoot, { recursive: true });
    const target = targetFor(record.imageId);
    const temporary = path.join(
      resolvedRoot,
      `.${record.imageId}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return record;
  }

  return Object.freeze({ get, save });
}
