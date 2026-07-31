import {
  ChannelType,
  Client,
  GatewayIntentBits,
} from "discord.js";
import {
  loadDiscordNewsConfig,
  NEWS_CHANNELS,
  redactSecret,
} from "../src/modules/news/discord-config.mjs";

const shouldSendLog = process.argv.includes("--send-log");
let client;
let token = "";

try {
  const config = loadDiscordNewsConfig();
  token = config.botToken;
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
  const guild = await client.guilds.fetch(config.guildId);

  const channels = new Map();
  for (const [expectedName, configKey] of NEWS_CHANNELS) {
    const channel = await guild.channels.fetch(config[configKey]);
    if (!channel || channel.guildId !== guild.id) {
      throw new Error(`#${expectedName} 채널을 지정 Guild에서 찾지 못했습니다.`);
    }
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      throw new Error(`#${expectedName} 채널이 텍스트 채널이 아닙니다.`);
    }
    channels.set(configKey, channel);
  }

  console.log(`Discord 연결 성공: Guild 1개, 지정 채널 ${channels.size}개 확인`);

  if (shouldSendLog) {
    const logChannel = channels.get("logChannelId");
    if (!logChannel?.isTextBased()) {
      throw new Error("#news-log 채널에 메시지를 보낼 수 없습니다.");
    }
    await logChannel.send(
      `HANABIT NEWS LAB 연결 테스트 성공 · ${new Date().toISOString()}`,
    );
    console.log("#news-log 테스트 메시지 1건 전송 완료");
  }
} catch (error) {
  const safeMessage = redactSecret(error?.message ?? "알 수 없는 오류", token);
  console.error(`Discord 연결 테스트 실패: ${safeMessage}`);
  process.exitCode = 1;
} finally {
  client?.destroy();
}
