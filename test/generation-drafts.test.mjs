import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenerationDraftStore } from "../src/modules/images/generation-drafts.mjs";

const SOURCE_ID = "a".repeat(64);
const CHARACTER_IDS = ["pink-bridge", "헤일라", "리벨라", "세이라", "우리엘", "카시"];
const AVAILABLE_CHARACTER_IDS = [...CHARACTER_IDS, "루카", "에델리아", "노아", "베리케스"];
const catalog = {
  async list() {
    return {
      styles: [
        { id: "gothic", label: "gothic" },
        { id: "watercolor", label: "watercolor" },
        { id: "neon", label: "neon" },
        { id: "ink", label: "ink" },
      ],
      characters: AVAILABLE_CHARACTER_IDS.map((id) => ({ id, label: id === "pink-bridge" ? "핑크브릿지" : id })),
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
    assert.equal(saved.useImageAnchors, false);
  });
});

test("인물별 배치는 최대 10명을 한 사람당 한 장으로 보존한다", async () => {
  await fixture(async ({ store }) => {
    const result = await store.create({
      prompt: "모두 서로 다른 자세를 취한다. 콜라주 금지.",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: AVAILABLE_CHARACTER_IDS },
      style: { mode: "selected", id: "gothic" },
      batch: { mode: "per-character", count: 10 },
    });
    assert.deepEqual(result.batch, { mode: "per-character", count: 10 });
    assert.equal(result.executionMode, "guided-cast");
    const saved = await store.get(result.id);
    assert.equal(saved.schemaVersion, 3);
    assert.equal(saved.characters.ids.length, 10);
  });
});

test("구도·자세 문장을 장면과 분리해 초안에 보존한다", async () => {
  await fixture(async ({ store }) => {
    const result = await store.create({
      prompt: "두 사람이 온실에서 밤 인사를 한다",
      compositionDirection: "살짝 낮은 시점에서 두 사람을 서로 겹치지 않게 반신으로 담는다.",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["리벨라", "세이라"] },
      style: { mode: "auto", id: null },
    });
    const saved = await store.get(result.id);
    assert.match(saved.compositionDirection, /낮은 시점/u);
    await assert.rejects(() => store.create({
      prompt: "장면 요청",
      compositionDirection: "x".repeat(1_201),
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "auto", id: null },
    }), /1,200자/u);
  });
});

test("인물 없는 변주 배치는 2~10장만 허용한다", async () => {
  await fixture(async ({ store }) => {
    const result = await store.create({
      prompt: "같은 레퍼런스로 서로 다른 자세",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "auto", id: null },
      batch: { mode: "variants", count: 10 },
    });
    assert.equal(result.batch.count, 10);
    await assert.rejects(() => store.create({
      prompt: "잘못된 묶음",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["헤일라", "리벨라"] },
      style: { mode: "auto", id: null },
      batch: { mode: "variants", count: 2 },
    }), /등장인물 없음을 선택/);
  });
});

test("핑크브릿지를 포함한 최대 6명은 실제 실행 가능한 안내 생성 초안으로 분류한다", async () => {
  await fixture(async ({ store }) => {
    const result = await store.create({
      prompt: "네온 온실에서 분홍빛 우산을 든 장면",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: CHARACTER_IDS },
      style: { mode: "none", id: null },
      useImageAnchors: true,
    });
    assert.equal(result.route, "guided");
    assert.equal(result.executionMode, "guided-cast");
    const saved = await store.get(result.id);
    assert.equal(saved.useImageAnchors, true);
  });
});

test("프롬프트 화풍과 고정 렌더링은 자산 없는 실제 실행 초안으로 보존한다", async () => {
  await fixture(async ({ root, store }) => {
    const selectedStyle = await store.create({
      prompt: "목록에 없는 인물이 노트에 낙서하는 장면",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "gothic" },
    });
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
    assert.equal(selectedStyle.route, "prompt-only");
    assert.equal(selectedStyle.executionMode, "prompt-only");
    assert.equal(selectedStyle.styleMode, "selected");
    assert.equal(promptStyle.route, "prompt-only");
    assert.equal(promptStyle.executionMode, "prompt-only");
    assert.equal(rendering.route, "guided");
    assert.equal(rendering.executionMode, "guided-cast");
    const saved = JSON.parse(await readFile(path.join(root, `${rendering.id}.json`), "utf8"));
    assert.deepEqual(saved.style, { mode: "rendering", id: "semi-realistic-anime" });
  });
});

test("저장 화풍은 중복 없이 최대 3개를 혼합 선택으로 보존한다", async () => {
  await fixture(async ({ store }) => {
    const result = await store.create({
      prompt: "고딕 수채화 네온 골목",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "gothic", ids: ["gothic", "watercolor", "gothic"] },
    });
    const saved = await store.get(result.id);
    assert.deepEqual(saved.style, {
      mode: "selected",
      id: "gothic",
      ids: ["gothic", "watercolor"],
    });
    await assert.rejects(() => store.create({
      prompt: "너무 많은 화풍",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "gothic", ids: ["gothic", "watercolor", "neon", "ink"] },
    }), /최대 3개/);
  });
});

test("자동 인물·자동 화풍과 인물 없음·자동 화풍을 실제 실행 대상으로 분류한다", async () => {
  await fixture(async ({ store }) => {
    const automatic = await store.create({
      prompt: "누군가 새벽 시장에서 따뜻한 음료를 고른다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "auto", ids: [] },
      style: { mode: "auto", id: null },
    });
    const externalSubject = await store.create({
      prompt: "목록 밖의 탐험 로봇이 빙하 동굴을 조사한다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "auto", id: null },
    });
    assert.equal(automatic.executionMode, "guided-cast");
    assert.equal(externalSubject.route, "prompt-only");
    assert.equal(externalSubject.executionMode, "prompt-only");
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
    await assert.rejects(
      () => store.create({
        prompt: "너무 많은 인물",
        purpose: "free-play",
        mode: "new",
        sourceImageId: null,
        characters: { mode: "custom", ids: [...CHARACTER_IDS, "일곱째"] },
        style: { mode: "auto", id: null },
      }),
      /최대 6명/,
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

test("새 장면도 직접 고른 소스 이미지를 보존하고 실행할 수 있다", async () => {
  await fixture(async ({ root, store }) => {
    const result = await store.create({
      prompt: "이 참조 이미지의 인물을 정원 장면으로 옮겨줘",
      purpose: "free-play",
      mode: "new",
      sourceImageId: SOURCE_ID,
      characters: { mode: "none", ids: [] },
      style: { mode: "prompt", id: null },
    });
    assert.equal(result.route, "prompt-only");
    assert.equal(result.executionMode, "prompt-only");
    const saved = JSON.parse(await readFile(path.join(root, `${result.id}.json`), "utf8"));
    assert.equal(saved.sourceImageId, SOURCE_ID);
  });
});

test("반복 생성은 설정 원본만 보존하고 실제 이미지 레퍼런스로 전달하지 않는다", async () => {
  await fixture(async ({ root, store }) => {
    const result = await store.create({
      prompt: "이전 장면의 인물과 화풍으로 다시 그린다",
      purpose: "free-play",
      mode: "same-combination",
      sourceImageId: null,
      templateImageId: SOURCE_ID,
      characters: { mode: "custom", ids: ["헤일라", "리벨라"] },
      style: { mode: "selected", id: "gothic" },
    });
    const saved = JSON.parse(await readFile(path.join(root, `${result.id}.json`), "utf8"));
    assert.equal(saved.templateImageId, SOURCE_ID);
    assert.equal(saved.sourceImageId, null);
    assert.equal(result.executionMode, "guided-cast");
  });
});

test("설정 원본과 이미지 레퍼런스를 동시에 보내지 못한다", async () => {
  await fixture(async ({ store }) => {
    await assert.rejects(() => store.create({
      prompt: "모호한 이중 참조",
      purpose: "free-play",
      mode: "same-style",
      sourceImageId: SOURCE_ID,
      templateImageId: SOURCE_ID,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "gothic" },
    }), /동시에 보낼 수 없습니다/);
  });
});

test("소스 이미지의 같은 조합과 외부 대상 교체도 실제 1장 실행으로 분류한다", async () => {
  await fixture(async ({ store }) => {
    const sameCombination = await store.create({
      prompt: "가운데 인물을 우리엘로 교체한다",
      purpose: "free-play",
      mode: "same-combination",
      sourceImageId: SOURCE_ID,
      characters: { mode: "custom", ids: ["헤일라", "리벨라", "세이라", "우리엘"] },
      style: { mode: "selected", id: "gothic" },
    });
    const externalSubject = await store.create({
      prompt: "소스의 중앙 인물을 목록 밖의 탐험가로 교체한다",
      purpose: "free-play",
      mode: "same-style",
      sourceImageId: SOURCE_ID,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "gothic" },
    });
    assert.equal(sameCombination.executionMode, "guided-cast");
    assert.equal(externalSubject.route, "prompt-only");
    assert.equal(externalSubject.executionMode, "prompt-only");
  });
});
