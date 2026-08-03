const SAFE_LINK_HOSTS = new Set(["x.com", "twitter.com", "discord.com", "openai.com"]);
const X_LINK_HOSTS = new Set(["x.com", "twitter.com"]);
const SECTION_LABELS = new Set(["본문 번역", "왜 중요한가", "아직 확인되지 않은 점", "원문 링크"]);
const DC_OGP_ENDPOINT = "https://gall.dcinside.com/api/ogp";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeBodyLink(value) {
  try {
    const raw = String(value ?? "").trim();
    if (!raw || raw !== String(value ?? "")) return null;
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = SAFE_LINK_HOSTS.has(hostname) || hostname.endsWith(".openai.com");
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHost ||
        /(?:^|\/)sk(?:\/|$)/iu.test(decodedPath)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function sectionLabel(line) {
  if (SECTION_LABELS.has(line)) return line;
  return line.startsWith("관련 글 번역 · ") ? "관련 글 번역" : null;
}

function labelHtml(line, label) {
  const color = label === "아직 확인되지 않은 점" ? "#8a5a00" : "#111111";
  const background = label === "아직 확인되지 않은 점" ? "#fff4d6" : "#eef3f8";
  const size = label === "본문 번역" || label === "왜 중요한가" ? "20px" : "17px";
  return `<p style="margin:24px 0 10px;"><span style="display:inline-block;padding:4px 8px;background-color:${background};color:${color};font-size:${size};font-weight:700;">${escapeHtml(line)}</span></p>`;
}

function safeOgpImage(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    return url.href;
  } catch {
    return "";
  }
}

function createOgpBlock(link, card) {
  if (!card) return "";
  const title = String(card.title ?? "").trim().slice(0, 300);
  const description = String(card.description ?? "").trim().slice(0, 1_000);
  const image = safeOgpImage(card.image);
  const values = [link, title, description, image];
  if (!title || values.some((value) => value.includes("^#^") || value.includes("::OG_END_}"))) return "";
  const marker = values.map(escapeHtml).join("^#^");
  return `<div class="og">{{_OG_START::${marker}::OG_END_}}</div>`;
}

async function fetchDcOgpCard(link, { fetchImpl = fetch } = {}) {
  const safeLink = safeBodyLink(link);
  if (!safeLink || !X_LINK_HOSTS.has(new URL(safeLink).hostname.toLowerCase())) return null;
  try {
    const response = await fetchImpl(DC_OGP_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams({ url: safeLink }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || (response.url && response.url !== DC_OGP_ENDPOINT)) return null;
    const text = await response.text();
    if (text.length > 128_000) return null;
    const payload = JSON.parse(text);
    const returnedUrl = safeBodyLink(payload?.og_url);
    if (!payload?.result || returnedUrl !== safeLink) return null;
    const card = {
      title: String(payload.og_title ?? "").trim().slice(0, 300),
      description: String(payload.og_description ?? "").trim().slice(0, 1_000),
      image: safeOgpImage(payload.og_image),
    };
    return card.title ? card : null;
  } catch {
    return null;
  }
}

function textToHtml(value, { linkCards = new Map() } = {}) {
  return String(value).split("\n")
    .map((line) => {
      if (!line) return "<p><br></p>";
      const label = sectionLabel(line);
      if (label) return labelHtml(line, label);
      if (line.startsWith("게시자: ")) {
        return `<p style="margin:0 0 22px;color:#555555;font-size:13px;"><strong>${escapeHtml(line)}</strong></p>`;
      }
      if (line.startsWith("주의: ")) {
        return `<p style="margin:24px 0;padding:10px 12px;background-color:#f5f5f5;color:#666666;font-size:12px;line-height:1.6;">${escapeHtml(line)}</p>`;
      }
      const link = safeBodyLink(line);
      if (link) {
        const anchor = `<div><a class="lnk" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></div>`;
        return `${anchor}${createOgpBlock(link, linkCards.get(link))}`;
      }
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.75;">${escapeHtml(line)}</p>`;
    })
    .join("");
}

async function textToHtmlWithCards(value, { fetchImpl = fetch } = {}) {
  const links = [...new Set(String(value).split("\n").map(safeBodyLink).filter(Boolean))];
  const cards = await Promise.all(links.map(async (link) => [link, await fetchDcOgpCard(link, { fetchImpl })]));
  return textToHtml(value, { linkCards: new Map(cards.filter(([, card]) => card)) });
}

module.exports = { safeBodyLink, fetchDcOgpCard, textToHtml, textToHtmlWithCards };
