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
    themeThumbnails: { enabled: false },
    fortune: { enabled: false },
    news: {
      analysisModel: "gpt-5.6-terra",
      analysisReasoningEffort: "medium",
      codexReview: { enabled: false, executablePath: "", dailyLimit: 4 },
      dcPublisher: {
        enabled: false,
        autoPublish: true,
        publisherRoot: "",
        galleryId: "chatgpt",
      },
    },
    dcComposer: { enabled: false, galleryId: "chatgpt" },
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
  const knownActions = new Set([
    "restart-codex",
    "publish-news-to-dc",
    "manage-image-trash",
    "publish-dc-compose",
    "manage-theme-thumbnails",
    "manage-source-uploads",
  ]);
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

  const themeThumbnails = config.integrations?.themeThumbnails;
  if (themeThumbnails?.enabled) {
    for (const key of ["assetRoot", "historyPath", "catalogPath", "forcedPath"]) {
      if (!path.isAbsolute(themeThumbnails[key] ?? "")) {
        throw new Error(`오늘의 테마 썸네일 ${key}는 절대경로여야 합니다.`);
      }
    }
  }

  const codexReview = config.integrations?.news?.codexReview;
  const newsAnalysisModel = config.integrations?.news?.analysisModel ?? DEFAULT_CONFIG.integrations.news.analysisModel;
  if (
    typeof newsAnalysisModel !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(newsAnalysisModel)
  ) {
    throw new Error("뉴스 분석 모델은 안전한 API 모델 식별자여야 합니다.");
  }
  if (!new Set(["none", "low", "medium", "high", "xhigh", "max"]).has(
    config.integrations?.news?.analysisReasoningEffort ?? DEFAULT_CONFIG.integrations.news.analysisReasoningEffort,
  )) {
    throw new Error("뉴스 분석 reasoning effort가 올바르지 않습니다.");
  }
  if (codexReview?.enabled) {
    if (!path.isAbsolute(codexReview.executablePath ?? "")) {
      throw new Error("Codex 뉴스 검토에는 executablePath 절대경로가 필요합니다.");
    }
    if (!Number.isInteger(codexReview.dailyLimit) || codexReview.dailyLimit < 1 || codexReview.dailyLimit > 12) {
      throw new Error("Codex 뉴스 검토 일일 상한은 1부터 12 사이여야 합니다.");
    }
  }

  const dcPublisher = config.integrations?.news?.dcPublisher;
  if (dcPublisher?.autoPublish !== undefined && typeof dcPublisher.autoPublish !== "boolean") {
    throw new Error("뉴스 DC 자동 게시는 true 또는 false여야 합니다.");
  }

  const dcComposer = config.integrations?.dcComposer;
  if (dcComposer?.enabled !== undefined && typeof dcComposer.enabled !== "boolean") {
    throw new Error("DC 편집실 enabled는 true 또는 false여야 합니다.");
  }
  if (dcComposer && dcComposer.galleryId !== "chatgpt") {
    throw new Error("DC 편집실 게시 대상은 chatgpt 갤러리만 허용합니다.");
  }
  if (dcPublisher?.enabled) {
    if (!path.isAbsolute(dcPublisher.publisherRoot ?? "")) {
      throw new Error("뉴스 DC 게시자에는 publisherRoot 절대경로가 필요합니다.");
    }
    if (dcPublisher.galleryId !== "chatgpt") {
      throw new Error("뉴스 DC 게시 대상은 chatgpt 갤러리만 허용합니다.");
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
