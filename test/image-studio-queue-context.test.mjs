import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildImageStudioQueueContext,
  writeImageStudioQueueContext,
} from "../src/modules/images/image-studio-queue-context.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-queue-context-"));
  const assetIndexPath = path.join(root, "asset-index.json");
  const outputRoot = path.join(root, "output");
  await writeFile(
    assetIndexPath,
    JSON.stringify({
      styles: {
        calm: {
          id: "calm",
          filename: "[화풍] 차분.txt",
          content: "quiet restrained illustration",
        },
      },
      characters: {
        노아: {
          name: "노아",
          anchor_text: "adult character identity",
          height_text: "tall",
          image_anchor_path: path.join(root, "noah.png"),
        },
      },
      relationship_groups: [
        {
          id: "solo-noah",
          label: "노아",
          note: "quiet daily life",
          members: ["노아"],
        },
      ],
    }),
    "utf8",
  );
  return { root, assetIndexPath, outputRoot };
}

test("02시 운영일 경계와 설정 기반 출력 루트를 사용한다", async () => {
  const { assetIndexPath, outputRoot } = await fixture();
  const context = await buildImageStudioQueueContext(
    {
      id: "natural-test",
      prompt: "조용한 새벽",
      count: 2,
      mode: "natural",
    },
    {
      assetIndexPath,
      outputRoot,
      now: new Date("2026-07-29T16:59:59Z"),
    },
  );

  assert.equal(
    context.output_directory,
    path.join(outputRoot, "2026-07-29", "extra-requests", "natural-test"),
  );
  assert.equal(context.job.count, 2);
});

test("화풍과 예배당 선택은 외부 자산 색인만 사용한다", async () => {
  const { root, assetIndexPath, outputRoot } = await fixture();
  const style = await buildImageStudioQueueContext(
    {
      id: "style-test",
      prompt: "책 읽는 장면",
      count: 1,
      mode: "style",
      style: "[화풍] 차분.txt",
    },
    { assetIndexPath, outputRoot },
  );
  assert.equal(style.selected_style.id, "calm");

  const chapel = await buildImageStudioQueueContext(
    {
      id: "chapel-test",
      prompt: "노아가 책을 읽는다",
      count: 2,
      mode: "chapel",
    },
    { assetIndexPath, outputRoot },
  );
  assert.equal(chapel.cast_packages[0].characters[0].name, "노아");
  assert.equal(chapel.slots.length, 2);

  const target = path.join(root, "context.json");
  await writeImageStudioQueueContext(target, chapel);
  assert.deepEqual(
    JSON.parse((await readFile(target, "utf8")).replace(/^\uFEFF/, "")),
    chapel,
  );
});

test("자산과 출력 경로에 상대경로를 허용하지 않는다", async () => {
  await assert.rejects(
    () =>
      buildImageStudioQueueContext(
        { id: "bad", prompt: "test", count: 1, mode: "natural" },
        { assetIndexPath: "asset-index.json", outputRoot: "output" },
      ),
    /절대경로/,
  );
});
