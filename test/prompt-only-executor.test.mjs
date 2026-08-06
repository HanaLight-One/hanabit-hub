import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenerationDraftStore } from "../src/modules/images/generation-drafts.mjs";
import {
  createPromptOnlyExecutor,
  HUB_IMAGE_MAX_CONCURRENCY,
} from "../src/modules/images/prompt-only-executor.mjs";

const SOURCE_ID = "f".repeat(64);

test("Hub 이미지 worker 동시 실행 상한은 4개다", () => {
  assert.equal(HUB_IMAGE_MAX_CONCURRENCY, 4);
});

async function fixture(callback, { now } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-prompt-executor-"));
  const draftRoot = path.join(root, "drafts");
  const jobRoot = path.join(root, "jobs");
  const outputRoot = path.join(root, "output");
  const assetIndexPath = path.join(root, "assets.json");
  const pythonExecutablePath = path.join(root, "python.exe");
  const responsesWorkerPath = path.join(root, "worker.py");
  const freeTextRunnerPath = path.join(root, "free.ps1");
  const freeTextPythonExecutablePath = path.join(root, "free-python.exe");
  const freeTextKeyStorePath = path.join(root, "openai-api-key.dpapi");
  const sourceImagePath = path.join(root, "owner-source.png");
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(assetIndexPath, JSON.stringify({
      styles: {
        calm: { id: "calm", filename: "calm.txt", content: "calm ink style" },
        vivid: { id: "vivid", filename: "vivid.txt", content: "vivid neon style" },
      },
      characters: {
        핑크브릿지: {
          name: "핑크브릿지",
          source: "special_guest",
          anchor_text: "adult Pink-Bridge guest identity only",
          height_text: "average height",
        },
        헤일라: {
          name: "헤일라",
          anchor_text: "adult Haila identity anchor",
          height_text: "tall",
          image_anchor_path: path.join(root, "haila.png"),
        },
      },
      relationship_groups: [{
        id: "haila-solo",
        label: "헤일라",
        note: "quiet daily life",
        members: ["헤일라"],
      }],
      pink_bridge: { appearance_prompt: "adult Pink-Bridge identity anchor" },
    }), "utf8"),
    writeFile(pythonExecutablePath, "test", "utf8"),
    writeFile(responsesWorkerPath, "test", "utf8"),
    writeFile(freeTextRunnerPath, "test", "utf8"),
    writeFile(freeTextPythonExecutablePath, "test", "utf8"),
    writeFile(freeTextKeyStorePath, "test", "utf8"),
    writeFile(sourceImagePath, "source", "utf8"),
  ]);
  const catalog = { async list() { return {
    styles: [{ id: "calm", label: "calm" }, { id: "vivid", label: "vivid" }],
    characters: [{ id: "pink-bridge", label: "핑크브릿지" }, { id: "헤일라", label: "헤일라" }],
  }; } };
  const archiveLookups = { findManyCalls: 0, requestedTargets: [] };
  const archive = {
    async find(id) {
      return id === SOURCE_ID
        ? { target: sourceImagePath, record: { id: SOURCE_ID } }
        : null;
    },
    async findByTarget(target) {
      if (path.basename(target) !== "result.png") return null;
      return { record: {
        id: "a".repeat(64),
        name: "result.png",
        thumbnailUrl: `/api/images/${"a".repeat(64)}/thumbnail`,
        contentUrl: `/api/images/${"a".repeat(64)}/content`,
        downloadUrl: `/api/images/${"a".repeat(64)}/download`,
      } };
    },
    async findManyByTargets(targets) {
      archiveLookups.findManyCalls += 1;
      archiveLookups.requestedTargets = [...targets];
      return new Map(targets.map((target, index) => [
        path.resolve(target).toLowerCase(),
        { record: {
          id: (index + 1).toString(16).padStart(64, "0"),
          name: path.basename(target),
          thumbnailUrl: `/api/images/${(index + 1).toString(16).padStart(64, "0")}/thumbnail`,
          contentUrl: `/api/images/${(index + 1).toString(16).padStart(64, "0")}/content`,
          downloadUrl: `/api/images/${(index + 1).toString(16).padStart(64, "0")}/download`,
        } },
      ]));
    },
  };
  const drafts = createGenerationDraftStore({ root: draftRoot, catalog, archive });
  const launches = [];
  const executor = createPromptOnlyExecutor({
    draftStore: drafts,
    jobRoot,
    assetIndexPath,
    outputRoot,
    pythonExecutablePath,
    responsesWorkerPath,
    freeTextRunnerPath,
    freeTextPythonExecutablePath,
    freeTextKeyStorePath,
    archive,
    optionsCatalog: catalog,
    ...(now ? { now } : {}),
    async launchWorker(input) { launches.push(input); return { pid: 1234 }; },
  });
  try {
    await callback({
      drafts,
      executor,
      launches,
      jobRoot,
      outputRoot,
      freeTextPythonExecutablePath,
      freeTextKeyStorePath,
      archiveLookups,
    });
  }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("프롬프트 자유 생성은 모의 worker에 1장으로 한 번만 전달한다", async () => {
  await fixture(async ({
    drafts,
    executor,
    launches,
    jobRoot,
    freeTextPythonExecutablePath,
    freeTextKeyStorePath,
  }) => {
    const draft = await drafts.create({
      prompt: "자유로운 우주 정거장 장면",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "none", id: null },
    });
    const started = await executor.start(draft.id);
    assert.deepEqual(started, { id: draft.id, status: "processing", route: "prompt-only", executionMode: "prompt-only", count: 1 });
    assert.equal(launches.length, 1);
    assert.equal(launches[0].freeTextPythonExecutablePath, freeTextPythonExecutablePath);
    assert.equal(launches[0].freeTextKeyStorePath, freeTextKeyStorePath);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(job.count, 1);
    assert.equal(job.mode, "natural");
    assert.equal(job.purpose, "free-play");
    assert.equal(context.job.prompt, "자유로운 우주 정거장 장면");
    assert.equal(context.generation_rules.one_image_per_call, true);
    await assert.rejects(() => executor.start(draft.id), /이미 실행/);
    assert.equal(launches.length, 1);
    await writeFile(
      path.join(jobRoot, `${draft.id}.json`),
      JSON.stringify({ ...job, status: "failed", error: "SECRET C:\\internal\\worker.log" }),
      "utf8",
    );
    assert.equal(JSON.stringify(await executor.status(draft.id)).includes("SECRET"), false);
    const listing = await executor.list();
    assert.equal(listing.jobs.length, 1);
    assert.equal(listing.jobs[0].status, "failed");
    assert.equal(JSON.stringify(listing).includes("SECRET"), false);
    assert.equal(JSON.stringify(listing).includes("internal"), false);
    for (let index = 1; index <= 12; index += 1) {
      const id = index.toString(16).padStart(32, "0");
      await writeFile(
        path.join(jobRoot, `${id}.json`),
        JSON.stringify({ ...job, id, startedAt: new Date(Date.parse(job.startedAt) - index * 1000).toISOString() }),
        "utf8",
      );
    }
    const firstPage = await executor.list({ limit: 5 });
    assert.equal(firstPage.jobs.length, 5);
    assert.equal(firstPage.totalCount, 13);
    assert.equal(firstPage.hasMore, true);
  });
});

test("인물 없는 10장 변주 배치는 한 작업으로 worker에 전달한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot, launches }) => {
    const draft = await drafts.create({
      prompt: "같은 소품으로 서로 다른 자세 열 장, 콜라주 금지",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "none", id: null },
      batch: { mode: "variants", count: 10 },
    });
    const started = await executor.start(draft.id, { confirmation: "generate-draft-image-batch" });
    assert.equal(started.count, 10);
    assert.equal(launches.length, 1);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    assert.equal(job.count, 10);
    assert.equal(job.batchMode, "variants");
    assert.deepEqual(job.progress, { completed: 0, total: 10 });
    await assert.rejects(
      () => executor.start(draft.id, { confirmation: "generate-one-draft-image" }),
      /10장 실제 생성 확인/,
    );
  });
});

test("최근 작업 목록은 전체 영수증 중 표시할 작업의 결과만 한 번에 찾는다", async () => {
  await fixture(async ({ executor, jobRoot, outputRoot, archiveLookups }) => {
    await mkdir(jobRoot, { recursive: true });
    for (let index = 1; index <= 12; index += 1) {
      const id = index.toString(16).padStart(32, "0");
      await writeFile(path.join(jobRoot, `${id}.json`), JSON.stringify({
        id,
        createdAt: `2026-08-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        startedAt: `2026-08-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-08-01T00:${String(index).padStart(2, "0")}:10.000Z`,
        status: "complete",
        prompt: `작업 ${index}`,
        count: 1,
        purpose: "free-play",
        characters: { mode: "none", ids: [] },
        style: { mode: "none", id: null },
        outputs: [path.join(outputRoot, `${id}.png`)],
        progress: { completed: 1, total: 1 },
      }), "utf8");
    }

    const listing = await executor.list({ limit: 5 });

    assert.equal(listing.totalCount, 12);
    assert.equal(listing.jobs.length, 5);
    assert.equal(archiveLookups.findManyCalls, 1);
    assert.equal(archiveLookups.requestedTargets.length, 5);
  });
});

test("인물별 배치의 한 슬롯을 소스 이미지 없이 같은 설정으로 재생성한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot, launches }) => {
    const draft = await drafts.create({
      prompt: "각자 같은 우산을 들고 다른 골목에 선다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: SOURCE_ID,
      characters: { mode: "custom", ids: ["pink-bridge", "헤일라"] },
      style: { mode: "selected", id: "calm" },
      useImageAnchors: true,
      batch: { mode: "per-character", count: 2 },
    });
    await executor.start(draft.id, { confirmation: "generate-draft-image-batch" });
    const originalPath = path.join(jobRoot, `${draft.id}.json`);
    const original = JSON.parse(await readFile(originalPath, "utf8"));
    await writeFile(originalPath, JSON.stringify({
      ...original,
      status: "failed",
      failedAt: "2026-08-03T10:00:00.000Z",
      imageMetrics: [{ number: 2, status: "failed" }],
    }), "utf8");

    const regenerated = await executor.regenerate(draft.id, { slot: 2 });
    assert.equal(regenerated.regeneratedFrom, draft.id);
    assert.equal(regenerated.slot, 2);
    assert.equal(launches.length, 2);
    const retry = JSON.parse(await readFile(path.join(jobRoot, `${regenerated.id}.json`), "utf8"));
    assert.equal(retry.count, 1);
    assert.equal(retry.sourceImageId, null);
    assert.deepEqual(retry.characters, { mode: "custom", ids: ["헤일라"] });
    assert.deepEqual(retry.style, { mode: "selected", id: "calm", ids: ["calm"] });
    assert.equal(retry.prompt, original.prompt);
    assert.equal(retry.useImageAnchors, true);
    await assert.rejects(() => executor.regenerate(draft.id, { slot: 3 }), /번호가 올바르지/);
  });
});

test("완료 작업은 안전한 프롬프트와 선택 자산, 결과 이미지 카드를 제공한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot, outputRoot }) => {
    const draft = await drafts.create({
      prompt: "다과회\nReference: C:\\private\\anchor.png\n따뜻한 오후",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["pink-bridge", "헤일라"] },
      style: { mode: "selected", id: "calm" },
    });
    await executor.start(draft.id);
    const jobPath = path.join(jobRoot, `${draft.id}.json`);
    const job = JSON.parse(await readFile(jobPath, "utf8"));
    await writeFile(jobPath, JSON.stringify({
      ...job,
      status: "complete",
      completedAt: "2026-08-01T03:00:00.000Z",
      progress: { completed: 1, total: 1 },
      outputs: [path.join(outputRoot, "result.png")],
    }), "utf8");

    const status = await executor.status(draft.id);
    assert.deepEqual(status.characters, ["핑크브릿지", "헤일라"]);
    assert.equal(status.style, "calm");
    assert.match(status.prompt, /다과회/);
    assert.match(status.prompt, /내부 참조 경로 숨김/);
    assert.equal(status.prompt.includes("C:\\"), false);
    assert.equal(status.images[0].name, "result.png");
    assert.equal(JSON.stringify(status).includes(outputRoot), false);
  });
});

test("핑크브릿지와 일반 인물을 함께 선택해 외형 앵커와 참조 경로를 1장 작업에 전달한다", async () => {
  await fixture(async ({ drafts, executor, launches, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "분홍 노을 아래 유리 다리를 걷는다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["pink-bridge", "헤일라"] },
      style: { mode: "none", id: null },
      useImageAnchors: true,
    });
    const started = await executor.start(draft.id);
    assert.equal(started.executionMode, "guided-cast");
    assert.equal(started.route, "guided");
    assert.equal(launches.length, 1);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(job.mode, "guided-cast");
    assert.equal(context.job.mode, "cast");
    assert.match(context.job.prompt, /분홍 노을/);
    assert.deepEqual(context.guided_selection.character_ids, ["pink-bridge", "헤일라"]);
    assert.match(context.cast_packages[0].characters[0].anchor_text, /guest identity only/);
    assert.match(context.cast_packages[0].characters[1].anchor_text, /Haila/);
    assert.match(context.cast_packages[0].characters[1].image_anchor_path, /haila\.png$/u);
  });
});

test("핑크브릿지 프롬프트 화풍은 natural 기본값 없이 locked style로 실행한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "고딕 수채화로 그린 오래된 천문대",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["pink-bridge"] },
      style: { mode: "prompt", id: null },
    });
    await executor.start(draft.id);
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(context.job.mode, "cast");
    assert.equal(context.selected_style.id, "prompt-defined");
    assert.match(context.job.prompt, /고딕 수채화/);
  });
});

test("고정 렌더링 선택은 정확한 preset으로 1장 실행한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "빛나는 도서관",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "rendering", id: "hyper-realistic-anime" },
    });
    await executor.start(draft.id);
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(context.job.mode, "style");
    assert.equal(context.selected_style.id, "hyper-realistic-anime");
  });
});

test("등장인물 없이 저장 화풍을 고르면 프롬프트 인물과 선택 화풍으로 실행한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "목록에 없는 인물이 노트에 낙서하는 장면",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "calm" },
    });
    const started = await executor.start(draft.id);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(started.executionMode, "prompt-only");
    assert.equal(job.mode, "selected-style");
    assert.equal(context.job.mode, "style");
    assert.equal(context.selected_style.id, "calm");
    assert.equal(context.cast_packages, undefined);
    assert.match(context.job.prompt, /목록에 없는 인물/);
  });
});

test("등장인물 없이 고른 두 화풍을 혼합해 같은 worker 계약으로 실행한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "고요하지만 선명한 네온 서재",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "selected", id: "calm", ids: ["calm", "vivid"] },
    });
    await executor.start(draft.id);
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(context.job.mode, "style");
    assert.equal(context.selected_style.id, "blend:calm+vivid");
    assert.match(context.selected_style.content, /calm ink style/);
    assert.match(context.selected_style.content, /vivid neon style/);
  });
});

test("자동 인물과 자동 화풍은 실행 전에 실제 선택값으로 작업 기록에 확정한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "새벽 시장에서 간식을 고른다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "auto", ids: [] },
      style: { mode: "auto", id: null },
    });
    const started = await executor.start(draft.id);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(started.executionMode, "guided-cast");
    assert.deepEqual(job.characters, { mode: "custom", ids: ["헤일라"] });
    assert.equal(job.style.mode, "selected");
    assert.equal(["calm", "vivid"].includes(job.style.id), true);
    assert.deepEqual(job.style.ids, [job.style.id]);
    assert.equal(context.guided_selection.style_id, job.style.id);
    assert.equal(job.relationGroup, "haila-solo");
  });
});

test("인물 없음과 자동 화풍은 외부 대상을 유지하고 실제 화풍만 확정한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "목록 밖의 탐험 로봇이 빙하 동굴을 조사한다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "auto", id: null },
    });
    const started = await executor.start(draft.id);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    assert.equal(started.executionMode, "prompt-only");
    assert.deepEqual(job.characters, { mode: "none", ids: [] });
    assert.equal(job.style.mode, "selected");
    assert.equal(["calm", "vivid"].includes(job.style.id), true);
  });
});

test("20분 넘게 갱신되지 않은 작업은 오류·내부 경로 없이 확인 필요로 표시한다", async () => {
  const current = new Date("2026-08-01T03:00:00.000Z");
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "오래 걸리는 장면",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "none", ids: [] },
      style: { mode: "none", id: null },
    });
    await executor.start(draft.id);
    const jobPath = path.join(jobRoot, `${draft.id}.json`);
    const job = JSON.parse(await readFile(jobPath, "utf8"));
    await writeFile(jobPath, JSON.stringify({
      ...job,
      startedAt: "2026-08-01T02:39:59.000Z",
      prompt: "확인 가능한 사용자 프롬프트\nC:\\internal\\worker.log",
    }), "utf8");

    const status = await executor.status(draft.id);
    assert.equal(status.status, "attention");
    assert.equal(status.stage, "stalled");
    assert.equal(status.durationMs, 1_201_000);
    assert.match(status.prompt, /확인 가능한 사용자 프롬프트/);
    assert.equal(JSON.stringify(status).includes("C:\\internal"), false);
  }, { now: () => current });
});

test("오테 추가에서도 자동 선택 초안은 worker를 정확히 한 번 시작한다", async () => {
  await fixture(async ({ drafts, executor, launches }) => {
    const draft = await drafts.create({
      prompt: "자동으로 선택하는 장면",
      purpose: "theme-followup",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "auto", ids: [] },
      style: { mode: "auto", id: null },
    });
    const started = await executor.start(draft.id);
    assert.equal(started.executionMode, "guided-cast");
    assert.equal(launches.length, 1);
  });
});

test("직접 선택한 소스 이미지를 worker 참조 컨텍스트에 연결한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "얼굴은 유지하고 배경을 정원으로 바꿔줘",
      purpose: "free-play",
      mode: "new",
      sourceImageId: SOURCE_ID,
      characters: { mode: "none", ids: [] },
      style: { mode: "prompt", id: null },
    });
    await executor.start(draft.id);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const workerContext = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(job.sourceImageId, SOURCE_ID);
    assert.match(job.sourceImagePath, /owner-source\.png$/u);
    assert.equal(workerContext.user_reference_image, job.sourceImagePath);
    assert.equal(workerContext.generation_rules.user_reference_follows_prompt, true);
  });
});

test("같은 조합은 소스 이미지와 복원된 인물·화풍을 함께 worker에 전달한다", async () => {
  await fixture(async ({ drafts, executor, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "중앙 인물을 헤일라로 교체한다",
      purpose: "free-play",
      mode: "same-combination",
      sourceImageId: SOURCE_ID,
      characters: { mode: "custom", ids: ["pink-bridge", "헤일라"] },
      style: { mode: "selected", id: "calm" },
      useImageAnchors: true,
    });
    const started = await executor.start(draft.id);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(started.executionMode, "guided-cast");
    assert.equal(job.sourceImageId, SOURCE_ID);
    assert.deepEqual(job.characters.ids, ["pink-bridge", "헤일라"]);
    assert.equal(job.style.id, "calm");
    assert.equal(context.user_reference_image.endsWith("owner-source.png"), true);
    assert.deepEqual(context.guided_selection.character_ids, ["pink-bridge", "헤일라"]);
    assert.equal(context.guided_selection.style_id, "calm");
  });
});
