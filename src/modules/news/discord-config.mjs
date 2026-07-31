import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_ENV_PATH = path.join(PROJECT_ROOT, ".env");
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

const ID_FIELDS = Object.freeze({
  guildId: "DISCORD_GUILD_ID",
  applicationId: "DISCORD_APPLICATION_ID",
  openaiChannelId: "DISCORD_OPENAI_CHANNEL_ID",
  xWatchChannelId: "DISCORD_X_WATCH_CHANNEL_ID",
  pendingChannelId: "DISCORD_PENDING_CHANNEL_ID",
  logChannelId: "DISCORD_LOG_CHANNEL_ID",
});

export const NEWS_CHANNELS = Object.freeze([
  ["openai-announcements", "openaiChannelId"],
  ["x-watch", "xWatchChannelId"],
  ["news-pending", "pendingChannelId"],
  ["news-log", "logChannelId"],
]);

function requireSnowflake(env, key) {
  const value = String(env[key] ?? "").trim();
  if (!SNOWFLAKE_PATTERN.test(value)) {
    throw new Error(`${key}에 올바른 Discord ID를 입력해 주세요.`);
  }
  return value;
}

export function loadDiscordNewsConfig({
  env = process.env,
  envPath = DEFAULT_ENV_PATH,
  loadEnv = true,
  requireToken = true,
} = {}) {
  if (loadEnv) {
    const result = dotenv.config({ path: envPath, quiet: true });
    if (result.error) {
      throw new Error(".env 파일을 불러오지 못했습니다.");
    }
  }

  const config = Object.fromEntries(
    Object.entries(ID_FIELDS).map(([name, key]) => [name, requireSnowflake(env, key)]),
  );
  const botToken = String(env.DISCORD_BOT_TOKEN ?? "").trim();

  if (requireToken && !botToken) {
    throw new Error(".env의 DISCORD_BOT_TOKEN에 Bot Token을 입력해 주세요.");
  }

  return Object.freeze({ ...config, botToken });
}

export function redactSecret(value, secret) {
  const text = String(value ?? "");
  return secret ? text.replaceAll(secret, "[REDACTED]") : text;
}
