import path from "node:path";

const ROOT_PATH_FIELDS = [
  "dailyImagesRoot",
  "pilotImagesRoot",
  "stylesRoot",
  "stateRoot",
  "productionRecordsRoot",
  "topicPath",
  "fortuneOutputRoot",
  "fortunePublisherStateRoot",
];

const GENERATION_PATH_FIELDS = [
  "workspaceRoot",
  "pipelineRoot",
  "assetIndexPath",
  "outputRoot",
  "pythonExecutablePath",
  "responsesWorkerPath",
  "freeTextRunnerPath",
  "freeTextPythonExecutablePath",
  "freeTextKeyStorePath",
  "codexResponsesBridgePath",
  "workflowPath",
  "codexExecutablePath",
];

function validateOptionalAbsolutePath(value, label) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label}은(는) 절대경로여야 합니다.`);
  }
}

export function validateImageStudioConfig(config = {}) {
  for (const field of ROOT_PATH_FIELDS) {
    validateOptionalAbsolutePath(config[field], `integrations.imageStudio.${field}`);
  }

  if (
    config.dailyImagesRoots !== undefined &&
    !Array.isArray(config.dailyImagesRoots)
  ) {
    throw new Error("integrations.imageStudio.dailyImagesRoots는 배열이어야 합니다.");
  }
  for (const [index, root] of (config.dailyImagesRoots ?? []).entries()) {
    validateOptionalAbsolutePath(
      root,
      `integrations.imageStudio.dailyImagesRoots[${index}]`,
    );
  }

  const generation = config.generation ?? {};
  for (const field of GENERATION_PATH_FIELDS) {
    validateOptionalAbsolutePath(
      generation[field],
      `integrations.imageStudio.generation.${field}`,
    );
  }

  if (
    config.topicChannelId !== undefined &&
    typeof config.topicChannelId !== "string"
  ) {
    throw new Error("integrations.imageStudio.topicChannelId는 문자열이어야 합니다.");
  }

  if (
    config.topicChannelName !== undefined &&
    typeof config.topicChannelName !== "string"
  ) {
    throw new Error("integrations.imageStudio.topicChannelName은 문자열이어야 합니다.");
  }

  return config;
}

export const imageStudioPathFields = Object.freeze({
  roots: ROOT_PATH_FIELDS,
  generation: GENERATION_PATH_FIELDS,
});
