import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "../src/config.mjs";
import { createDiscordAnnouncementCollector } from "../src/modules/news/discord-announcement-collector.mjs";
import { createDiscordNewsNotifier } from "../src/modules/news/discord-news-notifier.mjs";
import { loadDiscordNewsConfig, redactSecret } from "../src/modules/news/discord-config.mjs";
import { createNewsProcessor } from "../src/modules/news/news-processor.mjs";
import { createCodexNewsReviewer } from "../src/modules/news/codex-news-review.mjs";
import { createXWatchCollector } from "../src/modules/news/x-watch-collector.mjs";
import { loadXSourceAllowlist, loadXSourceRoster } from "../src/modules/news/x-watch-source.mjs";
import { createNewsSourceProfileIndex } from "../src/modules/news/news-source-profiles.mjs";
import { runXFilteredStream } from "../src/modules/news/x-filtered-stream.mjs";
import { createXStreamDiscordBridge } from "../src/modules/news/x-stream-discord-bridge.mjs";
import { loadXStreamConfig } from "../src/modules/news/x-stream-config.mjs";
import { createXStreamStatusNotifier } from "../src/modules/news/x-stream-status-notifier.mjs";
import { createPushNotificationService } from "../src/modules/notifications/push-notifications.mjs";
import { createNewsPushNotifier } from "../src/modules/news/news-push-notifier.mjs";
import { createNewsDcPublicationService } from "../src/modules/news/news-dc-publication.mjs";

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
let pushNotifier;
let pushNotifications;
let autoPublisher;
let token = "";
let catchupInFlight = null;
let xStreamController;

async function finishProcessed(record) {
  await notifier.notify(record);
  await pushNotifier.notify(record);
  if (!autoPublisher) return;
  try {
    const result = await autoPublisher.autoPublish(record.id);
    if (result.status === "posted") {
      await pushNotifications.publish("news.published").catch(() => {});
      await safeLog(`뉴스 DC 자동 게시 완료: ${record.id}`);
    } else if (["failed-preflight", "ambiguous-no-retry"].includes(result.status)) {
      await pushNotifications.publish("news.publication-review").catch(() => {});
      await safeLog(`뉴스 DC 자동 게시 확인 필요: ${record.id} (${result.status})`);
    }
  } catch (error) {
    await pushNotifications.publish("news.publication-review").catch(() => {});
    await reportError("뉴스 DC 자동 게시 실패", error);
  }
}

async function safeLog(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  await mkdir(logRoot, { recursive: true });
  await appendFile(logPath, line, "utf8");
  console.log(message);
}

async function catchUp(reason) {
  if (!sources.length || !processor || !notifier || !pushNotifier) return;
  if (catchupInFlight) return catchupInFlight;
  catchupInFlight = (async () => {
    for (const source of sources) {
      const summary = await source.collector.collectRecent(source.channel, { limit: 10 });
      for (const id of summary.ids) {
        const processed = await processor.process(id);
        await finishProcessed(processed);
      }
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
  const codexReviewConfig = hubConfig.integrations?.news?.codexReview;
  const codexReviewer = codexReviewConfig?.enabled
    ? createCodexNewsReviewer({
        stateRoot,
        executablePath: codexReviewConfig.executablePath,
        dailyLimit: codexReviewConfig.dailyLimit,
      })
    : null;
  token = config.botToken;
  const announcementCollector = createDiscordAnnouncementCollector({
    stateRoot,
    channelId: config.openaiChannelId,
  });
  const allowedXHandles = await loadXSourceAllowlist(xSourcesPath);
  const newsSourceProfiles = createNewsSourceProfileIndex(await loadXSourceRoster(xSourcesPath));
  const xCollector = createXWatchCollector({
    stateRoot,
    channelId: config.xWatchChannelId,
    allowedHandles: allowedXHandles,
    xApiBearerToken: xStreamConfig.enabled ? xStreamConfig.bearerToken : "",
  });
  processor = createNewsProcessor({ stateRoot, runnerPath, codexReviewer, sourceProfiles: newsSourceProfiles });
  const dcPublisherConfig = hubConfig.integrations?.news?.dcPublisher;
  autoPublisher = createNewsDcPublicationService({
    root: stateRoot,
    sourceProfiles: newsSourceProfiles,
    enabled:
      dcPublisherConfig?.enabled === true &&
      hubConfig.allowedActions.includes("publish-news-to-dc"),
    autoPublishEnabled: dcPublisherConfig?.autoPublish === true,
    publisherRoot: dcPublisherConfig?.publisherRoot,
    galleryId: dcPublisherConfig?.galleryId,
    coverRoot: path.join(PROJECT_ROOT, "assets", "news", "dc-covers"),
    publisherScriptPath: path.join(PROJECT_ROOT, "scripts", "publish-news-to-dc.cjs"),
    xApiBearerToken: xStreamConfig.bearerToken,
  });
  await autoPublisher.initializeAutoPublishing();
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
        await finishProcessed(processed);
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
  const [pendingChannel, logChannel] = await Promise.all([
    guild.channels.fetch(config.pendingChannelId),
    guild.channels.fetch(config.logChannelId),
  ]);
  if (!pendingChannel?.isTextBased() || !pendingChannel.messages) {
    throw new Error("news-pending 텍스트 채널을 찾지 못했습니다.");
  }
  if (!logChannel?.isTextBased()) {
    throw new Error("news-log 텍스트 채널을 찾지 못했습니다.");
  }
  sources = channelEntries;
  notifier = createDiscordNewsNotifier({ stateRoot, pendingChannel });
  pushNotifications = createPushNotificationService({
    root: path.join(PROJECT_ROOT, "state", "notifications"),
  });
  pushNotifier = createNewsPushNotifier({
    stateRoot,
    pushNotifications,
  });

  if (xStreamConfig.enabled) {
    const xWatchChannel = channelEntries.find((entry) => entry.label === "X watch")?.channel;
    const xStreamBridge = createXStreamDiscordBridge({
      channel: xWatchChannel,
      allowedHandles: allowedXHandles,
      collector: xCollector,
    });
    const xStatusNotifier = createXStreamStatusNotifier({
      channel: logChannel,
      sourceCount: allowedXHandles.size,
    });
    const announceXStatus = async (status) => {
      try {
        await xStatusNotifier.announce(status);
      } catch (error) {
        await reportError("X 상태 알림 실패", error);
      }
    };
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
      async onConnected() {
        await announceXStatus("connected");
      },
      async onError(error) {
        const status = error?.statusCode === 429
          ? "limited"
          : error?.terminal
            ? "stopped"
            : "reconnecting";
        await announceXStatus(status);
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
