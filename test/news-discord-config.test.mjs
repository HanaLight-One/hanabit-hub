import test from "node:test";
import assert from "node:assert/strict";
import {
  loadDiscordNewsConfig,
  redactSecret,
} from "../src/modules/news/discord-config.mjs";

const validEnv = {
  DISCORD_BOT_TOKEN: "test-token-value",
  DISCORD_GUILD_ID: "1532597033435664424",
  DISCORD_OPENAI_CHANNEL_ID: "1532598696586383360",
  DISCORD_X_WATCH_CHANNEL_ID: "1532598778865914067",
  DISCORD_PENDING_CHANNEL_ID: "1532598832875966474",
  DISCORD_LOG_CHANNEL_ID: "1532598895559966871",
  DISCORD_APPLICATION_ID: "1532601857095241838",
};

test("뉴스 Discord 설정은 필요한 ID와 토큰만 읽는다", () => {
  const config = loadDiscordNewsConfig({
    env: validEnv,
    loadEnv: false,
  });

  assert.equal(config.guildId, validEnv.DISCORD_GUILD_ID);
  assert.equal(config.logChannelId, validEnv.DISCORD_LOG_CHANNEL_ID);
  assert.equal(config.botToken, validEnv.DISCORD_BOT_TOKEN);
});

test("뉴스 Discord 설정은 잘못된 ID를 거부한다", () => {
  assert.throws(
    () =>
      loadDiscordNewsConfig({
        env: { ...validEnv, DISCORD_LOG_CHANNEL_ID: "not-an-id" },
        loadEnv: false,
      }),
    /DISCORD_LOG_CHANNEL_ID/,
  );
});

test("뉴스 Discord 설정은 비어 있는 토큰을 안전한 메시지로 거부한다", () => {
  assert.throws(
    () =>
      loadDiscordNewsConfig({
        env: { ...validEnv, DISCORD_BOT_TOKEN: "" },
        loadEnv: false,
      }),
    /DISCORD_BOT_TOKEN/,
  );
});

test("오류 메시지에 포함된 토큰을 가린다", () => {
  assert.equal(
    redactSecret("login test-token-value failed", "test-token-value"),
    "login [REDACTED] failed",
  );
});
