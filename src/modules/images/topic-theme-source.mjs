import { readFile, stat } from "node:fs/promises";

const MAX_TOPIC_FILE_BYTES = 64 * 1024;
const TRAILING_DISCORD_LEARN_MORE =
  /\s*(?:\*Learn more:\*|_Learn more:_)\s*https?:\/\/(?:www\.)?discord\.com\/channels\/[^\s]+\s*$/iu;

export function normalizeTopicTheme(value) {
  return String(value ?? "").replace(TRAILING_DISCORD_LEARN_MORE, "").trim();
}

function matchesExpectedChannel(payload, { channelId, channelName }) {
  if (channelId && payload.channel_id !== channelId) return false;
  if (channelName && payload.channel_name !== channelName) return false;
  return true;
}

export function createTopicThemeSource({
  topicPath,
  history,
  channelId = "",
  channelName = "",
}) {
  if (!topicPath) throw new TypeError("테마 원본 파일 경로가 필요합니다.");
  if (!history?.record) throw new TypeError("테마 기록 저장소가 필요합니다.");

  async function capture() {
    try {
      const fileInfo = await stat(topicPath);
      if (!fileInfo.isFile() || fileInfo.size > MAX_TOPIC_FILE_BYTES) return null;

      const payload = JSON.parse(await readFile(topicPath, "utf8"));
      if (!matchesExpectedChannel(payload, { channelId, channelName })) return null;

      const theme = normalizeTopicTheme(payload.topic);
      const observedAt = new Date(payload.fetched_at);
      if (!theme || Number.isNaN(observedAt.getTime())) return null;

      return await history.record(theme, observedAt);
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  return Object.freeze({ capture });
}
