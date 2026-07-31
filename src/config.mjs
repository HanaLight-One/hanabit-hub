import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImageStudioConfig } from "./modules/images/image-studio-config.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_CONFIG_PATH = path.join(APP_ROOT, "config.local.json");

const DEFAULT_CONFIG = Object.freeze({
  host: "127.0.0.1",
  port: 8790,
  integrations: {
    imageStudio: { enabled: false },
    fortune: { enabled: false },
  },
  operations: {
    timezone: "Asia/Seoul",
    dayStartsAtHour: 2,
  },
  allowedActions: [],
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  if (!isPlainObject(override)) return base;

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      isPlainObject(value) && isPlainObject(base[key])
        ? mergeConfig(base[key], value)
        : value;
  }
  return result;
}

function validateConfig(config) {
  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    throw new Error("host는 로컬 주소만 사용할 수 있습니다.");
  }

  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error("port는 1024부터 65535 사이의 정수여야 합니다.");
  }

  if (!Array.isArray(config.allowedActions)) {
    throw new Error("allowedActions는 배열이어야 합니다.");
  }
  const knownActions = new Set(["restart-codex"]);
  const invalidAction = config.allowedActions.find(
    (action) => typeof action !== "string" || !knownActions.has(action),
  );
  if (invalidAction !== undefined) {
    throw new Error("allowedActions에 알 수 없는 작업이 있습니다.");
  }

  if (config.operations?.timezone !== "Asia/Seoul") {
    throw new Error("현재 운영 시간대는 Asia/Seoul만 지원합니다.");
  }

  if (
    !Number.isInteger(config.operations?.dayStartsAtHour) ||
    config.operations.dayStartsAtHour < 0 ||
    config.operations.dayStartsAtHour > 23
  ) {
    throw new Error("dayStartsAtHour는 0부터 23 사이의 정수여야 합니다.");
  }

  const imageStudio = config.integrations?.imageStudio;
  validateImageStudioConfig(imageStudio);
  if (imageStudio?.enabled && !path.isAbsolute(imageStudio.productionRecordsRoot ?? "")) {
    throw new Error(
      "Image Studio를 활성화하려면 productionRecordsRoot 절대경로가 필요합니다.",
    );
  }

  const fortune = config.integrations?.fortune;
  if (fortune?.enabled) {
    if (!path.isAbsolute(fortune.outputRoot ?? "")) {
      throw new Error("운세 연동에는 outputRoot 절대경로가 필요합니다.");
    }
    if (!path.isAbsolute(fortune.publisherStateRoot ?? "")) {
      throw new Error("운세 연동에는 publisherStateRoot 절대경로가 필요합니다.");
    }
  }

  return config;
}

export async function loadConfig() {
  let localConfig = {};

  try {
    localConfig = JSON.parse(await readFile(LOCAL_CONFIG_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`config.local.json을 읽을 수 없습니다: ${error.message}`);
    }
  }

  return validateConfig(mergeConfig(DEFAULT_CONFIG, localConfig));
}

export { APP_ROOT, validateConfig };
