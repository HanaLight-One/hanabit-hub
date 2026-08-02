export const NEWS_BOARD_CATEGORIES = Object.freeze(["news", "information", "chatter", "ai_creation"]);

export const NEWS_DC_HEAD_TEXTS = Object.freeze({
  news: "뉴스/소식",
  information: "💡 정보",
  chatter: "잡담",
  ai_creation: "AI창작",
});

const OFFICIAL_ACCOUNTS = new Set(["openai", "openaidevs"]);

function isTrusted(profile) {
  return ["official", "high"].includes(profile?.trustLevel) && profile?.affiliationConfirmed === true;
}

export function selectNewsDcHeadText(record, sourceProfile = null) {
  const source = record?.source ?? {};
  const triage = record?.workflow?.triage ?? {};
  const account = String(source.account ?? "").toLowerCase();
  const official = source.type === "discord-announcement" ||
    OFFICIAL_ACCOUNTS.has(account) ||
    triage.evidenceTag === "official";
  if (official) return NEWS_DC_HEAD_TEXTS.news;
  if (triage.evidenceTag === "use_case" && isTrusted(sourceProfile)) {
    return NEWS_DC_HEAD_TEXTS.news;
  }
  const proposed = NEWS_BOARD_CATEGORIES.includes(triage.boardCategory)
    ? triage.boardCategory
    : triage.evidenceTag === "opinion" || triage.evidenceTag === "use_case"
      ? "chatter"
      : "news";
  return NEWS_DC_HEAD_TEXTS[proposed];
}

export function isAllowedNewsDcHeadText(value) {
  return Object.values(NEWS_DC_HEAD_TEXTS).includes(String(value ?? ""));
}
