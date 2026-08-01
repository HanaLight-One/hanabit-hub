import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RENDERING_PRESETS } from "./rendering-presets.mjs";

const MAX_PROMPT_LENGTH = 12_000;
const SOURCE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const MODES = new Set(["new", "same-combination", "same-characters", "same-style"]);
const SOURCE_MODES = new Set(["same-combination", "same-characters", "same-style"]);
const CHARACTER_MODES = new Set(["auto", "none", "custom"]);
const STYLE_MODES = new Set(["auto", "none", "selected", "prompt", "rendering"]);
const NO_ASSET_STYLE_MODES = new Set(["none", "prompt", "rendering"]);
const PURPOSES = new Set(["theme-followup", "free-play"]);

function draftError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateDraftId(id) {
  if (!/^[a-f0-9]{32}$/u.test(String(id ?? ""))) {
    throw draftError("INVALID_DRAFT_ID", "안전한 생성 초안 ID가 필요합니다.");
  }
  return String(id);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePrompt(value) {
  const prompt = String(value ?? "").trim();
  if (prompt.length < 3) throw draftError("INVALID_PROMPT", "장면 요청을 3자 이상 입력해주세요.");
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw draftError("INVALID_PROMPT", `장면 요청은 ${MAX_PROMPT_LENGTH.toLocaleString("ko-KR")}자 이하여야 합니다.`);
  }
  return prompt;
}

function normalizeCharacters(value, allowedIds) {
  if (!plainObject(value) || !CHARACTER_MODES.has(value.mode)) {
    throw draftError("INVALID_SELECTION", "등장인물 선택 방식이 올바르지 않습니다.");
  }
  const ids = Array.isArray(value.ids) ? [...new Set(value.ids.map(String))] : [];
  if (value.mode === "custom") {
    if (ids.length < 1 || ids.length > 3 || ids.some((id) => !allowedIds.has(id))) {
      throw draftError("INVALID_SELECTION", "등장인물은 현재 목록에서 최대 3명까지 선택할 수 있습니다.");
    }
  } else if (ids.length > 0) {
    throw draftError("INVALID_SELECTION", "자동 또는 없음 선택에는 등장인물 ID를 보낼 수 없습니다.");
  }
  return Object.freeze({ mode: value.mode, ids: Object.freeze(ids) });
}

function normalizeStyle(value, allowedIds) {
  if (!plainObject(value) || !STYLE_MODES.has(value.mode)) {
    throw draftError("INVALID_SELECTION", "화풍 선택 방식이 올바르지 않습니다.");
  }
  const id = value.id == null ? null : String(value.id);
  if (value.mode === "selected") {
    if (!id || !allowedIds.has(id)) {
      throw draftError("INVALID_SELECTION", "현재 화풍 목록에서 선택해주세요.");
    }
  } else if (value.mode === "rendering") {
    if (!id || !RENDERING_PRESETS[id]) {
      throw draftError("INVALID_SELECTION", "현재 렌더링 목록에서 선택해주세요.");
    }
  } else if (id !== null) {
    throw draftError("INVALID_SELECTION", "자동 또는 없음 선택에는 화풍 ID를 보낼 수 없습니다.");
  }
  return Object.freeze({ mode: value.mode, id });
}

export function createGenerationDraftStore({ root, catalog, archive }) {
  if (!path.isAbsolute(root ?? "")) throw new TypeError("생성 초안 루트는 절대경로여야 합니다.");
  if (!catalog) throw new TypeError("생성 옵션 카탈로그가 필요합니다.");

  async function create(input) {
    if (!plainObject(input)) throw draftError("INVALID_REQUEST", "생성 초안 JSON이 필요합니다.");
    const prompt = normalizePrompt(input.prompt);
    const mode = String(input.mode ?? "");
    if (!MODES.has(mode)) throw draftError("INVALID_MODE", "생성 방식이 올바르지 않습니다.");
    const purpose = String(input.purpose ?? "");
    if (!PURPOSES.has(purpose)) {
      throw draftError("INVALID_PURPOSE", "추가 생성 목적이 올바르지 않습니다.");
    }

    const suppliedSourceImageId = input.sourceImageId == null ? null : String(input.sourceImageId);
    if (suppliedSourceImageId !== null && !SOURCE_ID_PATTERN.test(suppliedSourceImageId)) {
      throw draftError("INVALID_SOURCE", "원본 이미지 ID가 올바르지 않습니다.");
    }
    const sourceImageId = mode === "new" ? null : suppliedSourceImageId;
    if (SOURCE_MODES.has(mode) && sourceImageId === null) {
      throw draftError("INVALID_SOURCE", "이 생성 방식에는 원본 이미지가 필요합니다.");
    }
    if (sourceImageId !== null && (!archive || !(await archive.find(sourceImageId)))) {
      throw draftError("INVALID_SOURCE", "원본 이미지를 찾을 수 없습니다.");
    }

    const options = await catalog.list();
    const characters = normalizeCharacters(
      input.characters,
      new Set(options.characters.map((item) => item.id)),
    );
    const style = normalizeStyle(
      input.style,
      new Set(options.styles.map((item) => item.id)),
    );
    const route =
      mode === "new" && sourceImageId === null && characters.mode === "none" && NO_ASSET_STYLE_MODES.has(style.mode)
        ? "prompt-only"
        : "guided";
    const id = randomUUID().replaceAll("-", "");
    const createdAt = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      id,
      createdAt,
      status: "draft",
      executionEnabled: false,
      route,
      purpose,
      prompt,
      mode,
      sourceImageId,
      characters,
      style,
    };
    const executionMode = classifyDraftExecution(record);

    await mkdir(root, { recursive: true });
    const target = path.join(root, `${id}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporary, target);

    return Object.freeze({
      id,
      createdAt,
      status: "draft",
      route,
      purpose,
      promptLength: prompt.length,
      executionEnabled: false,
      executionMode,
    });
  }

  async function get(id) {
    const safeId = validateDraftId(id);
    try {
      return JSON.parse(await readFile(path.join(root, `${safeId}.json`), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        throw draftError("DRAFT_NOT_FOUND", "생성 초안을 찾을 수 없습니다.");
      }
      throw error;
    }
  }

  return Object.freeze({ create, get });
}

export function classifyDraftExecution(draft) {
  if (
    draft?.mode !== "new" ||
    draft?.sourceImageId !== null ||
    draft?.executionEnabled !== false
  ) return null;
  if (
    draft.route === "prompt-only" &&
    draft.characters?.mode === "none" &&
    NO_ASSET_STYLE_MODES.has(draft.style?.mode)
  ) return "prompt-only";
  if (
    draft.route === "guided" &&
    draft.characters?.mode === "custom" &&
    draft.characters.ids?.length === 1 &&
    draft.characters.ids[0] === "pink-bridge" &&
    NO_ASSET_STYLE_MODES.has(draft.style?.mode)
  ) return "pink-bridge";
  return null;
}

export { MAX_PROMPT_LENGTH };
