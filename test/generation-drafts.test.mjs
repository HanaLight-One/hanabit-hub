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
      characters: [{ id: "헤일라", label: "헤일라" }],
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
    const saved = JSON.parse(await readFile(path.join(root, `${result.id}.json`), "utf8"));
    assert.equal(saved.prompt, prompt);
    assert.equal(saved.status, "draft");
    assert.equal(saved.executionEnabled, false);
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
