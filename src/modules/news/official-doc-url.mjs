const PUBLIC_DEVELOPER_HOST = "developers.openai.com";
const OPENAI_PREVIEW_HOST = /^developers-site-git-[a-z0-9-]+-openai\.vercel\.app$/u;

export function canonicalOpenAiDeveloperDocUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith("/api/docs/") ||
      (hostname !== PUBLIC_DEVELOPER_HOST && !OPENAI_PREVIEW_HOST.test(hostname))
    ) {
      return null;
    }
    url.hostname = PUBLIC_DEVELOPER_HOST;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeOfficialMarkdownLink(value) {
  const official = canonicalOpenAiDeveloperDocUrl(value);
  if (official) return official;
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export const officialDeveloperDocLinkPolicy = Object.freeze({
  publicHost: PUBLIC_DEVELOPER_HOST,
  previewHostPattern: OPENAI_PREVIEW_HOST.source,
  pathPrefix: "/api/docs/",
});
