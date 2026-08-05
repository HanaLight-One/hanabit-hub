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
import { createOfficialNewsCollector, loadOfficialNewsSources } from "../src/modules/news/official-news-collector.mjs";
import { createShadowNewsCollector, loadShadowNewsSources } from "../src/modules/news/shadow-news-collector.mjs";
import {
  createOpenAIStatusMonitor,
  OPENAI_STATUS_INTERVAL_MS,
} from "../src/modules/news/openai-status-monitor.mjs";
import { createOpenAIStatusPostReplacer } from "../src/modules/news/openai-status-post-replacer.mjs";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const stateRoot = path.join(PROJECT_ROOT, "state", "news");
const logRoot = path.join(stateRoot, "logs");
const logPath = path.join(logRoot, "discord-watcher.log");
const xSourcesPath = path.join(PROJECT_ROOT, "config", "news-x-sources.json");
const officialSourcesPath = path.join(PROJECT_ROOT, "config", "news-official-sources.json");
const shadowSourcesPath = path.join(PROJECT_ROOT, "config", "news-shadow-sources.json");
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
let officialInFlight = null;
let shadowInFlight = null;
let xStreamController;
let officialCollector;
let shadowCollector;
let statusMonitor;
let statusPostReplacer;
let statusInFlight = null;
const newsStore = createPendingNewsStore({ root: stateRoot });

const STATUS_TITLES = Object.freeze({
  outage: "[장애발생] OpenAI 서비스 장애 발생",
  expanded: "[장애확대] OpenAI 서비스 장애 확대",
  updated: "[장애현황] OpenAI 서비스 장애 업데이트",
  "partial-recovery": "[부분복구] OpenAI 서비스 일부 장애 지속",
  recovered: "[복구완료] OpenAI 서비스 정상화",
});

async function finishProcessed(record) {
  await notifier.notify(record);
  await pushNotifier.notify(record);
  if (!autoPublisher) return null;
  try {
    const result = await autoPublisher.autoPublish(record.id);
    if (result.status === "posted") {
      await pushNotifications.publish("news.published").catch(() => {});
      await safeLog(`뉴스 DC 자동 게시 완료: ${record.id}`);
    } else if (["failed-preflight", "ambiguous-no-retry"].includes(result.status)) {
      await pushNotifications.publish("news.publication-review").catch(() => {});
      await safeLog(`뉴스 DC 자동 게시 확인 필요: ${record.id} (${result.status})`);
    }
    return result;
  } catch (error) {
    await pushNotifications.publish("news.publication-review").catch(() => {});
    await reportError("뉴스 DC 자동 게시 실패", error);
    return { id: record.id, status: "failed" };
  }
}

async function replacePreviousStatusPost(previousPost) {
  if (!previousPost || !statusPostReplacer) return { status: "not-required" };
  const result = await statusPostReplacer.replace(previousPost);
  await statusMonitor.recordReplacement(previousPost, result);
  if (result.status !== "deleted") {
    await pushNotifications.publish("news.publication-review").catch(() => {});
    await safeLog(`OpenAI 상태 이전 글 삭제 확인 필요: ${previousPost.postId} (${result.status})`);
  } else {
    await safeLog(`OpenAI 상태 이전 글 삭제 완료: ${previousPost.postId}`);
  }
  return result;
}

async function collectOpenAIStatus(reason) {
  if (!statusMonitor || !processor || !notifier || !pushNotifier) return;
  if (statusInFlight) return statusInFlight;
  statusInFlight = (async () => {
    const result = await statusMonitor.poll();
    if (!["created", "existing"].includes(result.status)) {
      if (result.status !== "unchanged") {
        await safeLog(`OpenAI 상태 확인(${reason}): ${result.status}, 활성 장애 ${result.activeCount}`);
      }
      return;
    }
    const currentPost = (await statusMonitor.readState())?.currentPost ?? null;
    if (["automatic", "adopted-replaceable"].includes(currentPost?.ownership)) {
      const replacement = await replacePreviousStatusPost(currentPost);
      if (replacement.status !== "deleted") {
        await safeLog(`OpenAI 상태 새 글 게시 보류: 이전 글 ${currentPost.postId} 삭제 미확정`);
        return;
      }
    }
    let processed = await processor.process(result.id);
    const title = STATUS_TITLES[result.phase];
    if (title && processed.workflow?.translation) {
      processed = await newsStore.update(result.id, (current) => ({
        ...current,
        workflow: {
          ...current.workflow,
          translation: { ...current.workflow.translation, title },
        },
      }));
    }
    const publication = await finishProcessed(processed);
    if (publication?.status !== "posted" || !publication.publication?.postId) return;
    await statusMonitor.confirmPublished(result.snapshotHash, publication.publication);
    await safeLog(`OpenAI 상태 새 글 게시 완료: ${result.phase} (${publication.publication.postId})`);
  })();
  try {
    await statusInFlight;
  } finally {
    statusInFlight = null;
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

async function collectOfficialNews(reason) {
  if (!officialCollector || !processor || !notifier || !pushNotifier) return;
  if (officialInFlight) return officialInFlight;
  officialInFlight = (async () => {
    const summary = await officialCollector.collectAll();
    for (const id of summary.ids) {
      const processed = await processor.process(id);
      await finishProcessed(processed);
    }
    await safeLog(
      `공식 무료 소스 확인(${reason}): 소스 ${summary.sources}, 조회 ${summary.scanned}, ` +
      `기준선 ${summary.baselined}, 신규 ${summary.created}, 실패 ${summary.failed}`,
    );
  })();
  try {
    await officialInFlight;
  } finally {
    officialInFlight = null;
  }
}

async function collectShadowNews(reason) {
  if (!shadowCollector) return;
  if (shadowInFlight) return shadowInFlight;
  shadowInFlight = (async () => {
    const summary = await shadowCollector.collectAll();
    await safeLog(
      `외신 그림자 레이더(${reason}): 소스 ${summary.sources}, 조회 ${summary.scanned}, ` +
      `기준선 ${summary.baselined}, 신규 ${summary.created}, 실패 ${summary.failed}`,
    );
  })();
  try {
    await shadowInFlight;
  } finally {
    shadowInFlight = null;
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
  const officialNewsConfig = await loadOfficialNewsSources(officialSourcesPath);
  const shadowNewsConfig = await loadShadowNewsSources(shadowSourcesPath);
  officialCollector = createOfficialNewsCollector({ stateRoot, sources: officialNewsConfig.sources });
  shadowCollector = createShadowNewsCollector({ stateRoot, sources: shadowNewsConfig.sources });
  const generationConfig = hubConfig.integrations?.imageStudio?.generation;
  const runnerPath = generationConfig?.freeTextRunnerPath;
  const pythonExecutablePath = generationConfig?.freeTextPythonExecutablePath;
  const keyStorePath = generationConfig?.freeTextKeyStorePath;
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
  processor = createNewsProcessor({
    stateRoot,
    runnerPath,
    pythonExecutablePath,
    keyStorePath,
    codexReviewer,
    sourceProfiles: newsSourceProfiles,
  });
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
  statusMonitor = createOpenAIStatusMonitor({ stateRoot });
  statusPostReplacer = createOpenAIStatusPostReplacer({
    root: stateRoot,
    publisherRoot: dcPublisherConfig?.publisherRoot,
    deleteScriptPath: path.join(PROJECT_ROOT, "scripts", "delete-news-dc-post.cjs"),
  });
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
  await collectOfficialNews("시작").catch((error) => reportError("공식 무료 소스 시작 확인 실패", error));
  setInterval(() => {
    collectOfficialNews("주기 확인").catch((error) => reportError("공식 무료 소스 확인 실패", error));
  }, officialNewsConfig.intervalMinutes * 60 * 1000);
  await collectShadowNews("시작").catch((error) => reportError("외신 그림자 레이더 시작 확인 실패", error));
  setInterval(() => {
    collectShadowNews("주기 확인").catch((error) => reportError("외신 그림자 레이더 확인 실패", error));
  }, shadowNewsConfig.intervalMinutes * 60 * 1000);
  const pendingReplacement = (await statusMonitor.readState())?.pendingReplacement;
  if (pendingReplacement) {
    await replacePreviousStatusPost(pendingReplacement)
      .catch((error) => reportError("OpenAI 상태 이전 글 삭제 복구 실패", error));
  }
  await collectOpenAIStatus("시작").catch((error) => reportError("OpenAI 상태 시작 확인 실패", error));
  setInterval(() => {
    collectOpenAIStatus("주기 확인").catch((error) => reportError("OpenAI 상태 확인 실패", error));
  }, OPENAI_STATUS_INTERVAL_MS);

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
} catch (error) {
  await reportError("Discord 공지 감시기 시작 실패", error);
  client?.destroy();
  process.exitCode = 1;
}
