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
const NO_CHARACTER_STYLE_MODES = new Set(["auto", "none", "selected", "prompt", "rendering"]);
const PURPOSES = new Set(["theme-followup", "free-play"]);
const MAX_CUSTOM_CHARACTERS = 6;
const MAX_BATCH_IMAGES = 10;
const BATCH_MODES = new Set(["single", "per-character", "variants"]);
const MAX_SELECTED_STYLES = 3;

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

function normalizeBatch(value) {
  const batch = value == null ? { mode: "single", count: 1 } : value;
  if (!plainObject(batch) || !BATCH_MODES.has(batch.mode)) {
    throw draftError("INVALID_BATCH", "생성 묶음이 올바르지 않습니다.");
  }
  const count = Number(batch.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_IMAGES) {
    throw draftError("INVALID_BATCH", `한 번에 1장부터 ${MAX_BATCH_IMAGES}장까지 생성할 수 있습니다.`);
  }
  if (batch.mode === "single" && count !== 1) {
    throw draftError("INVALID_BATCH", "함께 한 장 모드는 정확히 1장만 생성합니다.");
  }
  if (batch.mode !== "single" && count < 2) {
    throw draftError("INVALID_BATCH", "배치 생성은 2장 이상이어야 합니다.");
  }
  return Object.freeze({ mode: batch.mode, count });
}

function normalizeCharacters(value, allowedIds, maximum = MAX_CUSTOM_CHARACTERS) {
  if (!plainObject(value) || !CHARACTER_MODES.has(value.mode)) {
    throw draftError("INVALID_SELECTION", "등장인물 선택 방식이 올바르지 않습니다.");
  }
  const ids = Array.isArray(value.ids) ? [...new Set(value.ids.map(String))] : [];
  if (value.mode === "custom") {
    if (
      ids.length < 1 ||
      ids.length > maximum ||
      ids.some((id) => !allowedIds.has(id))
    ) {
      throw draftError(
        "INVALID_SELECTION",
        `등장인물은 현재 목록에서 최대 ${maximum}명까지 선택할 수 있습니다.`,
      );
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
    const ids = [...new Set(
      (Array.isArray(value.ids) ? value.ids : id == null ? [] : [id]).map(String),
    )];
    if (
      ids.length < 1 ||
      ids.length > MAX_SELECTED_STYLES ||
      ids.some((selectedId) => !allowedIds.has(selectedId))
    ) {
      throw draftError(
        "INVALID_SELECTION",
        `현재 화풍 목록에서 최대 ${MAX_SELECTED_STYLES}개까지 선택해주세요.`,
      );
    }
    return Object.freeze({ mode: value.mode, id: ids[0], ids: Object.freeze(ids) });
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
    const sourceImageId = suppliedSourceImageId;
    const suppliedTemplateImageId = input.templateImageId == null ? null : String(input.templateImageId);
    if (suppliedTemplateImageId !== null && !SOURCE_ID_PATTERN.test(suppliedTemplateImageId)) {
      throw draftError("INVALID_SOURCE", "설정 원본 이미지 ID가 올바르지 않습니다.");
    }
    const templateImageId = suppliedTemplateImageId;
    if (sourceImageId !== null && templateImageId !== null) {
      throw draftError("INVALID_SOURCE", "이미지 레퍼런스와 설정 원본을 동시에 보낼 수 없습니다.");
    }
    if (SOURCE_MODES.has(mode) && sourceImageId === null && templateImageId === null) {
      throw draftError("INVALID_SOURCE", "이 생성 방식에는 설정 원본 이미지가 필요합니다.");
    }
    if (sourceImageId !== null && (!archive || !(await archive.find(sourceImageId)))) {
      throw draftError("INVALID_SOURCE", "원본 이미지를 찾을 수 없습니다.");
    }
    if (templateImageId !== null && (!archive || !(await archive.find(templateImageId)))) {
      throw draftError("INVALID_SOURCE", "설정 원본 이미지를 찾을 수 없습니다.");
    }

    const options = await catalog.list();
    const batch = normalizeBatch(input.batch);
    const characters = normalizeCharacters(
      input.characters,
      new Set(options.characters.map((item) => item.id)),
      batch.mode === "per-character" ? MAX_BATCH_IMAGES : MAX_CUSTOM_CHARACTERS,
    );
    if (batch.mode === "per-character" && (
      characters.mode !== "custom" || characters.ids.length !== batch.count
    )) {
      throw draftError("INVALID_BATCH", "인물별 배치는 선택한 인물마다 정확히 한 장씩 생성합니다.");
    }
    if (batch.mode === "variants" && characters.mode !== "none") {
      throw draftError("INVALID_BATCH", "인물 없는 변주 배치는 등장인물 없음을 선택해야 합니다.");
    }
    const style = normalizeStyle(
      input.style,
      new Set(options.styles.map((item) => item.id)),
    );
    if (input.useImageAnchors != null && typeof input.useImageAnchors !== "boolean") {
      throw draftError("INVALID_SELECTION", "이미지 앵커 사용 여부가 올바르지 않습니다.");
    }
    const useImageAnchors = input.useImageAnchors === true;
    const route =
      characters.mode === "none" && NO_CHARACTER_STYLE_MODES.has(style.mode)
        ? "prompt-only"
        : "guided";
    const id = randomUUID().replaceAll("-", "");
    const createdAt = new Date().toISOString();
    const record = {
      schemaVersion: 2,
      id,
      createdAt,
      status: "draft",
      executionEnabled: false,
      route,
      purpose,
      prompt,
      mode,
      sourceImageId,
      templateImageId,
      characters,
      style,
      useImageAnchors,
      batch,
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
      styleMode: style.mode,
      batch,
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
    !MODES.has(draft?.mode) ||
    draft?.executionEnabled !== false
  ) return null;
  if (
    draft.route === "prompt-only" &&
    draft.characters?.mode === "none" &&
    NO_CHARACTER_STYLE_MODES.has(draft.style?.mode)
  ) return "prompt-only";
  if (
    draft.route === "guided" &&
    (
      draft.characters?.mode === "auto" ||
      (
        draft.characters?.mode === "custom" &&
        draft.characters.ids?.length >= 1 &&
        draft.characters.ids.length <= (
          draft.batch?.mode === "per-character" ? MAX_BATCH_IMAGES : MAX_CUSTOM_CHARACTERS
        )
      )
    )
  ) return "guided-cast";
  return null;
}

export { MAX_BATCH_IMAGES, MAX_CUSTOM_CHARACTERS, MAX_PROMPT_LENGTH };
