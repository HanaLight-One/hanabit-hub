import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { findNewsSourceProfile } from "./news-source-profiles.mjs";
import { evaluateNewsAutoPublish, NEWS_ANALYSIS_POLICY_VERSION } from "./news-auto-publish-policy.mjs";
import { createNewsAnalysisNotice } from "./news-analysis-notice.mjs";

const ID_PATTERN = /^[a-f0-9]{32}$/u;
const MEDIA_NAME_PATTERN = /^[a-zA-Z0-9_-]+\.(gif|jpe?g|png|webp)$/u;
const CONTENT_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

function validateId(id) {
  if (!ID_PATTERN.test(id)) throw new TypeError("올바르지 않은 뉴스 식별자입니다.");
  return id;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function safeText(value, maximum) {
  return String(value ?? "").trim().slice(0, maximum);
}

function publicTriage(value) {
  if (!value || !["skip", "review", "publish"].includes(value.decision)) return null;
  return {
    decision: value.decision,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    importance: ["low", "medium", "high"].includes(value.importance) ? value.importance : null,
    evidenceTag: ["official", "confirmed", "inference", "rumor", "opinion"].includes(value.evidenceTag)
      ? value.evidenceTag
      : null,
    reason: safeText(value.reason, 500),
    advice: safeText(value.advice, 600) || null,
  };
}

function publicItem(record, sourceProfiles) {
  const id = validateId(String(record?.id ?? ""));
  const embeds = Array.isArray(record?.original?.embeds)
    ? record.original.embeds.map((embed) => ({
        title: String(embed?.title ?? ""),
        description: String(embed?.description ?? ""),
        url: safeUrl(embed?.url),
        fields: Array.isArray(embed?.fields)
          ? embed.fields.map((field) => ({
              name: String(field?.name ?? ""),
              value: String(field?.value ?? ""),
            }))
          : [],
      }))
    : [];
  const media = Array.isArray(record?.media)
    ? record.media
        .map((entry) => {
          const filename = path.basename(String(entry?.file ?? ""));
          if (!MEDIA_NAME_PATTERN.test(filename)) return null;
          return {
            kind: String(entry?.kind ?? "image"),
            contentType: CONTENT_TYPES.has(entry?.contentType) ? entry.contentType : null,
            size: Number(entry?.size) || 0,
            url: `/api/news/${id}/media/${encodeURIComponent(filename)}`,
          };
        })
        .filter(Boolean)
    : [];
  const triage = publicTriage(record?.workflow?.triage);
  const freeTriage = publicTriage(record?.workflow?.freeTriage);
  const codexReviewStatus = ["complete", "daily_limit", "failed"].includes(record?.workflow?.codexReview?.status)
    ? record.workflow.codexReview.status
    : null;

  const sourceProfile = findNewsSourceProfile(record?.source, sourceProfiles);
  const autoPublishGate = evaluateNewsAutoPublish(record, sourceProfile);
  const translationReviewStatus = ["free_unverified", "codex_verified", "codex_corrected", "human_verified"]
    .includes(record?.workflow?.translationReview?.status)
    ? record.workflow.translationReview.status
    : "free_unverified";
  const analysisNotice = safeText(record?.workflow?.analysisNotice, 300) ||
    createNewsAnalysisNotice({ codexReviewed: codexReviewStatus === "complete" });
  return {
    id,
    source: {
      type: String(record?.source?.type ?? ""),
      account: safeText(record?.source?.account, 40) || null,
      label: safeText(record?.source?.label, 80) || null,
      url: safeUrl(record?.source?.url),
      publishedAt: String(record?.source?.publishedAt ?? ""),
      profile: sourceProfile,
    },
    original: {
      language: String(record?.original?.language ?? ""),
      content: String(record?.original?.content ?? ""),
      embeds,
      links: Array.isArray(record?.original?.links)
        ? record.original.links.map(safeUrl).filter(Boolean)
        : [],
      contexts: Array.isArray(record?.original?.contexts)
        ? record.original.contexts.slice(0, 3).map((context) => ({
            relation: safeText(context?.relation, 40),
            account: safeText(context?.account, 40),
            label: safeText(context?.label, 80),
            content: safeText(context?.content, 8_000),
            url: safeUrl(context?.url),
          }))
        : [],
    },
    workflow: {
      status: String(record?.workflow?.status ?? "unknown"),
      hasTranslation: Boolean(record?.workflow?.translation),
      hasTriage: Boolean(record?.workflow?.triage),
      translation: record?.workflow?.translation
        ? {
            title: safeText(record.workflow.translation.title, 120),
            body: safeText(record.workflow.translation.body, 4_000),
          }
        : null,
      translationReview: {
        status: translationReviewStatus,
        reason: safeText(record?.workflow?.translationReview?.reason, 300) || null,
      },
      analysisNotice,
      triage,
      freeTriage,
      codexReview: codexReviewStatus
        ? {
            status: codexReviewStatus,
            reviewedAt: String(record.workflow.codexReview.reviewedAt ?? ""),
            ...(codexReviewStatus === "complete" ? publicTriage(record.workflow.codexReview) : {}),
          }
        : null,
      analysisFailure: record?.workflow?.status === "translation_failed"
        ? {
            code: ["timeout", "invalid_response", "provider_error", "unknown"].includes(record?.workflow?.analysisFailure?.code)
              ? record.workflow.analysisFailure.code
              : "unknown",
            failedAt: String(record?.workflow?.analysisFailure?.failedAt ?? ""),
          }
        : null,
      canApproveForDc:
        record?.workflow?.status === "pending_review" &&
        ["review", "publish"].includes(record?.workflow?.triage?.decision) &&
        !record?.workflow?.dcPublication,
      dcApproval: record?.workflow?.dcApproval?.status === "approved"
        ? {
            status: "approved",
            approvedAt: String(record.workflow.dcApproval.approvedAt ?? ""),
          }
        : null,
      publishedToDc: Boolean(record?.workflow?.dcPublication),
      autoPublishGate,
      canReanalyze:
        ["pending_review", "ignored"].includes(record?.workflow?.status) &&
        !record?.workflow?.dcApproval &&
        !record?.workflow?.dcPublication &&
        (Number(record?.workflow?.analysisPolicyVersion) || 0) < NEWS_ANALYSIS_POLICY_VERSION,
    },
    collectedAt: String(record?.collectedAt ?? ""),
    media,
  };
}

export function createNewsReader({ root, sourceProfiles = new Map() }) {
  if (!path.isAbsolute(root)) throw new TypeError("뉴스 상태 루트는 절대경로여야 합니다.");
  const pendingRoot = path.join(root, "pending");

  async function readRecord(id) {
    const target = path.join(pendingRoot, validateId(id), "item.json");
    return JSON.parse(await readFile(target, "utf8"));
  }

  async function list() {
    let entries;
    try {
      entries = await readdir(pendingRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return { items: [], total: 0, skipped: 0 };
      throw error;
    }

    const items = [];
    let skipped = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
      try {
        const item = publicItem(await readRecord(entry.name), sourceProfiles);
        if (item.id !== entry.name) throw new Error("뉴스 ID가 일치하지 않습니다.");
        items.push(item);
      } catch {
        skipped += 1;
      }
    }
    items.sort((left, right) =>
      String(right.source.publishedAt).localeCompare(String(left.source.publishedAt)),
    );
    return { items: items.slice(0, 100), total: items.length, skipped };
  }

  async function findMedia(id, filename) {
    validateId(id);
    if (!MEDIA_NAME_PATTERN.test(filename)) {
      throw new TypeError("올바르지 않은 미디어 식별자입니다.");
    }
    const record = await readRecord(id);
    const expected = `media/${filename}`;
    const media = record.media?.find((entry) => entry.file === expected);
    if (!media || !CONTENT_TYPES.has(media.contentType)) return null;

    const mediaRoot = path.resolve(pendingRoot, id, "media");
    const target = path.resolve(mediaRoot, filename);
    if (!target.startsWith(`${mediaRoot}${path.sep}`)) {
      throw new TypeError("미디어 경로가 대기함을 벗어났습니다.");
    }
    const info = await stat(target);
    if (!info.isFile()) return null;
    return { target, contentType: media.contentType, size: info.size };
  }

  return Object.freeze({ list, findMedia });
}
