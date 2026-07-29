import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { APP_ROOT, loadConfig } from "./config.mjs";
import { createImageArchive } from "./modules/images/image-archive.mjs";
import { handleImageContentRoute } from "./modules/images/image-content-route.mjs";
import { handleImageDownloadRoute } from "./modules/images/image-download-route.mjs";
import { handleImageListRoute } from "./modules/images/image-list-route.mjs";
import { handleImageThumbnailRoute } from "./modules/images/image-thumbnail-route.mjs";
import { createImageThumbnailService } from "./modules/images/image-thumbnails.mjs";
import { handleProductionRecordRoute } from "./modules/images/production-record-route.mjs";
import { createProductionRecordStore } from "./modules/images/production-records.mjs";

const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const config = await loadConfig();
const imageStudioConfig = config.integrations?.imageStudio;
const productionRecordStore =
  imageStudioConfig?.enabled && imageStudioConfig.productionRecordsRoot
    ? createProductionRecordStore({ root: imageStudioConfig.productionRecordsRoot })
    : null;
const imageArchive =
  imageStudioConfig?.enabled &&
  (imageStudioConfig.dailyImagesRoot || imageStudioConfig.pilotImagesRoot)
    ? createImageArchive({
        dailyImagesRoot: imageStudioConfig.dailyImagesRoot,
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

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": CONTENT_TYPES[".json"],
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function resolvePublicFile(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
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
  recordStore = productionRecordStore,
  thumbnails = imageThumbnails,
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
