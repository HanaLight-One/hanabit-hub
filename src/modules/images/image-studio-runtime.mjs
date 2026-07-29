import { stat } from "node:fs/promises";
import path from "node:path";

const REQUIRED_PATHS = Object.freeze({
  archive: ["dailyImagesRoot", "pilotImagesRoot"],
  styles: ["stylesRoot"],
  state: ["stateRoot"],
  topic: ["topicPath"],
  fortune: ["fortuneOutputRoot", "fortunePublisherStateRoot"],
  generation: [
    "generation.pipelineRoot",
    "generation.assetIndexPath",
    "generation.outputRoot",
    "generation.pythonExecutablePath",
    "generation.responsesWorkerPath",
    "generation.freeTextRunnerPath",
    "generation.codexResponsesBridgePath",
  ],
});

function getValue(config, dottedKey) {
  return dottedKey.split(".").reduce((value, key) => value?.[key], config);
}

function stateLayout(stateRoot) {
  if (!stateRoot) return null;
  return Object.freeze({
    root: stateRoot,
    queueRoot: path.join(stateRoot, "generation-queue"),
    trashRoot: path.join(stateRoot, "trash"),
    thumbnailRoot: path.join(stateRoot, "thumbnails"),
    logRoot: path.join(stateRoot, "logs"),
    workerLockPath: path.join(stateRoot, "queue-worker.lock"),
  });
}

export function createImageStudioRuntime(config = {}) {
  return Object.freeze({
    enabled: config.enabled === true,
    roots: Object.freeze({
      dailyImagesRoot: config.dailyImagesRoot || null,
      pilotImagesRoot: config.pilotImagesRoot || null,
      stylesRoot: config.stylesRoot || null,
      productionRecordsRoot: config.productionRecordsRoot || null,
      topicPath: config.topicPath || null,
      fortuneOutputRoot: config.fortuneOutputRoot || null,
      fortunePublisherStateRoot: config.fortunePublisherStateRoot || null,
    }),
    state: stateLayout(config.stateRoot),
    generation: Object.freeze({
      workspaceRoot: config.generation?.workspaceRoot || null,
      pipelineRoot: config.generation?.pipelineRoot || null,
      assetIndexPath: config.generation?.assetIndexPath || null,
      outputRoot: config.generation?.outputRoot || null,
      pythonExecutablePath: config.generation?.pythonExecutablePath || null,
      responsesWorkerPath: config.generation?.responsesWorkerPath || null,
      freeTextRunnerPath: config.generation?.freeTextRunnerPath || null,
      codexResponsesBridgePath:
        config.generation?.codexResponsesBridgePath || null,
    }),
  });
}

async function pathExists(target) {
  if (!target) return false;
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function inspectImageStudioRuntime(config = {}) {
  const groups = {};
  for (const [group, fields] of Object.entries(REQUIRED_PATHS)) {
    const checks = await Promise.all(
      fields.map(async (field) => ({
        field,
        configured: Boolean(getValue(config, field)),
        available: await pathExists(getValue(config, field)),
      })),
    );
    groups[group] = {
      configured: checks.every((check) => check.configured),
      available: checks.every((check) => check.available),
      missing: checks
        .filter((check) => !check.configured || !check.available)
        .map((check) => check.field),
    };
  }

  return {
    enabled: config.enabled === true,
    ready: Object.values(groups).every((group) => group.available),
    groups,
  };
}

export { REQUIRED_PATHS };
