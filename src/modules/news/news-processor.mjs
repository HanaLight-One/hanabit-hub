import path from "node:path";
import { invokeFreeNewsAnalysis } from "./free-news-analysis.mjs";
import { createPendingNewsStore } from "./news-item-store.mjs";
import { findNewsSourceProfile } from "./news-source-profiles.mjs";
import { NEWS_ANALYSIS_POLICY_VERSION } from "./news-auto-publish-policy.mjs";
import { createNewsAnalysisNotice } from "./news-analysis-notice.mjs";

const OFFICIAL_TYPES = new Set(["discord-announcement"]);
const OFFICIAL_X_ACCOUNTS = new Set(["openai", "openaidevs"]);

function isOfficialSource(source) {
  return OFFICIAL_TYPES.has(source?.type) ||
    (source?.type === "x-post" && OFFICIAL_X_ACCOUNTS.has(String(source?.account ?? "").toLowerCase()));
}

function failureCode(error) {
  const message = String(error?.message ?? "");
  if (message.includes("시간이 초과")) return "timeout";
  if (message.includes("형식") || error instanceof SyntaxError) return "invalid_response";
  if (message.includes("API 요청") || message.includes("runner") || message.includes("무료 API")) {
    return "provider_error";
  }
  return "unknown";
}

export function createNewsProcessor({ stateRoot, runnerPath, analyze = invokeFreeNewsAnalysis, codexReviewer = null, sourceProfiles = new Map(), now = () => new Date() }) {
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
        const profile = findNewsSourceProfile(record.source, sourceProfiles);
        const analysisRecord = profile
          ? { ...record, source: { ...record.source, profile } }
          : record;
        const result = await analyze(analysisRecord, { runnerPath, runtimeRoot });
        let finalTriage = result.triage;
        let finalTranslation = result.translation;
        let finalContextTranslations = result.contextTranslations;
        let translationReview = {
          status: "free_unverified",
          reviewer: "gpt-5.4-mini",
          reviewedAt: now().toISOString(),
        };
        let freeTriage = null;
        let codexReview = null;
        if (codexReviewer) {
          try {
            const reviewed = await codexReviewer.review(analysisRecord, result);
            if (reviewed.status === "complete") {
              freeTriage = result.triage;
              const { translationAudit, contextTranslationAudits, ...reviewTriage } = reviewed.result;
              finalTriage = { ...reviewTriage, signals: ["codex-review"] };
              if (translationAudit && Array.isArray(contextTranslationAudits)) {
                finalTranslation = {
                  title: translationAudit.title,
                  body: translationAudit.body,
                };
                finalContextTranslations = contextTranslationAudits.map((entry) => ({
                  index: entry.index,
                  body: entry.body,
                }));
                const corrected = translationAudit.status === "corrected" ||
                  contextTranslationAudits.some((entry) => entry.status === "corrected");
                translationReview = {
                  status: corrected ? "codex_corrected" : "codex_verified",
                  reviewer: "codex-deep-review",
                  reason: [translationAudit.reason, ...contextTranslationAudits.map((entry) => entry.reason)].join(" ").slice(0, 300),
                  reviewedAt: reviewed.reviewedAt,
                };
              }
              codexReview = {
                status: "complete",
                reviewedAt: reviewed.reviewedAt,
                ...reviewTriage,
              };
            } else if (["daily_limit", "failed"].includes(reviewed.status)) {
              codexReview = {
                status: reviewed.status,
                reviewedAt: reviewed.reviewedAt ?? now().toISOString(),
              };
            }
          } catch {
            codexReview = { status: "failed", reviewedAt: now().toISOString() };
          }
        }
        const official = isOfficialSource(record.source);
        const decision = official ? "publish" : finalTriage.decision;
        return store.update(id, (current) => ({
          ...current,
          workflow: {
            ...current.workflow,
            status: decision === "skip" ? "ignored" : "pending_review",
            translation: finalTranslation,
            contextTranslations: finalContextTranslations,
            translationReview,
            analysisNotice: createNewsAnalysisNotice({ codexReviewed: codexReview?.status === "complete" }),
            freeTriage,
            triage: { ...finalTriage, decision, evidenceTag: official ? "official" : finalTriage.evidenceTag },
            codexReview,
            analysisFailure: null,
            analysisPolicyVersion: NEWS_ANALYSIS_POLICY_VERSION,
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

  async function reprocess(id) {
    const current = await store.read(id);
    const workflow = current.workflow ?? {};
    const alreadyCurrent = Number(workflow.analysisPolicyVersion) >= NEWS_ANALYSIS_POLICY_VERSION;
    if (
      !["pending_review", "ignored"].includes(workflow.status) ||
      workflow.dcApproval ||
      workflow.dcPublication ||
      alreadyCurrent
    ) {
      const error = new Error("승인·게시 전의 판정 완료 뉴스만 새 정책으로 다시 판정할 수 있습니다.");
      error.code = "NOT_REPROCESSABLE";
      throw error;
    }
    const nextRevision = Math.max(1, Number(workflow.analysisRevision) || 1) + 1;
    await store.update(id, (record) => ({
      ...record,
      workflow: {
        ...record.workflow,
        status: "pending_translation",
        translation: null,
        freeTriage: null,
        triage: null,
        codexReview: null,
        analysisFailure: null,
        analysisRevision: nextRevision,
        analysisPolicyVersion: null,
        reanalysisRequestedAt: now().toISOString(),
      },
    }));
    return process(id);
  }

  return Object.freeze({ process, retry, reprocess });
}
