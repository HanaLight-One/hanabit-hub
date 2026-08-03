const SAFE_LINK_HOSTS = new Set(["x.com", "twitter.com", "discord.com", "openai.com"]);
const SECTION_LABELS = new Set(["본문 번역", "왜 중요한가", "아직 확인되지 않은 점", "원문 링크"]);

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

function textToHtml(value) {
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
        return `<p><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></p>`;
      }
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.75;">${escapeHtml(line)}</p>`;
    })
    .join("");
}

module.exports = { safeBodyLink, textToHtml };
