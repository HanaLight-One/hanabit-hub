import { canonicalOpenAiDeveloperDocUrl } from "./official-doc-url.mjs";

const OPENAI_HOSTS = new Set(["openai.com", "www.openai.com"]);
const READER_ORIGIN = "https://r.jina.ai";
const MAX_DOCUMENT_BYTES = 128_000;
const MAX_CONTEXT_CHARACTERS = 12_000;
const FAST_PRICING_MODELS = Object.freeze(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);

function canonicalOpenAiArticleUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || !OPENAI_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.port || !url.pathname.startsWith("/index/")) return null;
    url.hostname = "openai.com";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.href;
  } catch {
    return null;
  }
}

function readerUrl(target) {
  const url = new URL(READER_ORIGIN);
  url.pathname = `/https://openai.com${new URL(target).pathname}`;
  return url.href;
}

function cleanReaderMarkdown(value, target) {
  const text = String(value ?? "").replace(/\r\n?/gu, "\n");
  const source = text.match(/^URL Source:\s*(https:\/\/\S+)\s*$/mu)?.[1];
  if (canonicalOpenAiArticleUrl(source) !== target) return null;
  const marker = "Markdown Content:";
  const offset = text.indexOf(marker);
  if (offset < 0) return null;
  const body = text.slice(offset + marker.length)
    .replace(/^Listen to article[^\n]*$/gimu, "")
    .replace(/!\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\)/gu, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu, "$1")
    .replace(/\(opens in a new window\)/giu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return body ? body.slice(0, MAX_CONTEXT_CHARACTERS) : null;
}

export function findOfficialOpenAiArticle(record) {
  const links = Array.isArray(record?.original?.links) ? record.original.links : [];
  return links.map(canonicalOpenAiArticleUrl).find(Boolean) ?? null;
}

export function findOfficialOpenAiPricing(record) {
  if (record?.source?.type !== "official-changelog") return null;
  const sourceText = String(record?.original?.content ?? "").toLowerCase();
  if (!sourceText.includes("gpt-5.6") || !sourceText.includes("fast mode")) return null;
  const links = Array.isArray(record?.original?.links) ? record.original.links : [];
  return links.map(canonicalOpenAiDeveloperDocUrl).find((value) => {
    try {
      return new URL(value).pathname.replace(/\.md$/u, "") === "/api/docs/pricing";
    } catch {
      return false;
    }
  }) ?? null;
}

function pricingMarkdownUrl(target) {
  const url = new URL(target);
  if (!url.pathname.endsWith(".md")) url.pathname = `${url.pathname}.md`;
  url.hash = "";
  return url.href;
}

function fastPricingContext(value) {
  const lines = String(value ?? "").replace(/\r\n?/gu, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "### Fast pricing data");
  if (start < 0) return null;
  const header = lines.slice(start + 1).find((line) => /^\|\s*Model\s*\|/u.test(line));
  const separator = lines.slice(start + 1).find((line) => /^\|\s*---/u.test(line));
  const rows = FAST_PRICING_MODELS.map((model) =>
    lines.slice(start + 1).find((line) => line.toLowerCase().startsWith(`| ${model} |`)));
  if (!header || !separator || rows.some((line) => !line)) return null;
  return [
    "Fast mode prices in USD per 1M tokens (100만 tokens).",
    header,
    separator,
    ...rows,
  ].join("\n").slice(0, 4_000);
}

async function enrichOfficialPricing(record, { fetchImpl, timeoutMs }) {
  const target = findOfficialOpenAiPricing(record);
  if (!target) return record;
  const contexts = Array.isArray(record?.original?.contexts) ? record.original.contexts : [];
  const existingIndex = contexts.findIndex((context) => context?.relation === "official-document" &&
    canonicalOpenAiDeveloperDocUrl(context?.url) === target);
  try {
    const response = await fetchImpl(pricingMarkdownUrl(target), {
      headers: { accept: "text/markdown", "user-agent": "HanabitNewsLab/0.1" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return record;
    const contentType = String(response.headers?.get?.("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("text/markdown") && !contentType.includes("text/plain")) return record;
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_DOCUMENT_BYTES) return record;
    const content = fastPricingContext(raw);
    if (!content) return record;
    const pricingContext = {
      relation: "official-document",
      account: "OpenAI",
      label: "OpenAI 공식 Fast 가격표",
      content,
      url: target,
    };
    const nextContexts = existingIndex >= 0
      ? contexts.map((context, index) => index === existingIndex ? pricingContext : context)
      : [pricingContext, ...contexts];
    return {
      ...record,
      original: {
        ...record.original,
        contexts: nextContexts.slice(0, 3),
      },
    };
  } catch {
    return record;
  }
}

async function enrichOfficialArticle(record, { fetchImpl, timeoutMs }) {
  const target = findOfficialOpenAiArticle(record);
  if (!target) return record;
  const contexts = Array.isArray(record?.original?.contexts) ? record.original.contexts : [];
  if (contexts.some((context) => context?.relation === "official-document" &&
    canonicalOpenAiArticleUrl(context?.url) === target)) {
    return record;
  }

  try {
    const response = await fetchImpl(readerUrl(target), {
      headers: {
        accept: "text/markdown, text/plain;q=0.9",
        "user-agent": "HanabitNewsLab/0.1",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return record;
    const contentType = String(response.headers?.get?.("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("text/plain") && !contentType.includes("text/markdown")) {
      return record;
    }
    const declaredLength = Number(response.headers?.get?.("content-length")) || 0;
    if (declaredLength > MAX_DOCUMENT_BYTES) return record;
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_DOCUMENT_BYTES) return record;
    const content = cleanReaderMarkdown(raw, target);
    if (!content) return record;

    return {
      ...record,
      original: {
        ...record.original,
        contexts: [
          {
            relation: "official-document",
            account: "OpenAI",
            label: "OpenAI 공식 문서",
            content,
            url: target,
          },
          ...contexts,
        ].slice(0, 3),
      },
    };
  } catch {
    return record;
  }
}

export async function enrichOfficialDocument(
  record,
  {
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = {},
) {
  const article = await enrichOfficialArticle(record, { fetchImpl, timeoutMs });
  return enrichOfficialPricing(article, { fetchImpl, timeoutMs });
}

export const officialDocumentEnrichmentPolicy = Object.freeze({
  hosts: Object.freeze([...OPENAI_HOSTS]),
  developerHost: "developers.openai.com",
  pathPrefix: "/index/",
  maximumDocuments: 2,
  maximumBytes: MAX_DOCUMENT_BYTES,
  maximumContextCharacters: MAX_CONTEXT_CHARACTERS,
});
