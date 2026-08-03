import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPendingNewsStore } from "./news-item-store.mjs";

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const SOURCE_TYPES = new Set(["rss"]);
const FEED_HOSTS = new Set(["api.theregister.com", "arstechnica.com"]);
const ARTICLE_HOSTS = new Set(["www.theregister.com", "arstechnica.com"]);

function safeUrl(value, allowedHosts) {
  const target = new URL(String(value ?? ""));
  if (target.protocol !== "https:" || !allowedHosts.has(target.hostname.toLowerCase())) {
    throw new TypeError("외신 레이더 URL이 허용 범위를 벗어났습니다.");
  }
  return target.href;
}

function normalizeSource(value) {
  const id = String(value?.id ?? "");
  const label = String(value?.label ?? "").trim();
  const type = String(value?.type ?? "");
  const limit = Number(value?.limit ?? 25);
  const allowedArticleHosts = Array.isArray(value?.allowedArticleHosts)
    ? [...new Set(value.allowedArticleHosts.map((host) => String(host).toLowerCase()))]
    : [];
  if (
    !SOURCE_ID.test(id) || !label || label.length > 100 || !SOURCE_TYPES.has(type) ||
    !Number.isInteger(limit) || limit < 1 || limit > 50 || typeof value.enabled !== "boolean"
  ) {
    throw new TypeError("외신 레이더 소스 설정이 올바르지 않습니다.");
  }
  if (!allowedArticleHosts.length || allowedArticleHosts.some((host) => !ARTICLE_HOSTS.has(host))) {
    throw new TypeError("외신 레이더 기사 호스트가 허용 범위를 벗어났습니다.");
  }
  return Object.freeze({
    id,
    label,
    type,
    limit,
    enabled: value.enabled,
    url: safeUrl(value.url, FEED_HOSTS),
    allowedArticleHosts: Object.freeze(allowedArticleHosts),
  });
}

export async function loadShadowNewsSources(target) {
  if (!path.isAbsolute(target)) throw new TypeError("외신 레이더 설정은 절대경로여야 합니다.");
  const parsed = JSON.parse(await readFile(target, "utf8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources) || !parsed.sources.length) {
    throw new TypeError("외신 레이더 소스 목록이 올바르지 않습니다.");
  }
  const intervalMinutes = Number(parsed.intervalMinutes);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 1440) {
    throw new TypeError("외신 레이더 확인 주기가 올바르지 않습니다.");
  }
  const sources = parsed.sources.map(normalizeSource);
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new TypeError("외신 레이더 소스 ID가 중복되었습니다.");
  }
  return Object.freeze({ intervalMinutes, sources: Object.freeze(sources.filter((source) => source.enabled)) });
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;|&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function cleanFeedText(value, maximum) {
  return decodeXml(value)
    .replace(/<\s*br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n\s*\n+/gu, "\n\n")
    .trim()
    .slice(0, maximum);
}

function tagValue(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "iu"));
    if (match) return match[1];
  }
  return "";
}

function entryLink(block, source) {
  const rssLink = cleanFeedText(tagValue(block, ["link"]), 2_000);
  const atomLink = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/iu)?.[1];
  return safeUrl(decodeXml(atomLink || rssLink), new Set(source.allowedArticleHosts));
}

function parseFeed(xml, source, now) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/giu) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/giu) ?? [];
  return blocks.slice(0, source.limit).map((block) => {
    const title = cleanFeedText(tagValue(block, ["title"]), 300);
    const url = entryLink(block, source);
    const description = cleanFeedText(tagValue(block, ["description", "summary", "content:encoded", "content"]), 3_000);
    const rawId = cleanFeedText(tagValue(block, ["guid", "id"]), 1_000) || url;
    const rawDate = cleanFeedText(tagValue(block, ["pubDate", "published", "updated", "dc:date"]), 200);
    const parsedDate = new Date(rawDate);
    if (!title) throw new Error("외신 RSS 항목 제목이 비어 있습니다.");
    return {
      externalId: createHash("sha256").update(`${source.id}\0${rawId}`).digest("hex").slice(0, 24),
      title,
      description,
      url,
      publishedAt: Number.isNaN(parsedDate.getTime()) ? now().toISOString() : parsedDate.toISOString(),
    };
  });
}

async function fetchEntries(source, fetchImpl, now) {
  const response = await fetchImpl(source.url, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "hanabit-news-lab" },
  });
  if (!response.ok) throw new Error(`외신 RSS 조회 실패 (${response.status})`);
  const xml = await response.text();
  if (!xml || xml.length > 2_000_000) throw new Error("외신 RSS 크기가 올바르지 않습니다.");
  return parseFeed(xml, source, now);
}

function recordFor(source, entry, now) {
  const id = createHash("sha256").update(`shadow-rss\0${source.id}\0${entry.externalId}`).digest("hex").slice(0, 32);
  return {
    schemaVersion: 1,
    id,
    source: {
      type: "media-rss-shadow",
      provider: source.id,
      sourceId: source.id,
      label: source.label,
      externalId: entry.externalId,
      url: entry.url,
      publishedAt: entry.publishedAt,
    },
    original: {
      language: "en",
      content: `${entry.title}${entry.description ? `\n\n${entry.description}` : ""}`.slice(0, 4_000),
      embeds: [],
      links: [entry.url],
    },
    workflow: {
      status: "shadow_radar",
      translation: null,
      triage: null,
      dcPublication: null,
      shadowRadar: {
        mode: "metadata_only",
        state: "unreviewed",
        reason: "RSS 메타데이터만 수집한 외신 후보이며 번역·알림·자동 게시는 실행하지 않았습니다.",
      },
    },
    collectedAt: now().toISOString(),
  };
}

async function readCheckpoint(target) {
  try {
    const value = JSON.parse(await readFile(target, "utf8"));
    return value?.schemaVersion === 1 && value.seenBySource && typeof value.seenBySource === "object"
      ? value : { schemaVersion: 1, seenBySource: {} };
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, seenBySource: {} };
    throw error;
  }
}

async function writeCheckpoint(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function createShadowNewsCollector({ stateRoot, sources, fetchImpl = fetch, now = () => new Date() }) {
  if (!path.isAbsolute(stateRoot) || !Array.isArray(sources)) {
    throw new TypeError("외신 레이더 수집기 설정이 올바르지 않습니다.");
  }
  const store = createPendingNewsStore({ root: stateRoot });
  const checkpointPath = path.join(stateRoot, "shadow-sources.json");

  async function collectAll({ dryRun = false } = {}) {
    const checkpoint = await readCheckpoint(checkpointPath);
    const summary = { sources: sources.length, scanned: 0, baselined: 0, existing: 0, created: 0, failed: 0, ids: [] };
    for (const source of sources) {
      try {
        const entries = await fetchEntries(source, fetchImpl, now);
        summary.scanned += entries.length;
        const previous = checkpoint.seenBySource[source.id];
        if (!Array.isArray(previous)) {
          summary.baselined += entries.length;
          if (!dryRun) checkpoint.seenBySource[source.id] = entries.map((entry) => entry.externalId).slice(0, 500);
        } else {
          const seen = new Set(previous);
          const unseen = entries.filter((entry) => !seen.has(entry.externalId)).reverse();
          for (const entry of unseen) {
            const record = recordFor(source, entry, now);
            if (await store.has(record.id)) {
              summary.existing += 1;
            } else if (!dryRun) {
              const result = await store.create(record);
              if (result.created) {
                summary.created += 1;
                summary.ids.push(record.id);
              } else {
                summary.existing += 1;
              }
            }
            if (!dryRun) seen.add(entry.externalId);
          }
          if (!dryRun) {
            checkpoint.seenBySource[source.id] = [...entries.map((entry) => entry.externalId), ...seen]
              .filter((id, index, all) => all.indexOf(id) === index)
              .slice(0, 500);
          }
        }
        if (!dryRun) {
          checkpoint.checkedAt = now().toISOString();
          await writeCheckpoint(checkpointPath, checkpoint);
        }
      } catch {
        summary.failed += 1;
      }
    }
    return Object.freeze({ ...summary, ids: Object.freeze(summary.ids) });
  }

  return Object.freeze({ collectAll });
}
