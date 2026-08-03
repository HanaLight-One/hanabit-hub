import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPendingNewsStore } from "./news-item-store.mjs";

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const REPOSITORY = /^openai\/[A-Za-z0-9._-]{1,80}$/u;
const SOURCE_TYPES = new Set(["github-releases", "markdown-changelog"]);
const OFFICIAL_DOC_HOSTS = new Set(["developers.openai.com", "learn.chatgpt.com"]);
const REPOSITORY_LABELS = Object.freeze({
  "openai/codex": "Codex",
  "openai/openai-python": "OpenAI Python SDK",
  "openai/openai-node": "OpenAI Node.js SDK",
  "openai/openai-agents-python": "OpenAI Agents SDK Python",
  "openai/openai-agents-js": "OpenAI Agents SDK JavaScript",
});
const MAINTENANCE_HEADING = /^(?:build system|build|dependencies|dependency updates?|deps|chores?|maintenance|internal|ci(?:\/cd)?|tests?)$/iu;
const GENERIC_RELEASE_HEADING = /^(?:what'?s changed|changelog|release notes?|v?\d+(?:\.\d+){1,3}(?:\s.*)?)$/iu;
const MAINTENANCE_LINE = /(?:\bdeps(?:-dev)?\b|dependabot|\bbump(?:ed)?\b|\bbuild\b|release workflow|upstream release-please|ecosystem-tests|\bchore\b|\bci\b)/iu;

function safeUrl(value, allowedHosts = null) {
  const target = new URL(String(value ?? ""));
  if (target.protocol !== "https:" || (allowedHosts && !allowedHosts.has(target.hostname))) {
    throw new TypeError("공식 뉴스 URL이 허용 범위를 벗어났습니다.");
  }
  return target.href;
}

function normalizeSource(value) {
  const id = String(value?.id ?? "");
  const type = String(value?.type ?? "");
  const limit = Number(value?.limit ?? 10);
  if (!SOURCE_ID.test(id) || !SOURCE_TYPES.has(type) || !Number.isInteger(limit) || limit < 1 || limit > 30) {
    throw new TypeError("공식 뉴스 소스 설정이 올바르지 않습니다.");
  }
  if (typeof value.enabled !== "boolean") throw new TypeError("공식 뉴스 소스 활성 상태가 필요합니다.");
  if (type === "github-releases" && !REPOSITORY.test(String(value.repository ?? ""))) {
    throw new TypeError("공식 GitHub 저장소가 올바르지 않습니다.");
  }
  if (type === "markdown-changelog") safeUrl(value.url, OFFICIAL_DOC_HOSTS);
  return Object.freeze({
    id,
    type,
    limit,
    enabled: value.enabled,
    repository: type === "github-releases" ? String(value.repository) : null,
    url: type === "markdown-changelog" ? safeUrl(value.url, OFFICIAL_DOC_HOSTS) : null,
  });
}

export async function loadOfficialNewsSources(target) {
  if (!path.isAbsolute(target)) throw new TypeError("공식 뉴스 설정은 절대경로여야 합니다.");
  const parsed = JSON.parse(await readFile(target, "utf8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources) || !parsed.sources.length) {
    throw new TypeError("공식 뉴스 소스 목록이 올바르지 않습니다.");
  }
  const intervalMinutes = Number(parsed.intervalMinutes);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 10 || intervalMinutes > 1440) {
    throw new TypeError("공식 뉴스 확인 주기가 올바르지 않습니다.");
  }
  const sources = parsed.sources.map(normalizeSource);
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new TypeError("공식 뉴스 소스 ID가 중복되었습니다.");
  }
  return Object.freeze({ intervalMinutes, sources: Object.freeze(sources.filter((source) => source.enabled)) });
}

function entryId(sourceId, externalId) {
  return createHash("sha256").update(`official\0${sourceId}\0${externalId}`).digest("hex").slice(0, 32);
}

function linksFromMarkdown(value, baseUrl) {
  const links = [];
  for (const match of String(value).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol === "https:") links.push(url.href);
    } catch {
      // 잘못된 링크 하나가 공식 변경 기록 전체를 막지 않게 한다.
    }
  }
  return [...new Set(links)].slice(0, 20);
}

function cleanMarkdown(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/gu, "[코드 예시는 원문에서 확인]")
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/^>\s?/gmu, "")
    .replace(/^[ \t]*[-*+][ \t]+/gmu, "• ")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gmu, "")
    .trim()
    .slice(0, 12_000);
}

function releaseTitle(repository, release) {
  const rawTitle = String(release.name || release.tag_name || "Release").trim().slice(0, 200);
  const label = REPOSITORY_LABELS[repository] ?? repository.split("/").at(-1);
  return rawTitle.toLocaleLowerCase("en-US").includes(label.toLocaleLowerCase("en-US"))
    ? rawTitle
    : `${label} ${rawTitle}`.slice(0, 200);
}

function isMaintenanceOnlyRelease(value) {
  const raw = String(value ?? "").replace(/\r\n?/gu, "\n");
  const headings = raw.split("\n")
    .map((line) => line.match(/^#{2,6}\s+(.+)$/u)?.[1]?.replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1").trim())
    .filter(Boolean)
    .filter((heading) => !GENERIC_RELEASE_HEADING.test(heading));
  if (headings.length && headings.every((heading) => MAINTENANCE_HEADING.test(heading))) return true;

  const contentLines = raw.split("\n")
    .map((line) => line.replace(/^[ \t]*[-*+][ \t]+/u, "").trim())
    .filter((line) => line && !/^#{1,6}\s+/u.test(line) && !/^full changelog\s*:/iu.test(line));
  return contentLines.length >= 2 && contentLines.every((line) => MAINTENANCE_LINE.test(line));
}

function markdownSections(markdown, source, now) {
  const lines = String(markdown ?? "").replace(/\r\n?/gu, "\n").split("\n");
  let parent = "";
  let current = null;
  const entries = [];
  const flush = () => {
    if (!current) return;
    const rawBody = current.lines.join("\n").trim();
    const content = cleanMarkdown(rawBody);
    if (content) {
      const externalId = createHash("sha256")
        .update(`${parent}\0${current.title}`)
        .digest("hex")
        .slice(0, 24);
      entries.push({
        externalId,
        title: current.title,
        content,
        url: `${source.url.replace(/\.md$/u, "")}#${current.title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}`,
        publishedAt: now().toISOString(),
        links: linksFromMarkdown(rawBody, source.url),
      });
    }
    current = null;
  };
  for (const line of lines) {
    const levelTwo = line.match(/^##\s+(.+)$/u);
    const levelThree = line.match(/^###\s+(.+)$/u);
    if (levelTwo) {
      flush();
      parent = levelTwo[1].trim();
    } else if (levelThree) {
      flush();
      current = { title: levelThree[1].trim().slice(0, 200), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return entries.slice(0, source.limit);
}

async function fetchEntries(source, fetchImpl, now) {
  if (source.type === "github-releases") {
    const endpoint = new URL(`https://api.github.com/repos/${source.repository}/releases`);
    endpoint.searchParams.set("per_page", String(source.limit));
    const response = await fetchImpl(endpoint, {
      headers: { accept: "application/vnd.github+json", "user-agent": "hanabit-news-lab" },
    });
    if (!response.ok) throw new Error(`GitHub Releases 조회 실패 (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("GitHub Releases 응답 형식이 올바르지 않습니다.");
    return payload.filter((release) => !release?.draft && !release?.prerelease).map((release) => ({
      externalId: String(release.id),
      title: releaseTitle(source.repository, release),
      content: cleanMarkdown(release.body || `${release.tag_name} release`),
      maintenanceOnly: isMaintenanceOnlyRelease(release.body),
      url: safeUrl(release.html_url, new Set(["github.com"])),
      publishedAt: new Date(release.published_at || release.created_at || now()).toISOString(),
      links: [safeUrl(release.html_url, new Set(["github.com"]))],
    })).filter((entry) => /^\d+$/u.test(entry.externalId) && entry.content);
  }
  const response = await fetchImpl(source.url, { headers: { accept: "text/markdown", "user-agent": "hanabit-news-lab" } });
  if (!response.ok) throw new Error(`공식 changelog 조회 실패 (${response.status})`);
  const markdown = await response.text();
  if (!markdown || markdown.length > 2_000_000) throw new Error("공식 changelog 크기가 올바르지 않습니다.");
  return markdownSections(markdown, source, now);
}

function recordFor(source, entry, now) {
  const id = entryId(source.id, entry.externalId);
  return {
    schemaVersion: 1,
    id,
    source: {
      type: source.type === "github-releases" ? "official-github-release" : "official-changelog",
      provider: source.type === "github-releases" ? "github" : "openai-docs",
      sourceId: source.id,
      externalId: entry.externalId,
      repository: source.repository,
      url: entry.url,
      publishedAt: entry.publishedAt,
    },
    original: {
      language: "en",
      content: `${entry.title}\n\n${entry.content}`.slice(0, 16_000),
      embeds: [],
      links: entry.links,
    },
    workflow: { status: "pending_translation", translation: null, triage: null, dcPublication: null },
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

export function createOfficialNewsCollector({ stateRoot, sources, fetchImpl = fetch, now = () => new Date() }) {
  if (!path.isAbsolute(stateRoot) || !Array.isArray(sources)) {
    throw new TypeError("공식 뉴스 수집기 설정이 올바르지 않습니다.");
  }
  const store = createPendingNewsStore({ root: stateRoot });
  const checkpointPath = path.join(stateRoot, "official-sources.json");

  async function collectAll({ dryRun = false } = {}) {
    const checkpoint = await readCheckpoint(checkpointPath);
    const summary = { sources: sources.length, scanned: 0, baselined: 0, existing: 0, filtered: 0, created: 0, failed: 0, ids: [] };
    for (const source of sources) {
      try {
        const entries = await fetchEntries(source, fetchImpl, now);
        summary.scanned += entries.length;
        const previous = checkpoint.seenBySource[source.id];
        if (!Array.isArray(previous)) {
          summary.baselined += entries.length;
          if (!dryRun) {
            checkpoint.seenBySource[source.id] = entries.map((entry) => entry.externalId).slice(0, 500);
            checkpoint.checkedAt = now().toISOString();
            await writeCheckpoint(checkpointPath, checkpoint);
          }
          continue;
        }
        const seen = new Set(previous);
        const unseen = entries.filter((entry) => !seen.has(entry.externalId)).reverse();
        for (const entry of unseen) {
          if (entry.maintenanceOnly) {
            summary.filtered += 1;
            if (!dryRun) seen.add(entry.externalId);
            continue;
          }
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
          checkpoint.seenBySource[source.id] = [...entries.map((entry) => entry.externalId), ...seen].filter(
            (id, index, all) => all.indexOf(id) === index,
          ).slice(0, 500);
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
