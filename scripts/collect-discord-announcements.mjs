import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { loadDiscordNewsConfig, redactSecret } from "../src/modules/news/discord-config.mjs";
import { createDiscordAnnouncementCollector } from "../src/modules/news/discord-announcement-collector.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const stateRoot = path.join(PROJECT_ROOT, "state", "news");
const dryRun = process.argv.includes("--dry-run");
const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const limit = Number(limitArgument?.slice("--limit=".length) || 25);

if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("--limit은 1부터 100 사이의 정수여야 합니다.");
}

let client;
let token = "";

try {
  const config = loadDiscordNewsConfig();
  token = config.botToken;
  const collector = createDiscordAnnouncementCollector({
    stateRoot,
    channelId: config.openaiChannelId,
  });
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(config.botToken);
  if (client.application?.id !== config.applicationId) {
    throw new Error("로그인한 Bot의 Application ID가 설정과 다릅니다.");
  }
  if (!client.guilds.cache.has(config.guildId)) {
    throw new Error("설정한 Guild를 찾지 못했습니다.");
  }

  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.openaiChannelId);
  if (
    !channel ||
    ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) ||
    !channel.messages
  ) {
    throw new Error("OpenAI Announcement 텍스트 채널을 찾지 못했습니다.");
  }

  const summary = await collector.collectRecent(channel, { limit, dryRun });

  console.log(
    `Discord 공지 수집 ${dryRun ? "드라이런" : "완료"}: ` +
      `조회 ${summary.scanned}, 대상 ${summary.eligible}, ` +
      `기존 ${summary.existing}, 신규 ${summary.created}, 이미지 ${summary.media}`,
  );
} catch (error) {
  console.error(
    `Discord 공지 수집 실패: ${redactSecret(error?.message ?? "알 수 없는 오류", token)}`,
  );
  process.exitCode = 1;
} finally {
  client?.destroy();
}
