import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createImageStudioRuntime,
  inspectImageStudioRuntime,
} from "../src/modules/images/image-studio-runtime.mjs";

test("기존 stateRoot에서 운영 하위 경로를 파생한다", () => {
  const stateRoot = path.resolve("C:\\runtime\\studio-state");
  const runtime = createImageStudioRuntime({ stateRoot });

  assert.equal(runtime.state.root, stateRoot);
  assert.equal(
    runtime.state.queueRoot,
    path.join(stateRoot, "generation-queue"),
  );
  assert.equal(runtime.state.trashRoot, path.join(stateRoot, "trash"));
  assert.equal(runtime.state.thumbnailRoot, path.join(stateRoot, "thumbnails"));
  assert.equal(runtime.state.logRoot, path.join(stateRoot, "logs"));
});

test("준비 상태 응답은 절대경로를 노출하지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-studio-runtime-"));
  const file = async (name) => {
    const target = path.join(root, name);
    await writeFile(target, "test", "utf8");
    return target;
  };
  const directory = async (name) => {
    const target = path.join(root, name);
    await mkdir(target);
    return target;
  };
  const config = {
    enabled: false,
    dailyImagesRoot: await directory("daily"),
    pilotImagesRoot: await directory("pilot"),
    stylesRoot: await directory("styles"),
    stateRoot: await directory("state"),
    productionRecordsRoot: await directory("records"),
    topicPath: await file("topic.json"),
    fortuneOutputRoot: await directory("fortune"),
    fortunePublisherStateRoot: await directory("publisher"),
    generation: {
      pipelineRoot: await directory("pipeline"),
      assetIndexPath: await file("asset-index.json"),
      outputRoot: await directory("output"),
      pythonExecutablePath: await file("python.exe"),
      responsesWorkerPath: await file("worker.py"),
      freeTextRunnerPath: await file("free-text.ps1"),
      codexResponsesBridgePath: await file("bridge.py"),
    },
  };

  const result = await inspectImageStudioRuntime(config);
  assert.equal(result.ready, true);
  assert.equal(result.groups.generation.available, true);
  assert.equal(JSON.stringify(result).includes(root), false);
});
