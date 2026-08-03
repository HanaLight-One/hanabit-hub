import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discordMediaCandidates } from "./discord-announcement.mjs";

const STATUS_URL_PATTERN = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/giu;
const OEMBED_HOSTS = new Set(["publish.x.com", "publish.twitter.com"]);
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const X_SHORT_HOSTS = new Set(["t.co", "www.t.co"]);
const MAX_CONTEXT_POSTS = 3;
const SOURCE_KINDS = new Set(["official", "person", "candidate"]);
const AFFILIATION_STATUSES = new Set(["confirmed", "review_required", "former"]);
const TRUST_LEVELS = new Set(["official", "high", "standard", "candidate"]);
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const STREAM_LANE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const STREAM_TERM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,49}$/u;
const STREAM_PHRASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+/-]{0,79}$/u;
const STREAM_DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,20}$/u;

function looksTruncated(value) {
  return /(?:\u2026|\.{3})\s*$/u.test(String(value ?? "").trim());
}

function safeXVideoVariant(value) {
  try {
    const target = new URL(String(value ?? ""));
    if (target.protocol !== "https:" || target.hostname !== "video.twimg.com" || !target.pathname.endsWith(".mp4")) {
      return null;
    }
    return target.href;
  } catch {
    return null;
  }
}

function selectXVideo(media) {
  if (!["video", "animated_gif"].includes(media?.type) || !Array.isArray(media.variants)) return null;
  const variants = media.variants
    .map((variant) => ({
      bitRate: Number(variant?.bit_rate) || 0,
      url: safeXVideoVariant(variant?.url),
    }))
    .filter((variant) => variant.url)
    .sort((left, right) => left.bitRate - right.bitRate);
  if (!variants.length) return null;
  const preferred = [...variants].reverse().find((variant) => variant.bitRate <= 2_176_000)
    ?? variants[0];
  return {
    mediaKey: String(media.media_key ?? "").slice(0, 80),
    variantUrl: preferred.url,
    durationMs: Math.max(0, Math.min(Number(media.duration_ms) || 0, 60 * 60 * 1000)),
    width: Math.max(0, Math.min(Number(media.width) || 0, 7680)),
    height: Math.max(0, Math.min(Number(media.height) || 0, 7680)),
  };
}

async function fetchXPostDetails(post, { bearerToken, fetchImpl, includeVideo = false }) {
  if (!bearerToken || !/^\d{5,25}$/u.test(String(post?.statusId ?? ""))) return null;
  const endpoint = new URL(`https://api.x.com/2/tweets/${post.statusId}`);
  endpoint.searchParams.set("tweet.fields", includeVideo ? "note_tweet,attachments" : "note_tweet");
  if (includeVideo) {
    endpoint.searchParams.set("expansions", "attachments.media_keys");
    endpoint.searchParams.set("media.fields", "type,variants,duration_ms,width,height");
  }
  try {
    const response = await fetchImpl(endpoint, {
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 256_000) return null;
    const payload = JSON.parse(text);
    if (String(payload?.data?.id ?? "") !== String(post.statusId)) return null;
    const fullText = String(payload?.data?.note_tweet?.text ?? payload?.data?.text ?? "").trim();
    const attachedKeys = new Set(payload?.data?.attachments?.media_keys ?? []);
    const video = includeVideo
      ? (payload?.includes?.media ?? [])
          .filter((media) => attachedKeys.has(media?.media_key))
          .map(selectXVideo)
          .find(Boolean) ?? null
      : null;
    return {
      fullText: fullText && fullText.length <= 16_000 ? fullText : null,
      video,
    };
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function messageText(message) {
  return [
    message?.content,
    ...[...(message?.embeds?.values?.() ?? message?.embeds ?? [])].flatMap((embed) => [
      embed?.url,
      embed?.title,
      embed?.description,
    ]),
  ].filter(Boolean).join("\n");
}

function xPostsFromText(value) {
  return [...String(value ?? "").matchAll(STATUS_URL_PATTERN)].map((match) => ({
    handle: match[1],
    statusId: match[2],
    url: `https://x.com/${match[1]}/status/${match[2]}`,
  }));
}

function xPostFromUrl(value) {
  try {
    const target = new URL(String(value ?? ""));
    if (!X_HOSTS.has(target.hostname.toLowerCase())) return null;
    return xPostsFromText(target.href)[0] ?? null;
  } catch {
    return null;
  }
}

function hrefsFromHtml(value) {
  return [...String(value ?? "").matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1/giu)]
    .map((match) => decodeHtml(match[2]));
}

async function resolveRelatedPost(value, fetchImpl) {
  const direct = xPostFromUrl(value);
  if (direct) return direct;
  let target;
  try {
    target = new URL(String(value ?? ""));
  } catch {
    return null;
  }
  if (!X_SHORT_HOSTS.has(target.hostname.toLowerCase())) return null;
  const response = await fetchImpl(target, { redirect: "manual" });
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers?.get?.("location");
  if (!location) return null;
  return xPostFromUrl(new URL(location, target).href);
}

async function relatedPostsFromHtml(value, { fetchImpl, primary }) {
  const posts = [];
  const seen = new Set([primary.statusId]);
  for (const href of hrefsFromHtml(value).slice(0, 12)) {
    if (posts.length >= MAX_CONTEXT_POSTS) break;
    try {
      const post = await resolveRelatedPost(href, fetchImpl);
      if (!post || seen.has(post.statusId)) continue;
      seen.add(post.statusId);
      posts.push(post);
    } catch {
      // 보조 문맥 실패가 기본 X 게시물 수집을 막지 않게 한다.
    }
  }
  return posts;
}

function normalizeRosterSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("X 출처 항목이 올바르지 않습니다.");
  }
  const handle = String(value.handle ?? "");
  const displayName = String(value.displayName ?? "").trim();
  const affiliation = String(value.affiliation ?? "").trim();
  const roles = Array.isArray(value.roles) ? [...new Set(value.roles)] : [];
  const topics = Array.isArray(value.topics) ? [...new Set(value.topics)] : [];
  if (!HANDLE_PATTERN.test(handle) || !displayName || displayName.length > 80) {
    throw new TypeError("X 출처 계정 정보가 올바르지 않습니다.");
  }
  if (!SOURCE_KINDS.has(value.sourceKind) || !AFFILIATION_STATUSES.has(value.affiliationStatus)) {
    throw new TypeError("X 출처 소속 상태가 올바르지 않습니다.");
  }
  if (!affiliation || affiliation.length > 80 || !TRUST_LEVELS.has(value.trustLevel)) {
    throw new TypeError("X 출처 신뢰 정보가 올바르지 않습니다.");
  }
  if (!roles.length || roles.length > 8 || roles.some((role) => !TOPIC_PATTERN.test(role))) {
    throw new TypeError("X 출처 역할이 올바르지 않습니다.");
  }
  if (!topics.length || topics.length > 12 || topics.some((topic) => !TOPIC_PATTERN.test(topic))) {
    throw new TypeError("X 출처 분야가 올바르지 않습니다.");
  }
  if (value.verifiedAt !== null && !DATE_PATTERN.test(String(value.verifiedAt ?? ""))) {
    throw new TypeError("X 출처 마지막 확인일이 올바르지 않습니다.");
  }
  if (typeof value.enabled !== "boolean") {
    throw new TypeError("X 출처 활성 상태가 올바르지 않습니다.");
  }
  if (value.sourceKind === "official" && value.trustLevel !== "official") {
    throw new TypeError("X 공식 출처의 신뢰등급이 올바르지 않습니다.");
  }
  if (value.affiliationStatus === "former" && value.enabled) {
    throw new TypeError("소속 종료 출처는 자동 감시할 수 없습니다.");
  }
  return Object.freeze({
    handle,
    displayName,
    sourceKind: value.sourceKind,
    affiliation,
    affiliationStatus: value.affiliationStatus,
    roles: Object.freeze(roles),
    topics: Object.freeze(topics),
    trustLevel: value.trustLevel,
    verifiedAt: value.verifiedAt,
    enabled: value.enabled,
  });
}

export async function loadXSourceRoster(target) {
  if (!path.isAbsolute(target)) throw new TypeError("X 출처 설정은 절대경로여야 합니다.");
  const parsed = JSON.parse(await readFile(target, "utf8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources) || !parsed.sources.length) {
    throw new TypeError("X 출처 allowlist가 올바르지 않습니다.");
  }
  const sources = parsed.sources.map(normalizeRosterSource);
  const normalizedHandles = sources.map((source) => source.handle.toLowerCase());
  if (new Set(normalizedHandles).size !== normalizedHandles.length) {
    throw new TypeError("X 출처 계정이 중복되었습니다.");
  }
  return Object.freeze({
    schemaVersion: 1,
    sources: Object.freeze(sources),
  });
}

export async function loadXSourceAllowlist(target) {
  const roster = await loadXSourceRoster(target);
  return new Set(roster.sources
    .filter((source) => source.enabled && source.affiliationStatus !== "former")
    .map((source) => source.handle.toLowerCase()));
}

export async function loadXStreamPolicy(target) {
  if (!path.isAbsolute(target)) throw new TypeError("X stream config path must be absolute.");
  const parsed = JSON.parse(await readFile(target, "utf8"));
  const roster = await loadXSourceRoster(target);
  const policies = parsed.streamPolicies;
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) {
    throw new TypeError("X streamPolicies config is required.");
  }

  const groups = new Map();
  for (const source of roster.sources.filter((entry) => entry.enabled && entry.affiliationStatus !== "former")) {
    const rawSource = parsed.sources.find((entry) => entry.handle.toLowerCase() === source.handle.toLowerCase());
    const lane = String(rawSource?.streamLane ?? "");
    if (!STREAM_LANE_PATTERN.test(lane) || !policies[lane]) {
      throw new TypeError(`X stream lane is invalid: ${source.handle}`);
    }
    if (!groups.has(lane)) groups.set(lane, []);
    groups.get(lane).push(source.handle);
  }

  return Object.freeze({
    groups: Object.freeze([...groups].map(([id, handles]) => {
      const policy = policies[id];
      const mode = String(policy?.mode ?? "");
      const terms = Array.isArray(policy?.terms) ? [...new Set(policy.terms)] : [];
      const phrases = Array.isArray(policy?.phrases) ? [...new Set(policy.phrases)] : [];
      const urlDomains = Array.isArray(policy?.urlDomains) ? [...new Set(policy.urlDomains)] : [];
      const evidenceTerms = Array.isArray(policy?.evidenceTerms) ? [...new Set(policy.evidenceTerms)] : [];
      const evidencePhrases = Array.isArray(policy?.evidencePhrases) ? [...new Set(policy.evidencePhrases)] : [];
      const evidenceUrlDomains = Array.isArray(policy?.evidenceUrlDomains)
        ? [...new Set(policy.evidenceUrlDomains)] : [];
      if (!["all", "keywords"].includes(mode) || typeof policy?.includeReplies !== "boolean") {
        throw new TypeError(`X stream policy is invalid: ${id}`);
      }
      if (terms.some((term) => !STREAM_TERM_PATTERN.test(term))
        || phrases.some((phrase) => !STREAM_PHRASE_PATTERN.test(phrase) || !phrase.includes(" "))
        || urlDomains.some((domain) => !STREAM_DOMAIN_PATTERN.test(domain))
        || evidenceTerms.some((term) => !STREAM_TERM_PATTERN.test(term))
        || evidencePhrases.some((phrase) => !STREAM_PHRASE_PATTERN.test(phrase) || !phrase.includes(" "))
        || evidenceUrlDomains.some((domain) => !STREAM_DOMAIN_PATTERN.test(domain))) {
        throw new TypeError(`X stream filter token is invalid: ${id}`);
      }
      if (mode === "keywords" && !terms.length && !phrases.length && !urlDomains.length) {
        throw new TypeError(`X keyword stream policy is empty: ${id}`);
      }
      return Object.freeze({
        id,
        handles: Object.freeze(handles),
        mode,
        includeReplies: policy.includeReplies,
        terms: Object.freeze(terms),
        phrases: Object.freeze(phrases),
        urlDomains: Object.freeze(urlDomains),
        evidenceTerms: Object.freeze(evidenceTerms),
        evidencePhrases: Object.freeze(evidencePhrases),
        evidenceUrlDomains: Object.freeze(evidenceUrlDomains),
      });
    })),
  });
}

export function findAllowedXPost(message, { channelId, allowedHandles }) {
  if (message?.channelId !== channelId || Number(message?.type ?? 0) !== 0) return null;
  for (const post of xPostsFromText(messageText(message))) {
    const handle = post.handle;
    if (!allowedHandles.has(handle.toLowerCase())) continue;
    return post;
  }
  return null;
}

export function xPostId(post) {
  return createHash("sha256")
    .update(`x\0${post.handle.toLowerCase()}\0${post.statusId}`)
    .digest("hex")
    .slice(0, 32);
}

export async function fetchXPost(post, {
  fetchImpl = fetch,
  xApiBearerToken = "",
  includeVideo = false,
} = {}) {
  const endpoint = new URL("https://publish.twitter.com/oembed");
  endpoint.searchParams.set("url", post.url);
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("dnt", "true");
  const response = await fetchImpl(endpoint, { redirect: "follow" });
  if (!response.ok) throw new Error("X 원문을 불러오지 못했습니다.");
  if (response.url && !OEMBED_HOSTS.has(new URL(response.url).hostname)) {
    throw new Error("X 원문 응답이 허용된 호스트를 벗어났습니다.");
  }
  const text = await response.text();
  if (text.length > 256_000) throw new Error("X 원문 응답이 너무 큽니다.");
  const payload = JSON.parse(text);
  const paragraph = String(payload.html ?? "").match(/<p[^>]*>([\s\S]*?)<\/p>/iu)?.[1];
  const oembedContent = decodeHtml(paragraph);
  const author = new URL(String(payload.author_url ?? ""));
  if (author.hostname !== "twitter.com" && author.hostname !== "x.com") {
    throw new Error("X 작성자 주소를 확인할 수 없습니다.");
  }
  const resolvedHandle = author.pathname.split("/").filter(Boolean)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/u.test(resolvedHandle ?? "")) {
    throw new Error("X 작성자 계정을 확인할 수 없습니다.");
  }
  if (post.handle.toLowerCase() !== "i" && resolvedHandle.toLowerCase() !== post.handle.toLowerCase()) {
    throw new Error("X 작성자가 등록된 링크와 다릅니다.");
  }
  if (!oembedContent) throw new Error("X 원문이 비어 있습니다.");
  const details = includeVideo || looksTruncated(oembedContent)
    ? await fetchXPostDetails(post, {
        bearerToken: xApiBearerToken,
        fetchImpl,
        includeVideo,
      })
    : null;
  return {
    content: details?.fullText ?? oembedContent,
    authorName: String(payload.author_name ?? post.handle).slice(0, 80),
    account: resolvedHandle,
    video: details?.video ?? null,
    relatedPosts: await relatedPostsFromHtml(payload.html, { fetchImpl, primary: post }),
  };
}

async function fetchContextPosts(message, primary, relatedPosts, options) {
  const candidates = [
    ...xPostsFromText(messageText(message)).map((post) => ({ ...post, relation: "provided-link" })),
    ...relatedPosts.map((post) => ({ ...post, relation: "linked-post" })),
  ];
  const contexts = [];
  const seen = new Set([primary.statusId]);
  for (const candidate of candidates) {
    if (contexts.length >= MAX_CONTEXT_POSTS) break;
    if (seen.has(candidate.statusId)) continue;
    seen.add(candidate.statusId);
    try {
      const resolved = await fetchXPost(candidate, {
        ...options,
        includeVideo: false,
      });
      contexts.push({
        relation: candidate.relation,
        account: resolved.account,
        label: resolved.authorName,
        statusId: candidate.statusId,
        url: candidate.url,
        content: resolved.content.slice(0, 8_000),
      });
    } catch {
      // 보조 문맥은 best effort이며 원문 수집 성공 여부와 분리한다.
    }
  }
  return contexts;
}

export async function fetchXVideoForRecord(record, {
  xApiBearerToken = "",
  fetchImpl = fetch,
} = {}) {
  if (record?.source?.type !== "x-post" || !xApiBearerToken) return null;
  const candidates = [
    { statusId: String(record.source.statusId ?? "") },
    ...(record.original?.contexts ?? []).map((context) => ({ statusId: String(context?.statusId ?? "") })),
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!/^\d{5,25}$/u.test(candidate.statusId) || seen.has(candidate.statusId)) continue;
    seen.add(candidate.statusId);
    const details = await fetchXPostDetails(candidate, {
      bearerToken: xApiBearerToken,
      fetchImpl,
      includeVideo: true,
    });
    if (details?.video) return details.video;
  }
  return null;
}

export async function normalizeXWatchMessage(message, options) {
  const post = options.post ?? findAllowedXPost(message, options);
  if (!post) return null;
  const resolved = await fetchXPost(post, { ...options, includeVideo: false });
  const contexts = await fetchContextPosts(message, post, resolved.relatedPosts, options);
  const id = xPostId(post);
  const publishedAt = new Date(message.createdTimestamp ?? message.createdAt ?? Date.now());
  return {
    id,
    mediaCandidates: discordMediaCandidates(message),
    record: {
      schemaVersion: 1,
      id,
      source: {
        type: "x-post",
        account: post.handle,
        label: resolved.authorName,
        statusId: post.statusId,
        url: post.url,
        publishedAt: publishedAt.toISOString(),
      },
      original: { language: "en", content: resolved.content, embeds: [], links: [post.url], contexts },
      workflow: { status: "pending_translation", translation: null, triage: null, dcPublication: null },
      collectedAt: new Date().toISOString(),
    },
  };
}
