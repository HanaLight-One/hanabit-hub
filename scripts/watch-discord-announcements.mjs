import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "../src/config.mjs";
import { createDiscordAnnouncementCollector } from "../src/modules/news/discord-announcement-collector.mjs";
import { createDiscordNewsNotifier } from "../src/modules/news/discord-news-notifier.mjs";
import { loadDiscordNewsConfig, redactSecret } from "../src/modules/news/discord-config.mjs";
import { createNewsProcessor } from "../src/modules/news/news-processor.mjs";
import { createXWatchCollector } from "../src/modules/news/x-watch-collector.mjs";
import { loadXSourceAllowlist } from "../src/modules/news/x-watch-source.mjs";
import { runXFilteredStream } from "../src/modules/news/x-filtered-stream.mjs";
import { createXStreamDiscordBridge } from "../src/modules/news/x-stream-discord-bridge.mjs";
import { loadXStreamConfig } from "../src/modules/news/x-stream-config.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const stateRoot = path.join(PROJECT_ROOT, "state", "news");
const logRoot = path.join(stateRoot, "logs");
const logPath = path.join(logRoot, "discord-watcher.log");
const xSourcesPath = path.join(PROJECT_ROOT, "config", "news-x-sources.json");
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

let client;
let sources = [];
let processor;
let notifier;
let token = "";
let catchupInFlight = null;
let xStreamController;

async function safeLog(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  await mkdir(logRoot, { recursive: true });
  await appendFile(logPath, line, "utf8");
  console.log(message);
}

async function catchUp(reason) {
  if (!sources.length || !processor || !notifier) return;
  if (catchupInFlight) return catchupInFlight;
  catchupInFlight = (async () => {
    for (const source of sources) {
      const summary = await source.collector.collectRecent(source.channel, { limit: 10 });
      for (const id of summary.ids) await notifier.notify(await processor.process(id));
      await safeLog(
        `${source.label} 보충 확인(${reason}): 조회 ${summary.scanned}, ` +
          `기존 ${summary.existing}, 신규 ${summary.created}, 이미지 ${summary.media}`,
      );
    }
  })();
  try {
    await catchupInFlight;
  } finally {
    catchupInFlight = null;
  }
}

async function reportError(prefix, error) {
  const message = redactSecret(error?.message ?? "알 수 없는 오류", token);
  try {
    await safeLog(`${prefix}: ${message}`);
  } catch {
    console.error(`${prefix}: ${message}`);
  }
}

async function shutdown(signal) {
  await safeLog(`Discord 공지 감시기 종료 요청: ${signal}`).catch(() => {});
  xStreamController?.abort();
  client?.destroy();
  process.exit(0);
}

try {
  const config = loadDiscordNewsConfig();
  const xStreamConfig = loadXStreamConfig();
  const hubConfig = await loadConfig();
  const runnerPath = hubConfig.integrations?.imageStudio?.generation?.freeTextRunnerPath;
  if (!path.isAbsolute(runnerPath ?? "")) {
    throw new Error("뉴스 번역용 무료 API runner가 준비되지 않았습니다.");
  }
  token = config.botToken;
  const announcementCollector = createDiscordAnnouncementCollector({
    stateRoot,
    channelId: config.openaiChannelId,
  });
  const allowedXHandles = await loadXSourceAllowlist(xSourcesPath);
  const xCollector = createXWatchCollector({
    stateRoot,
    channelId: config.xWatchChannelId,
    allowedHandles: allowedXHandles,
  });
  processor = createNewsProcessor({ stateRoot, runnerPath });
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on("messageCreate", async (message) => {
    const source = sources.find((entry) => entry.channel.id === message.channelId);
    if (!source) return;
    try {
      const result = await source.collector.collectMessage(message);
      if (result.status === "created") {
        const processed = await processor.process(result.id);
        await notifier.notify(processed);
        await safeLog(`${source.label} 새 항목 즉시 처리: 이미지 ${result.mediaCount}`);
      }
    } catch (error) {
      await reportError("Discord 실시간 공지 수집 실패", error);
    }
  });
  client.on("shardResume", () => {
    catchUp("재접속").catch((error) => reportError("Discord 재접속 보충 실패", error));
  });
  client.on("error", (error) => {
    reportError("Discord Gateway 오류", error);
  });

  await client.login(config.botToken);
  if (client.application?.id !== config.applicationId) {
    throw new Error("로그인한 Bot의 Application ID가 설정과 다릅니다.");
  }
  if (!client.guilds.cache.has(config.guildId)) {
    throw new Error("설정한 Guild를 찾지 못했습니다.");
  }
  const guild = await client.guilds.fetch(config.guildId);
  const channelEntries = await Promise.all([
    ["OpenAI Announcement", config.openaiChannelId, announcementCollector],
    ["X watch", config.xWatchChannelId, xCollector],
  ].map(async ([label, channelId, sourceCollector]) => {
    const sourceChannel = await guild.channels.fetch(channelId);
    if (!sourceChannel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(sourceChannel.type) || !sourceChannel.messages) {
      throw new Error(`${label} 텍스트 채널을 찾지 못했습니다.`);
    }
    return { label, channel: sourceChannel, collector: sourceCollector };
  }));
  const pendingChannel = await guild.channels.fetch(config.pendingChannelId);
  if (!pendingChannel?.isTextBased() || !pendingChannel.messages) {
    throw new Error("news-pending 텍스트 채널을 찾지 못했습니다.");
  }
  sources = channelEntries;
  notifier = createDiscordNewsNotifier({ stateRoot, pendingChannel });

  if (xStreamConfig.enabled) {
    const xWatchChannel = channelEntries.find((entry) => entry.label === "X watch")?.channel;
    const xStreamBridge = createXStreamDiscordBridge({
      channel: xWatchChannel,
      allowedHandles: allowedXHandles,
      collector: xCollector,
    });
    xStreamController = new AbortController();
    runXFilteredStream({
      bearerToken: xStreamConfig.bearerToken,
      signal: xStreamController.signal,
      async onEvent(event) {
        const result = await xStreamBridge.forwardEvent(event);
        if (result.status === "forwarded") {
          await safeLog(`X 스트림 새 게시물 전달: 문맥 ${result.contextCount}`);
        }
      },
      async onError(error) {
        await reportError("X 스트림 연결 실패", error);
      },
    }).catch((error) => reportError("X 스트림 종료 실패", error));
    await safeLog("X 공식 Filtered Stream 감시 시작");
  } else {
    await safeLog("X 공식 Filtered Stream 비활성");
  }

  await catchUp("시작");
  await safeLog("Discord 공지와 X 링크 실시간 감시 시작");
  setInterval(() => {
    catchUp("주기 확인").catch((error) => reportError("Discord 주기 보충 실패", error));
  }, RECONCILE_INTERVAL_MS);

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
} catch (error) {
  await reportError("Discord 공지 감시기 시작 실패", error);
  client?.destroy();
  process.exitCode = 1;
}
