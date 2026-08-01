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
        리벨라: {
          name: "리벨라",
          anchor_text: "adult Rivella identity",
          height_text: "average height",
          image_anchor_path: path.join(root, "rivella.png"),
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
      pink_bridge: { appearance_prompt: "adult Pink-Bridge identity anchor" },
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

test("핑크브릿지는 전용 외형 앵커를 일반 cast worker 문맥으로 고정한다", async () => {
  const { assetIndexPath, outputRoot } = await fixture();
  const context = await buildImageStudioQueueContext(
    {
      id: "pink-test",
      prompt: "비 오는 옥상에서 투명 우산을 든다",
      count: 1,
      mode: "pink-bridge",
      purpose: "free-play",
    },
    { assetIndexPath, outputRoot },
  );
  assert.equal(context.job.mode, "cast");
  assert.match(context.job.prompt, /비 오는 옥상/);
  assert.match(context.cast_packages[0].characters[0].anchor_text, /adult Pink-Bridge identity anchor/);
  assert.deepEqual(context.guided_selection.character_ids, ["pink-bridge"]);
});

test("핑크브릿지의 프롬프트 화풍과 고정 렌더링은 locked style로 전달한다", async () => {
  const { assetIndexPath, outputRoot } = await fixture();
  const promptDefined = await buildImageStudioQueueContext(
    {
      id: "pink-prompt-style",
      prompt: "사용자가 지정한 긴 수채화 화풍",
      count: 1,
      mode: "pink-bridge",
      purpose: "free-play",
      style: { mode: "prompt", id: null },
    },
    { assetIndexPath, outputRoot },
  );
  const rendering = await buildImageStudioQueueContext(
    {
      id: "pink-rendering",
      prompt: "밤의 온실",
      count: 1,
      mode: "pink-bridge",
      purpose: "free-play",
      style: { mode: "rendering", id: "2.5d-semi-realistic-anime-reality-forward" },
    },
    { assetIndexPath, outputRoot },
  );
  assert.equal(promptDefined.job.mode, "cast");
  assert.equal(promptDefined.selected_style.id, "prompt-defined");
  assert.match(promptDefined.selected_style.content, /user's request defines/);
  assert.equal(rendering.job.mode, "cast");
  assert.equal(rendering.selected_style.id, "2.5d-semi-realistic-anime-reality-forward");
  assert.match(rendering.selected_style.content, /reality-forward/);
});

test("핑크브릿지와 일반 인물을 함께 선택하면 한 cast와 참조 이미지로 보존한다", async () => {
  const { assetIndexPath, outputRoot } = await fixture();
  const context = await buildImageStudioQueueContext(
    {
      id: "mixed-cast",
      prompt: "핑크브릿지와 노아와 리벨라가 야시장에 모인다",
      count: 1,
      mode: "guided-cast",
      purpose: "free-play",
      characters: { mode: "custom", ids: ["pink-bridge", "노아", "리벨라"] },
      style: { mode: "selected", id: "calm" },
    },
    { assetIndexPath, outputRoot },
  );
  assert.equal(context.job.mode, "cast");
  assert.deepEqual(context.guided_selection.character_ids, ["pink-bridge", "노아", "리벨라"]);
  assert.equal(context.selected_style.id, "calm");
  assert.equal(context.cast_packages[0].characters.length, 3);
  assert.equal(context.cast_packages[0].characters[0].image_anchor_path, null);
  assert.match(context.cast_packages[0].characters[1].image_anchor_path, /noah\.png$/u);
});

test("인물 없는 고정 렌더링도 locked style worker 문맥을 사용한다", async () => {
  const { assetIndexPath, outputRoot } = await fixture();
  const context = await buildImageStudioQueueContext(
    {
      id: "prompt-rendering",
      prompt: "우주 정거장",
      count: 1,
      mode: "prompt-style",
      purpose: "free-play",
      style: { mode: "rendering", id: "hyper-realistic-anime" },
    },
    { assetIndexPath, outputRoot },
  );
  assert.equal(context.job.mode, "style");
  assert.equal(context.selected_style.id, "hyper-realistic-anime");
});

test("추가 생성 목적을 출력 하위 폴더에 분리한다", async () => {
  const { assetIndexPath, outputRoot } = await fixture();
  const context = await buildImageStudioQueueContext(
    {
      id: "free-test",
      prompt: "자유로운 장면",
      count: 1,
      mode: "natural",
      purpose: "free-play",
    },
    { assetIndexPath, outputRoot, now: new Date("2026-07-29T17:00:00Z") },
  );
  assert.equal(
    context.output_directory,
    path.join(outputRoot, "2026-07-30", "extra-requests", "free-play", "free-test"),
  );
  assert.equal(context.job.purpose, "free-play");
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
