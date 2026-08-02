import { stat } from "node:fs/promises";
import path from "node:path";

const COVER_DEFINITIONS = Object.freeze({
  news: Object.freeze({ id: "news", filename: "news.png", headText: "뉴스/소식" }),
  information: Object.freeze({ id: "information", filename: "information.png", headText: "💡 정보" }),
  chatter: Object.freeze({ id: "chatter", filename: "chatter.png", headText: "잡담" }),
  ai_creation: Object.freeze({ id: "ai-creation", filename: "ai-creation.png", headText: "AI창작" }),
});

const BY_ID = new Map(Object.values(COVER_DEFINITIONS).map((entry) => [entry.id, entry]));
const BY_HEAD_TEXT = new Map(Object.values(COVER_DEFINITIONS).map((entry) => [entry.headText, entry]));

async function resolveCover(root, definition) {
  if (!definition) return null;
  const target = path.join(root, definition.filename);
  const info = await stat(target);
  if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024) {
    throw new TypeError("DC 뉴스 기본 커버가 올바르지 않습니다.");
  }
  return Object.freeze({
    ...definition,
    target,
    size: info.size,
    contentType: "image/png",
    url: `/api/news/dc-covers/${definition.id}`,
  });
}

export function createNewsDcCoverCatalog({ root }) {
  if (!path.isAbsolute(root ?? "")) {
    throw new TypeError("DC 뉴스 기본 커버 루트는 절대경로여야 합니다.");
  }

  async function forHeadText(headText) {
    return resolveCover(root, BY_HEAD_TEXT.get(String(headText ?? "")));
  }

  async function find(id) {
    return resolveCover(root, BY_ID.get(String(id ?? "")));
  }

  return Object.freeze({ forHeadText, find });
}

export const newsDcCoverPolicy = Object.freeze({
  filenames: Object.freeze(Object.values(COVER_DEFINITIONS).map((entry) => entry.filename)),
});
