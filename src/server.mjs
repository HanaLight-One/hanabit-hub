import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, loadConfig } from "./config.mjs";
import { createCodexControl } from "./modules/system/codex-control.mjs";
import { handleCodexControlRoute } from "./modules/system/codex-control-route.mjs";
import { createDiscordTokenSetup } from "./modules/news/discord-token-setup.mjs";
import { handleDiscordTokenSetupRoute } from "./modules/news/discord-token-setup-route.mjs";
import { createCreationOptionsCatalog } from "./modules/images/creation-options.mjs";
import { handleCreationOptionsRoute } from "./modules/images/creation-options-route.mjs";
import { createImageArchive } from "./modules/images/image-archive.mjs";
import { handleImageContentRoute } from "./modules/images/image-content-route.mjs";
import { handleImageDetailRoute } from "./modules/images/image-detail-route.mjs";
import { handleImageDownloadRoute } from "./modules/images/image-download-route.mjs";
import { handleImageListRoute } from "./modules/images/image-list-route.mjs";
import { handleImageThumbnailRoute } from "./modules/images/image-thumbnail-route.mjs";
import { createImageThumbnailService } from "./modules/images/image-thumbnails.mjs";
import { handleProductionRecordRoute } from "./modules/images/production-record-route.mjs";
import { createProductionRecordStore } from "./modules/images/production-records.mjs";
import { createThemeHistory } from "./modules/images/theme-history.mjs";
import { handleThemeRoute } from "./modules/images/theme-route.mjs";
import { createThemeService } from "./modules/images/theme-service.mjs";
import { createTopicThemeSource } from "./modules/images/topic-theme-source.mjs";

const PUBLIC_ROOT = path.join(APP_ROOT, "public");
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
const discordTokenSetup = createDiscordTokenSetup({
  envPath: path.join(APP_ROOT, ".env"),
});

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const PAGE_ROUTES = Object.freeze({
  "/images": "images/index.html",
  "/images/": "images/index.html",
  "/images/create": "images/create/index.html",
  "/images/create/": "images/create/index.html",
  "/setup/discord": "setup/discord/index.html",
  "/setup/discord/": "setup/discord/index.html",
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
    pathname === "/" ? "index.html" : PAGE_ROUTES[pathname] ?? pathname.slice(1);
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
      ...(pathname.startsWith("/setup/discord")
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
  discordSetup = discordTokenSetup,
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

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(APP_ROOT, "src", "server.mjs")) {
  createServer().listen(config.port, config.host, () => {
    console.log(`Hanabit Hub listening on http://${config.host}:${config.port}`);
  });
}
