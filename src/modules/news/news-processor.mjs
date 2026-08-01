import path from "node:path";
import { invokeFreeNewsAnalysis } from "./free-news-analysis.mjs";
import { createPendingNewsStore } from "./news-item-store.mjs";

const OFFICIAL_TYPES = new Set(["discord-announcement"]);

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
            processedAt: now().toISOString(),
          },
        }));
      } catch {
        return store.update(id, (current) => ({
          ...current,
          workflow: {
            ...current.workflow,
            status: "translation_failed",
            processedAt: now().toISOString(),
          },
        }));
      }
    })();
    inFlight.set(id, task);
    try { return await task; }
    finally { inFlight.delete(id); }
  }

  return Object.freeze({ process });
}
