import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenerationDraftStore } from "../src/modules/images/generation-drafts.mjs";

const SOURCE_ID = "a".repeat(64);
const catalog = {
  async list() {
    return {
      styles: [{ id: "gothic", label: "gothic" }],
      characters: [{ id: "pink-bridge", label: "핑크브릿지" }, { id: "헤일라", label: "헤일라" }],
    };
  },
};
const archive = {
  async find(id) {
    return id === SOURCE_ID ? { record: { id } } : null;
  },
};

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-generation-drafts-"));
  try {
    await callback({ root, store: createGenerationDraftStore({ root, catalog, archive }) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("인물과 화풍 없음은 긴 프롬프트 자유 생성 초안으로만 저장한다", async () => {
  await fixture(async ({ root, store }) => {
    const prompt = "빛".repeat(8_500);
    const result = await store.create({
      prompt,
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "none", id: null },
    });
    assert.equal(result.route, "prompt-only");
    assert.equal(result.promptLength, 8_500);
    assert.equal(result.executionEnabled, false);
    assert.equal(result.executionMode, "prompt-only");
    const saved = JSON.parse(await readFile(path.join(root, `${result.id}.json`), "utf8"));
    assert.equal(saved.prompt, prompt);
    assert.equal(saved.status, "draft");
    assert.equal(saved.executionEnabled, false);
  });
});

test("핑크브릿지 단독 새 장면은 안내 생성 중 실제 실행 가능한 초안으로 분류한다", async () => {
  await fixture(async ({ store }) => {
    const result = await store.create({
      prompt: "네온 온실에서 분홍빛 우산을 든 장면",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["pink-bridge"] },
      style: { mode: "none", id: null },
    });
    assert.equal(result.route, "guided");
    assert.equal(result.executionMode, "pink-bridge");
  });
});

test("프롬프트 화풍과 고정 렌더링은 자산 없는 실제 실행 초안으로 보존한다", async () => {
  await fixture(async ({ root, store }) => {
    const promptStyle = await store.create({
      prompt: "긴 사용자 화풍과 장면 지시",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "prompt", id: null },
    });
    const rendering = await store.create({
      prompt: "핑크브릿지가 비 오는 거리를 걷는다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["pink-bridge"] },
      style: { mode: "rendering", id: "semi-realistic-anime" },
    });
    assert.equal(promptStyle.route, "prompt-only");
    assert.equal(promptStyle.executionMode, "prompt-only");
    assert.equal(rendering.route, "guided");
    assert.equal(rendering.executionMode, "pink-bridge");
    const saved = JSON.parse(await readFile(path.join(root, `${rendering.id}.json`), "utf8"));
    assert.deepEqual(saved.style, { mode: "rendering", id: "semi-realistic-anime" });
  });
});

test("초안은 현재 옵션과 존재하는 원본만 허용한다", async () => {
  await fixture(async ({ store }) => {
    await assert.rejects(
      () => store.create({
        prompt: "새 장면",
        purpose: "free-play",
        mode: "same-style",
        sourceImageId: null,
        characters: { mode: "auto", ids: [] },
        style: { mode: "auto", id: null },
      }),
      /원본 이미지/,
    );
    await assert.rejects(
      () => store.create({
        prompt: "새 장면",
        purpose: "free-play",
        mode: "new",
        sourceImageId: null,
        characters: { mode: "custom", ids: ["없는 인물"] },
        style: { mode: "selected", id: "없는 화풍" },
      }),
      /등장인물/,
    );
    await assert.rejects(
      () => store.create({
        prompt: "새 장면",
        purpose: "free-play",
        mode: "new",
        sourceImageId: null,
        characters: { mode: "none", ids: [] },
        style: { mode: "rendering", id: "random-secret-style" },
      }),
      /렌더링 목록/,
    );
  });
});

test("초안은 오테 추가와 자유 추가 목적만 허용한다", async () => {
  await fixture(async ({ store }) => {
    await assert.rejects(
      () => store.create({
        prompt: "분류할 수 없는 장면",
        purpose: "unknown",
        mode: "new",
        sourceImageId: null,
        characters: { mode: "none", ids: [] },
        style: { mode: "none", id: null },
      }),
      /생성 목적/,
    );
  });
});
