import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildImageStudioQueueContext,
  writeImageStudioQueueContext,
} from "./image-studio-queue-context.mjs";

const ID_PATTERN = /^[a-f0-9]{32}$/u;

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

    const startedAt = new Date().toISOString();
    const job = {
      id: safeId,
      createdAt: draft.createdAt,
      startedAt,
      status: "processing",
      prompt: draft.prompt,
      count: 1,
      mode: "natural",
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
        failedAt: new Date().toISOString(),
        error: "실행 준비 또는 시작에 실패했습니다.",
      });
      throw error.code ? error : executionError("LAUNCH_FAILED", "이미지 worker를 시작하지 못했습니다.");
    }
  }

  async function status(id) {
    const target = paths(id);
    let job;
    try {
      job = JSON.parse(await readFile(target.job, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        throw executionError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다.");
      }
      throw error;
    }
    const knownStatus = ["processing", "complete", "failed"].includes(job.status)
      ? job.status
      : "processing";
    return Object.freeze({
      id: validateId(id),
      status: knownStatus,
      progress: {
        completed: Math.max(0, Math.min(1, Number(job.progress?.completed) || 0)),
        total: 1,
      },
      message:
        knownStatus === "complete"
          ? "이미지 1장 생성 완료"
          : knownStatus === "failed"
            ? "생성 작업을 완료하지 못했습니다. 내부 상태를 확인해주세요."
            : "이미지 1장을 생성하고 있어요.",
    });
  }

  return Object.freeze({ start, status });
}

export { defaultLaunch };
