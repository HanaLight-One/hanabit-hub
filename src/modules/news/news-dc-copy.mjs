import { createHash } from "node:crypto";
import { findNewsSourceProfile } from "./news-source-profiles.mjs";
import { createNewsAnalysisNotice } from "./news-analysis-notice.mjs";

const EVIDENCE_LABELS = Object.freeze({
  official: "공식",
  confirmed: "확정",
  inference: "유추",
  rumor: "루머",
  opinion: "의견",
});
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{20E3}]/gu;
const COMBINING_MARK_PATTERN = /\p{M}/gu;

function safeText(value, maximum = 8_000) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").trim().slice(0, maximum);
}

function stripEmoji(value) {
  let removed = 0;
  const text = safeText(value).replace(EMOJI_PATTERN, () => {
    removed += 1;
    return "";
  }).replace(/[ \t]+\n/gu, "\n").replace(/[ \t]{2,}/gu, " ").trim();
  return { text, removed };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function hasKnownDcRisk(url) {
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname);
    return /(?:^|\/)sk(?:\/|$)/iu.test(decodedPath);
  } catch {
    return true;
  }
}

function sourceLinks(record) {
  const candidates = [record?.source?.url, ...(record?.original?.links ?? [])]
    .map(safeHttpUrl)
    .filter(Boolean);
  const unique = [...new Set(candidates)];
  return {
    included: unique.filter((url) => !hasKnownDcRisk(url)).slice(0, 4),
    omitted: unique.filter(hasKnownDcRisk).length,
  };
}

function cleanLine(value, counter) {
  const result = stripEmoji(value);
  counter.removed += result.removed;
  return result.text;
}

function section(label, body, counter) {
  const cleanBody = cleanLine(body, counter);
  return cleanBody ? { label, body: cleanBody } : null;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function textToDcHtml(value) {
  return String(value)
    .split("\n")
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>")
    .join("");
}

export function composeNewsDcCopy(record, { sourceProfiles = new Map() } = {}) {
  if (!record?.workflow?.translation || !record?.workflow?.triage) {
    throw Object.assign(new Error("번역과 판정이 끝난 뉴스만 원고를 만들 수 있습니다."), {
      code: "NOT_REVIEWABLE",
    });
  }
  if (!["review", "publish"].includes(record.workflow.triage.decision)) {
    throw Object.assign(new Error("게시 검토 후보만 원고를 만들 수 있습니다."), {
      code: "NOT_REVIEWABLE",
    });
  }

  const counter = { removed: 0 };
  const evidenceLabel = EVIDENCE_LABELS[record.workflow.triage.evidenceTag] ?? "확인 필요";
  const translatedTitle = cleanLine(record.workflow.translation.title || "제목 없음", counter);
  const title = [...`[${evidenceLabel}] ${translatedTitle}`].slice(0, 80).join("").trim();
  const profile = findNewsSourceProfile(record.source, sourceProfiles);
  const sourceName = cleanLine(
    profile?.displayName || record.source?.label || record.source?.account || "출처 확인 필요",
    counter,
  );
  const profileLines = [
    `게시자: ${sourceName}`,
    profile
      ? [profile.affiliation, ...(profile.roles ?? [])].filter(Boolean).join(" · ")
      : "출처 정보 확인 필요",
    profile?.whyTracked,
    profile?.topics?.length ? `주요 분야: ${profile.topics.join(" · ")}` : null,
    profile?.trustLabel ? `출처 구분: ${profile.trustLabel}` : null,
    profile
      ? `소속 확인: ${profile.affiliationConfirmed ? "확인됨" : "사람 재확인 필요"}${
          profile.verifiedAt ? ` · ${profile.verifiedAt}` : ""
        }`
      : null,
  ].filter(Boolean).map((line) => cleanLine(line, counter));

  const sections = [
    section("본문 번역", record.workflow.translation.body, counter),
    ...(record.workflow.contextTranslations ?? []).slice(0, 3).map((translation) => {
      const index = Math.max(1, Math.min(3, Number(translation?.index) || 1));
      const context = record.original?.contexts?.[index - 1];
      const owner = context?.label || context?.account || `관련 글 ${index}`;
      return section(`관련 글 번역 · ${owner}`, translation?.body, counter);
    }),
    section("왜 중요한가", record.workflow.triage.reason, counter),
    section("아직 확인되지 않은 점", record.workflow.triage.advice, counter),
  ].filter(Boolean);

  const notice = cleanLine(
    record.workflow.analysisNotice || createNewsAnalysisNotice({
      codexReviewed: record.workflow.codexReview?.status === "complete",
    }),
    counter,
  );
  const links = sourceLinks(record);
  const bodyParts = [
    ...profileLines,
    "",
    ...sections.flatMap(({ label, body }) => [label, body, ""]),
    notice,
    ...(links.included.length ? ["", "원문 링크", ...links.included] : []),
  ];
  const bodyText = bodyParts.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  const combiningMarkCount = (bodyText.match(COMBINING_MARK_PATTERN) ?? []).length +
    (title.match(COMBINING_MARK_PATTERN) ?? []).length;
  const imageCount = Array.isArray(record.media) ? record.media.length : 0;
  const warnings = [
    ...(counter.removed ? [`DC 비지원 이모지 ${counter.removed}개를 원고에서 제거했어요.`] : []),
    ...(links.omitted ? [`DC 필터 위험 경로가 포함된 링크 ${links.omitted}개를 원고에서 제외했어요.`] : []),
    ...(imageCount > 10 ? ["DC 뉴스 게시 이미지 상한 10장을 초과했어요."] : []),
    "DC 금칙어는 변동될 수 있어 최종 제출이 거부될 수 있어요.",
  ];
  const contentHash = createHash("sha256")
    .update(`${title}\0${bodyText}\0${imageCount}`)
    .digest("hex");

  return Object.freeze({
    schemaVersion: 1,
    headText: "뉴스/소식",
    title,
    bodyText,
    bodyHtml: textToDcHtml(bodyText),
    sections: Object.freeze(sections),
    imageCount,
    imagePlacement: "start",
    preflight: Object.freeze({
      ready: combiningMarkCount === 0 && imageCount <= 10,
      emojiRemovedCount: counter.removed,
      combiningMarkCount,
      omittedRiskyLinkCount: links.omitted,
      warnings: Object.freeze(warnings),
    }),
    contentHash,
  });
}

export const newsDcCopyPolicy = Object.freeze({
  evidenceLabels: EVIDENCE_LABELS,
  headText: "뉴스/소식",
});
