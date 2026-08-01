import path from "node:path";
import { invokeFreeNewsAnalysis } from "./free-news-analysis.mjs";
import { createPendingNewsStore } from "./news-item-store.mjs";

const OFFICIAL_TYPES = new Set(["discord-announcement"]);

function failureCode(error) {
  const message = String(error?.message ?? "");
  if (message.includes("시간이 초과")) return "timeout";
  if (message.includes("형식") || error instanceof SyntaxError) return "invalid_response";
  if (message.includes("API 요청") || message.includes("runner") || message.includes("무료 API")) {
    return "provider_error";
  }
  return "unknown";
}

export function createNewsProcessor({ stateRoot, runnerPath, analyze = invokeFreeNewsAnalysis, now = () => new Date() }) {
  if (!path.isAbsolute(stateRoot) || !path.isAbsolute(runnerPath)) {
    throw new TypeError("뉴스 상태와 무료 API runner는 절대경로여야 합니다.");
  }
  const store = createPendingNewsStore({ root: stateRoot });
  const runtimeRoot = path.join(stateRoot, "runtime");
  const inFlight = new Map();

  async function process(id) {
    if (inFlight.has(id)) return inFlight.get(id);
    const task = (async () => {
      const record = await store.read(id);
      if (record.workflow?.status !== "pending_translation") return record;
      try {
        const result = await analyze(record, { runnerPath, runtimeRoot });
        const decision = OFFICIAL_TYPES.has(record.source?.type) ? "publish" : result.triage.decision;
        return store.update(id, (current) => ({
          ...current,
          workflow: {
            ...current.workflow,
            status: decision === "skip" ? "ignored" : "pending_review",
            translation: result.translation,
            triage: { ...result.triage, decision },
            analysisFailure: null,
            processedAt: now().toISOString(),
          },
        }));
      } catch (error) {
        return store.update(id, (current) => ({
          ...current,
          workflow: {
            ...current.workflow,
            status: "translation_failed",
            analysisFailure: {
              code: failureCode(error),
              failedAt: now().toISOString(),
            },
            processedAt: now().toISOString(),
          },
        }));
      }
    })();
    inFlight.set(id, task);
    try { return await task; }
    finally { inFlight.delete(id); }
  }

  async function retry(id) {
    const current = await store.read(id);
    if (current.workflow?.status !== "translation_failed") {
      const error = new Error("번역 실패한 뉴스만 다시 분석할 수 있습니다.");
      error.code = "NOT_RETRYABLE";
      throw error;
    }
    await store.update(id, (record) => ({
      ...record,
      workflow: {
        ...record.workflow,
        status: "pending_translation",
        analysisFailure: null,
      },
    }));
    return process(id);
  }

  return Object.freeze({ process, retry });
}
