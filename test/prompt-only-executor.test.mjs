import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenerationDraftStore } from "../src/modules/images/generation-drafts.mjs";
import { createPromptOnlyExecutor } from "../src/modules/images/prompt-only-executor.mjs";

async function fixture(callback, { now } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-prompt-executor-"));
  const draftRoot = path.join(root, "drafts");
  const jobRoot = path.join(root, "jobs");
  const outputRoot = path.join(root, "output");
  const assetIndexPath = path.join(root, "assets.json");
  const pythonExecutablePath = path.join(root, "python.exe");
  const responsesWorkerPath = path.join(root, "worker.py");
  const freeTextRunnerPath = path.join(root, "free.ps1");
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(assetIndexPath, JSON.stringify({
      styles: {}, characters: {}, pink_bridge: { appearance_prompt: "adult Pink-Bridge identity anchor" },
    }), "utf8"),
    writeFile(pythonExecutablePath, "test", "utf8"),
    writeFile(responsesWorkerPath, "test", "utf8"),
    writeFile(freeTextRunnerPath, "test", "utf8"),
  ]);
  const catalog = { async list() { return { styles: [], characters: [{ id: "pink-bridge", label: "핑크브릿지" }] }; } };
  const drafts = createGenerationDraftStore({ root: draftRoot, catalog, archive: null });
  const launches = [];
  const executor = createPromptOnlyExecutor({
    draftStore: drafts,
    jobRoot,
    assetIndexPath,
    outputRoot,
    pythonExecutablePath,
    responsesWorkerPath,
    freeTextRunnerPath,
    ...(now ? { now } : {}),
    async launchWorker(input) { launches.push(input); return { pid: 1234 }; },
  });
  try { await callback({ drafts, executor, launches, jobRoot }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("프롬프트 자유 생성은 모의 worker에 1장으로 한 번만 전달한다", async () => {
  await fixture(async ({ drafts, executor, launches, jobRoot }) => {
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
  });
});

test("핑크브릿지 안내 생성은 전용 외형 앵커와 사용자 프롬프트로 1장 실행한다", async () => {
  await fixture(async ({ drafts, executor, launches, jobRoot }) => {
    const draft = await drafts.create({
      prompt: "분홍 노을 아래 유리 다리를 걷는다",
      purpose: "free-play",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "custom", ids: ["pink-bridge"] },
      style: { mode: "none", id: null },
    });
    const started = await executor.start(draft.id);
    assert.equal(started.executionMode, "pink-bridge");
    assert.equal(started.route, "guided");
    assert.equal(launches.length, 1);
    const job = JSON.parse(await readFile(path.join(jobRoot, `${draft.id}.json`), "utf8"));
    const context = JSON.parse(
      (await readFile(path.join(jobRoot, `${draft.id}.worker-context.json`), "utf8")).replace(/^\uFEFF/u, ""),
    );
    assert.equal(job.mode, "pink-bridge");
    assert.equal(context.job.mode, "natural");
    assert.match(context.job.prompt, /분홍 노을/);
    assert.match(context.job.prompt, /adult Pink-Bridge identity anchor/);
  });
});

test("20분 넘게 갱신되지 않은 작업은 내부 정보 없이 확인 필요로 표시한다", async () => {
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
      prompt: "외부에 보이면 안 되는 프롬프트",
    }), "utf8");

    const status = await executor.status(draft.id);
    assert.equal(status.status, "attention");
    assert.equal(status.stage, "stalled");
    assert.equal(status.durationMs, 1_201_000);
    assert.equal(JSON.stringify(status).includes("프롬프트"), false);
  }, { now: () => current });
});

test("자동 선택 안내 생성 초안은 실제 worker 실행을 거부한다", async () => {
  await fixture(async ({ drafts, executor, launches }) => {
    const draft = await drafts.create({
      prompt: "자동으로 선택하는 장면",
      purpose: "theme-followup",
      mode: "new",
      sourceImageId: null,
      characters: { mode: "auto", ids: [] },
      style: { mode: "auto", id: null },
    });
    await assert.rejects(() => executor.start(draft.id), /아직 실제 생성/);
    assert.equal(launches.length, 0);
  });
});
