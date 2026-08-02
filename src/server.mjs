import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, loadConfig } from "./config.mjs";
import { createCodexControl } from "./modules/system/codex-control.mjs";
import { handleCodexControlRoute } from "./modules/system/codex-control-route.mjs";
import { createCodexUsageService } from "./modules/system/codex-usage.mjs";
import { handleCodexUsageRoute } from "./modules/system/codex-usage-route.mjs";
import { createFreeTextRuntimeStatus } from "./modules/system/free-text-runtime-status.mjs";
import { handleFreeTextRuntimeStatusRoute } from "./modules/system/free-text-runtime-status-route.mjs";
import { createNewsWatcherStatus } from "./modules/system/news-watcher-status.mjs";
import { handleNewsWatcherStatusRoute } from "./modules/system/news-watcher-status-route.mjs";
import { createDiscordTokenSetup } from "./modules/news/discord-token-setup.mjs";
import { handleDiscordTokenSetupRoute } from "./modules/news/discord-token-setup-route.mjs";
import { createNewsReader } from "./modules/news/news-reader.mjs";
import { loadXSourceRoster } from "./modules/news/x-watch-source.mjs";
import { createNewsSourceProfileIndex } from "./modules/news/news-source-profiles.mjs";
import { createNewsApprovalService } from "./modules/news/news-approval.mjs";
import { handleNewsApprovalRoute } from "./modules/news/news-approval-route.mjs";
import { createNewsDcPublicationService } from "./modules/news/news-dc-publication.mjs";
import { handleNewsDcPublicationRoute } from "./modules/news/news-dc-publication-route.mjs";
import { createNewsProcessor } from "./modules/news/news-processor.mjs";
import { createCodexNewsReviewer } from "./modules/news/codex-news-review.mjs";
import { handleNewsAnalysisRetryRoute } from "./modules/news/news-analysis-retry-route.mjs";
import { handleNewsReanalysisRoute } from "./modules/news/news-reanalysis-route.mjs";
import { createPushNotificationService } from "./modules/notifications/push-notifications.mjs";
import { handlePushNotificationRoute } from "./modules/notifications/push-notification-route.mjs";
import { handleNewsListRoute } from "./modules/news/news-list-route.mjs";
import { handleNewsMediaRoute } from "./modules/news/news-media-route.mjs";
import { createFortuneArchive } from "./modules/fortune/fortune-archive.mjs";
import { handleFortuneRoute } from "./modules/fortune/fortune-route.mjs";
import { handleFortuneTextRoute } from "./modules/fortune/fortune-text-route.mjs";
import { createCreationOptionsCatalog } from "./modules/images/creation-options.mjs";
import { handleCreationOptionsRoute } from "./modules/images/creation-options-route.mjs";
import { createGenerationDraftStore } from "./modules/images/generation-drafts.mjs";
import { handleGenerationDraftRoute } from "./modules/images/generation-draft-route.mjs";
import { createPromptOnlyExecutor } from "./modules/images/prompt-only-executor.mjs";
import { handlePromptOnlyExecutionRoute } from "./modules/images/prompt-only-execution-route.mjs";
import { createImageArchive } from "./modules/images/image-archive.mjs";
import { handleImageContentRoute } from "./modules/images/image-content-route.mjs";
import { handleImageDetailRoute } from "./modules/images/image-detail-route.mjs";
import { handleImageDownloadRoute } from "./modules/images/image-download-route.mjs";
import { handleImageListRoute } from "./modules/images/image-list-route.mjs";
import { handleImageThumbnailRoute } from "./modules/images/image-thumbnail-route.mjs";
import { createImageThumbnailService } from "./modules/images/image-thumbnails.mjs";
import { createStyleAssetManager } from "./modules/images/style-assets.mjs";
import { handleStyleAssetsRoute } from "./modules/images/style-assets-route.mjs";
import { handleProductionRecordRoute } from "./modules/images/production-record-route.mjs";
import { createProductionRecordStore } from "./modules/images/production-records.mjs";
import { createThemeHistory } from "./modules/images/theme-history.mjs";
import { handleThemeRoute } from "./modules/images/theme-route.mjs";
import { createThemeService } from "./modules/images/theme-service.mjs";
import { createTopicThemeSource } from "./modules/images/topic-theme-source.mjs";
import { openHubDatabase } from "./modules/database/hub-database.mjs";
import { createImageMetadataCatalog } from "./modules/images/image-metadata-catalog.mjs";

const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const IS_MAIN = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === path.join(APP_ROOT, "src", "server.mjs"),
);
const config = await loadConfig();
const imageStudioConfig = config.integrations?.imageStudio;
const productionRecordStore =
  imageStudioConfig?.enabled && imageStudioConfig.productionRecordsRoot
    ? createProductionRecordStore({ root: imageStudioConfig.productionRecordsRoot })
    : null;
const creationOptions =
  imageStudioConfig?.enabled && imageStudioConfig.generation?.assetIndexPath
    ? createCreationOptionsCatalog({
        assetIndexPath: imageStudioConfig.generation.assetIndexPath,
      })
    : null;
const imageArchive =
  imageStudioConfig?.enabled &&
  (imageStudioConfig.dailyImagesRoot ||
    imageStudioConfig.dailyImagesRoots?.length ||
    imageStudioConfig.pilotImagesRoot)
    ? createImageArchive({
        dailyImagesRoot: imageStudioConfig.dailyImagesRoot,
        dailyImagesRoots: imageStudioConfig.dailyImagesRoots,
        pilotImagesRoot: imageStudioConfig.pilotImagesRoot,
      })
    : null;
const imageThumbnails =
  imageArchive && imageStudioConfig.stateRoot
    ? createImageThumbnailService({
        archive: imageArchive,
        cacheRoot: path.join(imageStudioConfig.stateRoot, "thumbnails", "hub-v1"),
      })
    : null;
const generationDrafts =
  creationOptions
    ? createGenerationDraftStore({
        root: path.join(APP_ROOT, "state", "image-generation-drafts"),
        catalog: creationOptions,
        archive: imageArchive,
      })
    : null;
const generationConfig = imageStudioConfig?.generation;
const styleAssets =
  imageStudioConfig?.enabled &&
  imageStudioConfig.stylesRoot &&
  generationConfig?.assetIndexPath &&
  generationConfig?.pipelineRoot &&
  generationConfig?.pythonExecutablePath
    ? createStyleAssetManager({
        stylesRoot: imageStudioConfig.stylesRoot,
        assetIndexPath: generationConfig.assetIndexPath,
        pipelineRoot: generationConfig.pipelineRoot,
        pythonExecutablePath: generationConfig.pythonExecutablePath,
      })
    : null;
const promptOnlyExecutor =
  generationDrafts &&
  generationConfig?.assetIndexPath &&
  generationConfig?.outputRoot &&
  generationConfig?.pythonExecutablePath &&
  generationConfig?.responsesWorkerPath &&
  generationConfig?.freeTextRunnerPath
    ? createPromptOnlyExecutor({
        draftStore: generationDrafts,
        jobRoot: path.join(APP_ROOT, "state", "image-generation-jobs"),
        assetIndexPath: generationConfig.assetIndexPath,
        outputRoot: generationConfig.outputRoot,
        pythonExecutablePath: generationConfig.pythonExecutablePath,
        responsesWorkerPath: generationConfig.responsesWorkerPath,
        freeTextRunnerPath: generationConfig.freeTextRunnerPath,
        freeTextPythonExecutablePath: generationConfig.freeTextPythonExecutablePath,
        freeTextKeyStorePath: generationConfig.freeTextKeyStorePath,
      })
    : null;
const themeHistory =
  imageStudioConfig?.enabled && imageStudioConfig.stateRoot
    ? createThemeHistory({
        root: path.join(imageStudioConfig.stateRoot, "themes"),
        ...config.operations,
      })
    : null;
const topicThemeSource =
  themeHistory && imageStudioConfig.topicPath
    ? createTopicThemeSource({
        topicPath: imageStudioConfig.topicPath,
        history: themeHistory,
        channelId: imageStudioConfig.topicChannelId,
        channelName: imageStudioConfig.topicChannelName,
      })
    : null;
const themes =
  themeHistory && topicThemeSource
    ? createThemeService({
        history: themeHistory,
        source: topicThemeSource,
        ...config.operations,
      })
    : null;
const codexControl = createCodexControl({
  enabled: config.allowedActions.includes("restart-codex"),
  scriptPath: path.join(APP_ROOT, "scripts", "restart-codex.ps1"),
  auditRoot: path.join(APP_ROOT, "state"),
});
const codexUsage = createCodexUsageService();
const freeTextRuntimeStatus = createFreeTextRuntimeStatus({
  appRoot: APP_ROOT,
  runnerPath: generationConfig?.freeTextRunnerPath,
  pythonExecutablePath: generationConfig?.freeTextPythonExecutablePath,
  keyStorePath: generationConfig?.freeTextKeyStorePath,
});
const newsWatcherStatus = createNewsWatcherStatus({
  signalPath: path.join(APP_ROOT, "state", "news", "logs", "discord-watcher.log"),
});
const discordTokenSetup = createDiscordTokenSetup({
  envPath: path.join(APP_ROOT, ".env"),
});
const newsSourceProfiles = createNewsSourceProfileIndex(
  await loadXSourceRoster(path.join(APP_ROOT, "config", "news-x-sources.json")),
);
const newsReader = createNewsReader({
  root: path.join(APP_ROOT, "state", "news"),
  sourceProfiles: newsSourceProfiles,
});
const newsCodexReviewConfig = config.integrations?.news?.codexReview;
const newsCodexReviewer = newsCodexReviewConfig?.enabled
  ? createCodexNewsReviewer({
      stateRoot: path.join(APP_ROOT, "state", "news"),
      executablePath: newsCodexReviewConfig.executablePath,
      dailyLimit: newsCodexReviewConfig.dailyLimit,
    })
  : null;
const newsProcessor = path.isAbsolute(generationConfig?.freeTextRunnerPath ?? "")
  ? createNewsProcessor({
      stateRoot: path.join(APP_ROOT, "state", "news"),
      runnerPath: generationConfig.freeTextRunnerPath,
      pythonExecutablePath: generationConfig.freeTextPythonExecutablePath,
      keyStorePath: generationConfig.freeTextKeyStorePath,
      codexReviewer: newsCodexReviewer,
      sourceProfiles: newsSourceProfiles,
    })
  : null;
const newsApproval = createNewsApprovalService({ root: path.join(APP_ROOT, "state", "news") });
const newsDcPublisherConfig = config.integrations?.news?.dcPublisher;
const newsDcPublication = createNewsDcPublicationService({
  root: path.join(APP_ROOT, "state", "news"),
  sourceProfiles: newsSourceProfiles,
  enabled:
    newsDcPublisherConfig?.enabled === true &&
    config.allowedActions.includes("publish-news-to-dc"),
  publisherRoot: newsDcPublisherConfig?.publisherRoot,
  galleryId: newsDcPublisherConfig?.galleryId,
  headTextName: newsDcPublisherConfig?.headTextName,
  publisherScriptPath: path.join(APP_ROOT, "scripts", "publish-news-to-dc.cjs"),
});
const pushNotifications = createPushNotificationService({
  root: path.join(APP_ROOT, "state", "notifications"),
});
const fortuneConfig = config.integrations?.fortune;
const fortuneArchive = fortuneConfig?.enabled
  ? createFortuneArchive({
      outputRoot: fortuneConfig.outputRoot,
      publisherStateRoot: fortuneConfig.publisherStateRoot,
    })
  : null;

let runtimeDatabase = null;
let runtimeRecordStore = productionRecordStore;
if (IS_MAIN && imageArchive && generationConfig?.outputRoot) {
  runtimeDatabase = openHubDatabase({
    filePath: path.join(APP_ROOT, "state", "hanabit-hub.sqlite"),
  });
  runtimeRecordStore = createImageMetadataCatalog({
    database: runtimeDatabase,
    archive: imageArchive,
    jobRoot: path.join(APP_ROOT, "state", "image-generation-jobs"),
    dailyManifestRoot: generationConfig.workspaceRoot
      ? path.join(generationConfig.workspaceRoot, "outputs", "daily-v2")
      : null,
    optionsCatalog: creationOptions,
    legacyStore: productionRecordStore,
  });
  await runtimeRecordStore.synchronize().catch(() => {
    console.error("이미지 제작 기록 DB의 시작 색인을 완료하지 못했습니다.");
  });
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const PAGE_ROUTES = Object.freeze({
  "/images": "images/index.html",
  "/images/": "images/index.html",
  "/images/create": "images/create/index.html",
  "/images/create/": "images/create/index.html",
  "/images/styles": "images/styles/index.html",
  "/images/styles/": "images/styles/index.html",
  "/setup/discord": "setup/discord/index.html",
  "/setup/discord/": "setup/discord/index.html",
  "/news": "news/index.html",
  "/news/": "news/index.html",
  "/notifications": "notifications/index.html",
  "/notifications/": "notifications/index.html",
  "/fortune": "fortune/index.html",
  "/fortune/": "fortune/index.html",
});

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": CONTENT_TYPES[".json"],
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function resolvePublicFile(pathname) {
  const relative =
    pathname === "/"
      ? "index.html"
      : pathname === "/favicon.ico"
        ? "favicon.svg"
        : PAGE_ROUTES[pathname] ?? pathname.slice(1);
  if (!relative || relative.includes("\0")) return null;

  const target = path.resolve(PUBLIC_ROOT, relative);
  const publicRoot = path.resolve(PUBLIC_ROOT);
  if (target !== publicRoot && !target.startsWith(`${publicRoot}${path.sep}`)) {
    return null;
  }
  return target;
}

async function serveStatic(response, pathname) {
  const target = resolvePublicFile(pathname);
  if (!target) return false;

  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      ...(pathname.startsWith("/setup/discord") || pathname.startsWith("/images/styles") || pathname.startsWith("/news") || pathname.startsWith("/notifications")
        ? {
            "content-security-policy":
              "default-src 'self'; img-src 'self' data:; style-src 'self'; " +
              "script-src 'self'; base-uri 'none'; frame-ancestors 'none'; " +
              "form-action 'self'",
            "referrer-policy": "no-referrer",
          }
        : {}),
      "x-content-type-options": "nosniff",
    });
    response.end(body);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function createServer({
  archive = imageArchive,
  creationOptionsCatalog = creationOptions,
  recordStore = productionRecordStore,
  thumbnails = imageThumbnails,
  themeService = themes,
  systemControl = codexControl,
  systemUsage = codexUsage,
  systemFreeTextRuntime = freeTextRuntimeStatus,
  systemNewsWatcher = newsWatcherStatus,
  discordSetup = discordTokenSetup,
  news = newsReader,
  newsAnalysisProcessor = newsProcessor,
  newsApprovalService = newsApproval,
  newsDcPublicationService = newsDcPublication,
  notificationService = pushNotifications,
  fortune = fortuneArchive,
  drafts = generationDrafts,
  generationExecutor = promptOnlyExecutor,
  styleAssetManager = styleAssets,
} = {}) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || `${config.host}:${config.port}`}`,
      );

      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, {
          ok: true,
          service: "hanabit-hub",
          version: "0.1.0",
        });
      }

      if (
        await handleCodexControlRoute({
          request,
          response,
          pathname: url.pathname,
          control: systemControl,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleCodexUsageRoute({
          request,
          response,
          pathname: url.pathname,
          usage: systemUsage,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleFreeTextRuntimeStatusRoute({
          request,
          response,
          pathname: url.pathname,
          runtimeStatus: systemFreeTextRuntime,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsWatcherStatusRoute({
          request,
          response,
          pathname: url.pathname,
          watcherStatus: systemNewsWatcher,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleDiscordTokenSetupRoute({
          request,
          response,
          pathname: url.pathname,
          setup: discordSetup,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handlePushNotificationRoute({
          request,
          response,
          pathname: url.pathname,
          service: notificationService,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsListRoute({
          request,
          response,
          pathname: url.pathname,
          reader: news,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsApprovalRoute({
          request,
          response,
          pathname: url.pathname,
          approvalService: newsApprovalService,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsDcPublicationRoute({
          request,
          response,
          pathname: url.pathname,
          publicationService: newsDcPublicationService,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsAnalysisRetryRoute({
          request,
          response,
          pathname: url.pathname,
          processor: newsAnalysisProcessor,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsReanalysisRoute({
          request,
          response,
          pathname: url.pathname,
          processor: newsAnalysisProcessor,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleNewsMediaRoute({
          request,
          response,
          pathname: url.pathname,
          reader: news,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleFortuneRoute({ request, response, url, archive: fortune, sendJson })
      ) {
        return;
      }

      if (
        await handleFortuneTextRoute({
          request,
          response,
          pathname: url.pathname,
          archive: fortune,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleThemeRoute({
          request,
          response,
          url,
          service: themeService,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleStyleAssetsRoute({
          request,
          response,
          url,
          manager: styleAssetManager,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleCreationOptionsRoute({
          request,
          response,
          pathname: url.pathname,
          catalog: creationOptionsCatalog,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleGenerationDraftRoute({
          request,
          response,
          pathname: url.pathname,
          drafts,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handlePromptOnlyExecutionRoute({
          request,
          response,
          pathname: url.pathname,
          executor: generationExecutor,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleImageListRoute({
          request,
          response,
          pathname: url.pathname,
          archive,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleImageDetailRoute({
          request,
          response,
          pathname: url.pathname,
          archive,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleImageContentRoute({
          request,
          response,
          pathname: url.pathname,
          archive,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleImageThumbnailRoute({
          request,
          response,
          pathname: url.pathname,
          thumbnails,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleImageDownloadRoute({
          request,
          response,
          pathname: url.pathname,
          archive,
          sendJson,
        })
      ) {
        return;
      }

      if (
        await handleProductionRecordRoute({
          request,
          response,
          pathname: url.pathname,
          store: recordStore,
          sendJson,
        })
      ) {
        return;
      }

      if (request.method === "GET" && (await serveStatic(response, url.pathname))) {
        return;
      }

      sendJson(response, request.method === "GET" ? 404 : 405, {
        error: request.method === "GET" ? "Not found" : "Method not allowed",
      });
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: "Internal server error" });
    }
  });
}

if (IS_MAIN) {
  const server = createServer({ recordStore: runtimeRecordStore });
  server.once("close", () => runtimeDatabase?.close());
  server.listen(config.port, config.host, () => {
    console.log(`Hanabit Hub listening on http://${config.host}:${config.port}`);
  });
}
