import { createHash } from "node:crypto";
import { findNewsSourceProfile } from "./news-source-profiles.mjs";
import { createNewsAnalysisNotice } from "./news-analysis-notice.mjs";
import { selectNewsDcHeadText } from "./news-dc-head-text.mjs";
import { normalizeOfficialMarkdownLink } from "./official-doc-url.mjs";
import newsDcHtml from "./news-dc-html.cjs";

const { textToHtml } = newsDcHtml;

const EVIDENCE_LABELS = Object.freeze({
  official: "공식",
  confirmed: "확정",
  use_case: "사례",
  inference: "유추",
  rumor: "루머",
  opinion: "의견",
});
const HUB_ONLY_TITLE_LABELS = Object.freeze([
  ...Object.values(EVIDENCE_LABELS),
  "장애",
  "장애발생",
  "장애확대",
  "장애현황",
  "부분복구",
  "복구완료",
]);
const HUB_ONLY_TITLE_PREFIX = new RegExp(
  `^(?:\\[(?:${HUB_ONLY_TITLE_LABELS.join("|")})\\]\\s*)+`,
  "u",
);
const UNCONFIRMED_TEXTS = Object.freeze({
  official: "세부 제공 범위와 적용 시점은 원문만으로 모두 확인되지 않았습니다.",
  confirmed: "세부 제공 범위와 적용 시점은 원문만으로 모두 확인되지 않았습니다.",
  use_case: "이 사례가 다른 환경에서도 동일하게 재현되는지는 원문만으로 확인되지 않았습니다.",
  inference: "구체적인 기능명·제공 범위·출시 상태는 원문만으로 확인되지 않았습니다.",
  rumor: "공식 발표 여부와 구체적인 내용은 원문만으로 확인되지 않았습니다.",
  opinion: "개인의 의견이며 제품 출시나 공식 계획으로 확인된 내용은 아닙니다.",
});
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{20E3}]/gu;
const COMBINING_MARK_PATTERN = /\p{M}/gu;
const TITLE_REVIEW_PLACEHOLDER = "내용 확인 필요";
const OFFICIAL_RELEASE_LABELS = Object.freeze({
  "openai/codex": "Codex",
  "openai/openai-python": "OpenAI Python SDK",
  "openai/openai-node": "OpenAI Node.js SDK",
  "openai/openai-agents-python": "OpenAI Agents SDK Python",
  "openai/openai-agents-js": "OpenAI Agents SDK JavaScript",
});
const FAST_PRICE_CONTEXT_LABEL = "OpenAI 공식 Fast 가격표";
const FAST_PRICE_MODELS = Object.freeze({
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-5.6-luna": "GPT-5.6 Luna",
});

function safeText(value, maximum = 8_000) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").trim().slice(0, maximum);
}

function stripMarkdownArtifacts(value) {
  return String(value ?? "")
    .replace(/^[ \t]*[-*+][ \t]+/gmu, "• ")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gmu, "");
}

function isFastPriceContext(context) {
  if (context?.relation !== "official-document") return false;
  if (context?.label === FAST_PRICE_CONTEXT_LABEL) return true;
  try {
    const url = new URL(context?.url);
    return url.hostname.toLowerCase() === "developers.openai.com" &&
      url.pathname === "/api/docs/pricing" &&
      url.searchParams.get("latest-pricing") === "fast";
  } catch {
    return false;
  }
}

function formatFastPriceContext(context, value) {
  if (!isFastPriceContext(context)) return value;

  const rows = new Map();
  for (const line of String(value ?? "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
    const modelKey = cells[0]?.toLowerCase();
    if (!(modelKey in FAST_PRICE_MODELS) || cells.length !== 9) continue;
    if (!cells.slice(1).every((price) => /^\$\d+(?:\.\d+)?$/u.test(price))) continue;
    rows.set(modelKey, cells.slice(1));
  }
  if (rows.size !== Object.keys(FAST_PRICE_MODELS).length) return value;

  const modelBlocks = Object.entries(FAST_PRICE_MODELS).map(([modelKey, modelLabel]) => {
    const [shortInput, shortCachedInput, shortCacheWrite, shortOutput,
      longInput, longCachedInput, longCacheWrite, longOutput] = rows.get(modelKey);
    return [
      modelLabel,
      `짧은 문맥: 입력 ${shortInput} · 캐시 입력 ${shortCachedInput} · 캐시 쓰기 ${shortCacheWrite} · 출력 ${shortOutput}`,
      `긴 문맥: 입력 ${longInput} · 캐시 입력 ${longCachedInput} · 캐시 쓰기 ${longCacheWrite} · 출력 ${longOutput}`,
    ].join("\n");
  });
  return ["Fast 모드 가격 · 100만 토큰 기준(USD)", ...modelBlocks].join("\n\n");
}

function releaseAwareTitle(record, value) {
  const title = String(value ?? "").trim();
  if (record?.source?.type !== "official-github-release") return title;
  const label = OFFICIAL_RELEASE_LABELS[record.source.repository];
  if (!label || title.toLocaleLowerCase("en-US").includes(label.toLocaleLowerCase("en-US"))) return title;
  return `${label} ${title}`;
}

function stripHubOnlyTitleLabels(value) {
  return String(value ?? "").replace(HUB_ONLY_TITLE_PREFIX, "").trim();
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

function isDirectMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === "video.twimg.com" ||
      /\.(?:gif|jpe?g|m4v|mov|mp4|png|webm|webp)(?:$|[?#])/iu.test(url.pathname);
  } catch {
    return true;
  }
}

function sourceLinks(record) {
  const candidates = [record?.source?.url, ...(record?.original?.links ?? [])]
    .map((value) => normalizeOfficialMarkdownLink(value) ?? safeHttpUrl(value))
    .filter(Boolean)
    .filter((url) => !isDirectMediaUrl(url));
  let unique = [...new Set(candidates)];
  if (record?.source?.type === "discord-announcement") {
    const external = unique.filter((url) => new URL(url).hostname.toLowerCase() !== "discord.com");
    if (external.length) unique = external;
  }
  return {
    included: unique.filter((url) => !hasKnownDcRisk(url)).slice(0, 4),
    omitted: unique.filter(hasKnownDcRisk).length,
  };
}

function cleanLine(value, counter) {
  const result = stripEmoji(stripMarkdownArtifacts(value));
  counter.removed += result.removed;
  return result.text;
}

function conciseHeadline(value, counter, maximum = 56) {
  const cleaned = cleanLine(value, counter).replace(/\s+/gu, " ").trim();
  if (!cleaned) return "";
  const firstSentence = cleaned.match(/^.*?[.!?](?=\s|$)/u)?.[0] ?? cleaned;
  const headline = firstSentence.replace(/[.!?]+$/u, "").trim();
  return [...headline].length <= maximum ? headline : "";
}

function translatedHeadline(record, counter) {
  const primary = conciseHeadline(
    stripHubOnlyTitleLabels(
      releaseAwareTitle(record, record?.workflow?.publicHeadline || record?.workflow?.translation?.title),
    ),
    counter,
  );
  if (primary) return primary;

  const contextBodies = (record?.workflow?.contextTranslations ?? []).map((entry) => entry?.body);
  for (const candidate of [
    ...contextBodies,
    record?.workflow?.translation?.body,
    record?.workflow?.triage?.reason,
  ]) {
    const fallback = conciseHeadline(stripHubOnlyTitleLabels(candidate), counter);
    if (fallback) return fallback;
  }
  return TITLE_REVIEW_PLACEHOLDER;
}

function section(label, body, counter) {
  const cleanLabel = cleanLine(label, counter);
  const cleanBody = cleanLine(body, counter);
  return cleanBody ? { label: cleanLabel || "내용", body: cleanBody } : null;
}

export function textToDcHtml(value) {
  return textToHtml(value);
}

export function composeNewsDcCopy(record, { sourceProfiles = new Map(), fallbackCover = false } = {}) {
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
  const translatedTitle = translatedHeadline(record, counter);
  const title = translatedTitle;
  const titleNeedsReview = translatedTitle === TITLE_REVIEW_PLACEHOLDER;
  const profile = findNewsSourceProfile(record.source, sourceProfiles);
  const headText = selectNewsDcHeadText(record, profile);
  const sourceName = cleanLine(
    profile?.displayName || record.source?.label || record.source?.account || "출처 확인 필요",
    counter,
  );
  const profileLine = [
    `게시자: ${sourceName}`,
    profile?.affiliation,
    ...(profile?.roles ?? []).slice(0, 2),
    profile?.trustLabel,
  ].filter(Boolean).map((part) => cleanLine(part, counter)).join(" · ");

  const translationSections = [
    section("본문 번역", record.workflow.translation.body, counter),
    ...(record.workflow.contextTranslations ?? []).slice(0, 3).map((translation) => {
      const index = Math.max(1, Math.min(3, Number(translation?.index) || 1));
      const context = record.original?.contexts?.[index - 1];
      const owner = context?.label || context?.account || `관련 글 ${index}`;
      const label = context?.relation === "official-document"
        ? `공식 문서 주요 내용 · ${owner}`
        : `관련 글 번역 · ${owner}`;
      return section(label, formatFastPriceContext(context, translation?.body), counter);
    }),
  ].filter(Boolean);
  const readerSummarySection = section("한눈에 보면", record.workflow.readerSummary, counter);
  const editorNote = cleanLine(record.workflow.dcEditorNote, counter);
  const analysisSections = [
    section(
      "아직 확인되지 않은 점",
      UNCONFIRMED_TEXTS[record.workflow.triage.evidenceTag] ?? UNCONFIRMED_TEXTS.inference,
      counter,
    ),
  ].filter(Boolean);
  const sections = [readerSummarySection, ...translationSections, ...analysisSections].filter(Boolean);

  const notice = cleanLine(
    record.workflow.analysisNotice || createNewsAnalysisNotice({
      codexReviewed: record.workflow.codexReview?.status === "complete",
    }),
    counter,
  );
  const links = sourceLinks(record);
  const bodyParts = [
    ...(links.included.length ? ["원문 링크", ...links.included, ""] : []),
    profileLine,
    "",
    ...(readerSummarySection ? [readerSummarySection.label, readerSummarySection.body, ""] : []),
    ...translationSections.flatMap(({ label, body }) => [label, body, ""]),
    ...analysisSections.flatMap(({ label, body }) => [label, body, ""]),
    notice,
    ...(editorNote ? ["", editorNote] : []),
  ];
  const bodyText = bodyParts.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  const combiningMarkCount = (bodyText.match(COMBINING_MARK_PATTERN) ?? []).length +
    (title.match(COMBINING_MARK_PATTERN) ?? []).length;
  const storedImageCount = Array.isArray(record.media) ? record.media.length : 0;
  const sourceImageCount = storedImageCount || (record?.internal?.xVideo ? 1 : 0);
  const usesFallbackCover = sourceImageCount === 0 && fallbackCover === true;
  const imageCount = sourceImageCount + (usesFallbackCover ? 1 : 0);
  const warnings = [
    ...(counter.removed ? [`DC 비지원 이모지 ${counter.removed}개를 원고에서 제거했어요.`] : []),
    ...(links.omitted ? [`DC 필터 위험 경로가 포함된 링크 ${links.omitted}개를 원고에서 제외했어요.`] : []),
    ...(imageCount > 10 ? ["DC 뉴스 게시 이미지 상한 10장을 초과했어요."] : []),
    ...(titleNeedsReview ? ["정보성 게시 제목을 만들지 못해 제목 확인이 필요해요."] : []),
    "DC 금칙어는 변동될 수 있어 최종 제출이 거부될 수 있어요.",
  ];
  const contentHash = createHash("sha256")
    .update(`${title}\0${bodyText}\0${imageCount}`)
    .digest("hex");

  return Object.freeze({
    schemaVersion: 1,
    headText,
    title,
    bodyText,
    bodyHtml: textToDcHtml(bodyText),
    sections: Object.freeze(sections),
    editorNote,
    imageCount,
    sourceImageCount,
    usesFallbackCover,
    imagePlacement: "start",
    preflight: Object.freeze({
      ready: combiningMarkCount === 0 && imageCount <= 10 && !titleNeedsReview,
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
  hubOnlyTitleLabels: HUB_ONLY_TITLE_LABELS,
});
