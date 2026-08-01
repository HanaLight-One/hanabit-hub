import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discordMediaCandidates } from "./discord-announcement.mjs";

const STATUS_URL_PATTERN = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/giu;
const OEMBED_HOSTS = new Set(["publish.x.com", "publish.twitter.com"]);

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

export async function loadXSourceAllowlist(target) {
  if (!path.isAbsolute(target)) throw new TypeError("X 출처 설정은 절대경로여야 합니다.");
  const parsed = JSON.parse(await readFile(target, "utf8"));
  const handles = Array.isArray(parsed.handles) ? parsed.handles : [];
  if (!handles.length || handles.some((value) => !/^[A-Za-z0-9_]{1,15}$/u.test(value))) {
    throw new TypeError("X 출처 allowlist가 올바르지 않습니다.");
  }
  return new Set(handles.map((value) => value.toLowerCase()));
}

export function findAllowedXPost(message, { channelId, allowedHandles }) {
  if (message?.channelId !== channelId || Number(message?.type ?? 0) !== 0) return null;
  for (const match of messageText(message).matchAll(STATUS_URL_PATTERN)) {
    const handle = match[1];
    if (!allowedHandles.has(handle.toLowerCase())) continue;
    const statusId = match[2];
    return {
      handle,
      statusId,
      url: `https://x.com/${handle}/status/${statusId}`,
    };
  }
  return null;
}

export function xPostId(post) {
  return createHash("sha256")
    .update(`x\0${post.handle.toLowerCase()}\0${post.statusId}`)
    .digest("hex")
    .slice(0, 32);
}

export async function fetchXPost(post, { fetchImpl = fetch } = {}) {
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
  const content = decodeHtml(paragraph);
  const author = new URL(String(payload.author_url ?? ""));
  if (author.hostname !== "twitter.com" && author.hostname !== "x.com") {
    throw new Error("X 작성자 주소를 확인할 수 없습니다.");
  }
  if (author.pathname.split("/").filter(Boolean)[0]?.toLowerCase() !== post.handle.toLowerCase()) {
    throw new Error("X 작성자가 등록된 링크와 다릅니다.");
  }
  if (!content) throw new Error("X 원문이 비어 있습니다.");
  return { content, authorName: String(payload.author_name ?? post.handle).slice(0, 80) };
}

export async function normalizeXWatchMessage(message, options) {
  const post = options.post ?? findAllowedXPost(message, options);
  if (!post) return null;
  const resolved = await fetchXPost(post, options);
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
      original: { language: "en", content: resolved.content, embeds: [], links: [post.url] },
      workflow: { status: "pending_translation", translation: null, triage: null, dcPublication: null },
      collectedAt: new Date().toISOString(),
    },
  };
}
