import { spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildImageStudioQueueContext,
  writeImageStudioQueueContext,
} from "./image-studio-queue-context.mjs";

const ID_PATTERN = /^[a-f0-9]{32}$/u;
const STALE_AFTER_MS = 20 * 60 * 1000;
const PURPOSES = new Set(["theme-followup", "free-play"]);

function executionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateId(id) {
  if (!ID_PATTERN.test(String(id ?? ""))) {
    throw executionError("INVALID_ID", "안전한 생성 작업 ID가 필요합니다.");
  }
  return String(id);
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function requireFile(target, label) {
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error();
  } catch {
    throw executionError("RUNTIME_UNAVAILABLE", `${label} 실행 환경을 사용할 수 없습니다.`);
  }
}

function defaultLaunch({ pythonExecutablePath, responsesWorkerPath, freeTextRunnerPath, jobPath, contextPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutablePath,
      [responsesWorkerPath, "--job", jobPath, "--context", contextPath],
      {
        cwd: path.dirname(responsesWorkerPath),
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, HANABIT_FREE_TEXT_RUNNER: freeTextRunnerPath },
      },
    );
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ pid: child.pid });
    });
  });
}

export function createPromptOnlyExecutor({
  draftStore,
  jobRoot,
  assetIndexPath,
  outputRoot,
  pythonExecutablePath,
  responsesWorkerPath,
  freeTextRunnerPath,
  launchWorker = defaultLaunch,
  buildContext = buildImageStudioQueueContext,
  writeContext = writeImageStudioQueueContext,
  now = () => new Date(),
}) {
  for (const [label, target] of Object.entries({
    jobRoot,
    assetIndexPath,
    outputRoot,
    pythonExecutablePath,
    responsesWorkerPath,
    freeTextRunnerPath,
  })) {
    if (!path.isAbsolute(target ?? "")) throw new TypeError(`${label}는 절대경로여야 합니다.`);
  }
  if (!draftStore) throw new TypeError("생성 초안 저장소가 필요합니다.");

  function paths(id) {
    const safeId = validateId(id);
    return {
      job: path.join(jobRoot, `${safeId}.json`),
      context: path.join(jobRoot, `${safeId}.worker-context.json`),
      receipt: path.join(jobRoot, "receipts", `${safeId}.json`),
    };
  }

  async function start(id) {
    const safeId = validateId(id);
    const draft = await draftStore.get(safeId);
    if (
      draft.route !== "prompt-only" ||
      draft.mode !== "new" ||
      draft.sourceImageId !== null ||
      draft.characters?.mode !== "none" ||
      draft.style?.mode !== "none" ||
      !PURPOSES.has(draft.purpose) ||
      draft.executionEnabled !== false
    ) {
      throw executionError("NOT_PROMPT_ONLY", "프롬프트 자유 생성 초안만 실행할 수 있습니다.");
    }

    await Promise.all([
      requireFile(assetIndexPath, "자산 색인"),
      requireFile(pythonExecutablePath, "Python"),
      requireFile(responsesWorkerPath, "이미지 worker"),
      requireFile(freeTextRunnerPath, "무료 API runner"),
    ]);
    await mkdir(path.join(jobRoot, "receipts"), { recursive: true });
    const target = paths(safeId);
    let receiptHandle;
    try {
      receiptHandle = await open(target.receipt, "wx");
    } catch (error) {
      if (error.code === "EEXIST") {
        throw executionError("ALREADY_STARTED", "이 초안은 이미 실행 요청되었습니다.");
      }
      throw error;
    }

    const startedAt = now().toISOString();
    const job = {
      id: safeId,
      createdAt: draft.createdAt,
      startedAt,
      status: "processing",
      prompt: draft.prompt,
      count: 1,
      mode: "natural",
      purpose: draft.purpose,
      style: null,
      outputs: [],
      progress: { completed: 0, total: 1 },
      requestedBy: "hanabit-hub-owner",
    };

    try {
      const context = await buildContext(job, { assetIndexPath, outputRoot });
      await writeJsonAtomic(target.job, job);
      await writeContext(target.context, context);
      await receiptHandle.writeFile(JSON.stringify({ id: safeId, status: "started", startedAt }), "utf8");
      await receiptHandle.close();
      receiptHandle = null;
      await launchWorker({
        pythonExecutablePath,
        responsesWorkerPath,
        freeTextRunnerPath,
        jobPath: target.job,
        contextPath: target.context,
      });
      return Object.freeze({ id: safeId, status: "processing", route: "prompt-only", count: 1 });
    } catch (error) {
      if (receiptHandle) await receiptHandle.close();
      await writeJsonAtomic(target.job, {
        ...job,
        status: "failed",
        failedAt: now().toISOString(),
        error: "실행 준비 또는 시작에 실패했습니다.",
      });
      throw error.code ? error : executionError("LAUNCH_FAILED", "이미지 worker를 시작하지 못했습니다.");
    }
  }

  function normalizeJob(job, currentTime = now()) {
    const id = validateId(job.id);
    const startedAtMs = Date.parse(job.startedAt ?? job.createdAt ?? "");
    const completedAtMs = Date.parse(job.completedAt ?? job.failedAt ?? "");
    const elapsedMs = Number.isFinite(startedAtMs)
      ? Math.max(0, (Number.isFinite(completedAtMs) ? completedAtMs : currentTime.getTime()) - startedAtMs)
      : null;
    const rawStatus = ["processing", "complete", "failed"].includes(job.status)
      ? job.status
      : "processing";
    const stale = rawStatus === "processing" && elapsedMs !== null && elapsedMs >= STALE_AFTER_MS;
    const status = stale ? "attention" : rawStatus;
    const stage =
      status === "attention"
        ? "stalled"
        : status === "complete"
          ? "complete"
          : status === "failed"
            ? "failed"
            : job.textApi
              ? "generating"
              : "planning";
    const purpose = PURPOSES.has(job.purpose) ? job.purpose : "legacy-extra";
    return Object.freeze({
      id,
      purpose,
      status,
      stage,
      createdAt: String(job.createdAt ?? ""),
      startedAt: String(job.startedAt ?? ""),
      completedAt: String(job.completedAt ?? job.failedAt ?? ""),
      durationMs: elapsedMs,
      progress: {
        completed: Math.max(0, Math.min(1, Number(job.progress?.completed) || 0)),
        total: 1,
      },
      message:
        stage === "complete"
          ? "이미지 1장 생성 완료"
          : stage === "failed"
            ? "생성 작업을 완료하지 못했습니다. 내부 상태를 확인해주세요."
            : stage === "stalled"
              ? "20분 이상 갱신되지 않아 확인이 필요합니다."
              : stage === "generating"
                ? "이미지 1장을 생성하고 있어요."
                : "무료 API가 장면을 준비하고 있어요.",
    });
  }

  async function readJob(id) {
    const target = paths(id);
    try {
      return JSON.parse(await readFile(target.job, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        throw executionError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다.");
      }
      throw error;
    }
  }

  async function status(id) {
    return normalizeJob(await readJob(id));
  }

  async function list() {
    let entries;
    try {
      entries = await readdir(jobRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return { jobs: [], activeCount: 0, attentionCount: 0 };
      throw error;
    }
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !ID_PATTERN.test(entry.name.replace(/\.json$/u, ""))) continue;
      try {
        jobs.push(normalizeJob(JSON.parse(await readFile(path.join(jobRoot, entry.name), "utf8"))));
      } catch (error) {
        if (
          !(error instanceof SyntaxError)
          && error.code !== "ENOENT"
          && error.code !== "INVALID_ID"
        ) throw error;
      }
    }
    jobs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const recent = jobs.slice(0, 20);
    return Object.freeze({
      jobs: Object.freeze(recent),
      activeCount: jobs.filter((job) => job.status === "processing").length,
      attentionCount: jobs.filter((job) => job.status === "attention").length,
    });
  }

  return Object.freeze({ start, status, list });
}

export { defaultLaunch };
