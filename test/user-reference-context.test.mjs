import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildImageStudioQueueContext } from "../src/modules/images/image-studio-queue-context.mjs";

test("사용자가 고른 소스 이미지를 별도 주 참조로 worker에 전달한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-user-reference-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const assetIndexPath = path.join(root, "asset-index.json");
  const outputRoot = path.join(root, "output");
  const sourceImagePath = path.join(root, "owner-source.png");
  await writeFile(assetIndexPath, JSON.stringify({ styles: {}, characters: {} }), "utf8");
  await writeFile(sourceImagePath, "source", "utf8");

  const result = await buildImageStudioQueueContext(
    {
      id: "owner-source-test",
      prompt: "얼굴은 유지하고 정원으로 옮겨줘",
      count: 1,
      mode: "prompt-style",
      purpose: "free-play",
      style: { mode: "prompt", id: null },
      sourceImagePath,
    },
    { assetIndexPath, outputRoot },
  );

  assert.equal(result.user_reference_image, sourceImagePath);
  assert.equal(result.generation_rules.user_reference_follows_prompt, true);
});
