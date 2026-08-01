const list = document.querySelector("#news-list");
const notice = document.querySelector("#notice");
const totalCount = document.querySelector("#total-count");
const translationCount = document.querySelector("#translation-count");
const mediaCount = document.querySelector("#media-count");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "시각 미상"
    : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status) {
  return {
    pending_translation: "번역 대기",
    pending_triage: "판정 대기",
    pending_review: "게시 검토",
    ignored: "보류 · 정보성 낮음",
    translation_failed: "번역 확인 필요",
    published: "게시 완료",
  }[status] ?? "상태 확인 필요";
}

function renderEmbed(embed) {
  const box = element("section", "embed-box");
  if (embed.title) box.append(element("h3", null, embed.title));
  if (embed.description) box.append(element("p", null, embed.description));
  for (const field of embed.fields) {
    const row = element("div", "embed-field");
    if (field.name) row.append(element("strong", null, field.name));
    if (field.value) row.append(element("span", null, field.value));
    box.append(row);
  }
  return box;
}

function renderItem(item) {
  const article = element("article", "news-card");
  const top = element("div", "card-top");
  top.append(element("span", "status", statusLabel(item.workflow.status)));
  top.append(element("time", null, formatDate(item.source.publishedAt)));
  article.append(top);

  if (item.source.label || item.source.account) {
    article.append(element("p", "source-label", `${item.source.label ?? item.source.account} · ${item.source.type === "x-post" ? "X" : "Discord"}`));
  }

  if (item.workflow.translation) {
    const translated = element("section", "translation-box");
    translated.append(element("h2", null, item.workflow.translation.title));
    translated.append(element("p", null, item.workflow.translation.body));
    if (item.workflow.triage) {
      const triage = item.workflow.triage;
      translated.append(element(
        "small",
        `triage triage-${triage.decision}`,
        `${triage.decision === "publish" ? "바로 게시 후보" : triage.decision === "review" ? "검토 후보" : "보류"} · ${triage.reason}`,
      ));
    }
    article.append(translated);
  }

  if (item.original.content) article.append(element("p", "original-content", item.original.content));
  for (const embed of item.original.embeds) article.append(renderEmbed(embed));

  if (item.media.length) {
    const mediaGrid = element("div", "media-grid");
    for (const media of item.media) {
      const image = document.createElement("img");
      image.src = media.url;
      image.alt = "공지에 포함된 이미지";
      image.loading = "lazy";
      mediaGrid.append(image);
    }
    article.append(mediaGrid);
  }

  const links = new Map(item.original.links.map((url) => [url, "원문 링크"]));
  if (item.source.url) links.set(item.source.url, item.source.type === "x-post" ? "X 원문" : "Discord 원문");
  if (links.size) {
    const linkRow = element("div", "link-row");
    for (const [url, label] of links) {
      const anchor = element("a", null, `${label} ↗`);
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      linkRow.append(anchor);
    }
    article.append(linkRow);
  }
  return article;
}

try {
  const response = await fetch("/api/news", { cache: "no-store" });
  if (!response.ok) throw new Error("대기함 요청 실패");
  const payload = await response.json();
  totalCount.textContent = payload.total.toLocaleString("ko-KR");
  translationCount.textContent = payload.items
    .filter((item) => item.workflow.status === "pending_translation")
    .length.toLocaleString("ko-KR");
  mediaCount.textContent = payload.items
    .reduce((sum, item) => sum + item.media.length, 0)
    .toLocaleString("ko-KR");

  if (!payload.items.length) {
    notice.textContent = "아직 수집된 실제 Announcement가 없어요. 새 공지를 기다리는 중이에요.";
  } else {
    notice.hidden = true;
    for (const item of payload.items) list.append(renderItem(item));
  }
} catch {
  notice.textContent = "뉴스 대기함을 불러오지 못했어요.";
}
