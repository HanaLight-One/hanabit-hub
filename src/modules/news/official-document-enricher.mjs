const OPENAI_HOSTS = new Set(["openai.com", "www.openai.com"]);
const READER_ORIGIN = "https://r.jina.ai";
const MAX_DOCUMENT_BYTES = 128_000;
const MAX_CONTEXT_CHARACTERS = 12_000;

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

export async function enrichOfficialDocument(
  record,
  {
    fetchImpl = fetch,
    timeoutMs = 15_000,
  } = {},
) {
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

export const officialDocumentEnrichmentPolicy = Object.freeze({
  hosts: Object.freeze([...OPENAI_HOSTS]),
  pathPrefix: "/index/",
  maximumDocuments: 1,
  maximumBytes: MAX_DOCUMENT_BYTES,
  maximumContextCharacters: MAX_CONTEXT_CHARACTERS,
});
