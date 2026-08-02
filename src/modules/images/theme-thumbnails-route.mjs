import { createReadStream } from "node:fs";

const ROOT = "/api/images/theme-thumbnails";
const CONTENT = /^\/api\/images\/theme-thumbnails\/([1-9][0-9]*\.png)\/content$/u;
const SETTINGS = /^\/api\/images\/theme-thumbnails\/([1-9][0-9]*\.png)\/settings$/u;
const REMOVE = /^\/api\/images\/theme-thumbnails\/([1-9][0-9]*\.png)$/u;
const MAX_JSON = 32 * 1024;
const MAX_UPLOAD = 20 * 1024 * 1024;

function sameOrigin(request) {
  try {
    return request.headers["sec-fetch-site"] === "same-origin" && new URL(request.headers.origin).host === request.headers.host;
  } catch { return false; }
}

async function readBody(request, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("요청이 너무 커요."), { code: "TOO_LARGE" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request) {
  try { return JSON.parse((await readBody(request, MAX_JSON)).toString("utf8")); }
  catch (error) {
    if (error.code === "TOO_LARGE") throw error;
    throw Object.assign(new Error("JSON 요청이 필요해요."), { code: "INVALID_JSON" });
  }
}

function sendMutationError(response, sendJson, error) {
  if (["INVALID_LABEL", "INVALID_WEIGHT", "INVALID_DATE", "INVALID_JSON"].includes(error.code)) sendJson(response, 400, { error: error.message });
  else if (["INVALID_UPLOAD", "TOO_LARGE"].includes(error.code)) sendJson(response, 413, { error: error.message });
  else if (error.code === "NOT_FOUND") sendJson(response, 404, { error: error.message });
  else if (["DISABLED", "BUSY", "MINIMUM_ASSETS", "IN_USE"].includes(error.code)) sendJson(response, 409, { error: error.message });
  else throw error;
}

export async function handleThemeThumbnailsRoute({ request, response, url, manager, sendJson }) {
  const { pathname } = url;
  const isRoute = pathname === ROOT || pathname === `${ROOT}/upload` || pathname === `${ROOT}/force`
    || CONTENT.test(pathname) || SETTINGS.test(pathname) || REMOVE.test(pathname);
  if (!isRoute) return false;
  if (!manager) { sendJson(response, 404, { error: "Not found" }); return true; }

  if (pathname === ROOT) {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else sendJson(response, 200, await manager.state());
    return true;
  }

  const content = pathname.match(CONTENT);
  if (content) {
    if (request.method !== "GET") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
    const file = await manager.find(content[1]);
    if (!file) { sendJson(response, 404, { error: "Not found" }); return true; }
    response.writeHead(200, { "content-type": "image/png", "content-length": file.size, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" });
    createReadStream(file.target).pipe(response);
    return true;
  }

  if (!["POST", "DELETE"].includes(request.method) || !sameOrigin(request)) {
    sendJson(response, request.method === "GET" ? 405 : 403, { error: "Same-origin mutation required" });
    return true;
  }
  try {
    if (pathname === `${ROOT}/upload`) {
      if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("image/png") || request.headers["x-thumbnail-confirmation"] !== "upload-theme-thumbnail") {
        sendJson(response, 400, { error: "PNG 업로드 확인값이 필요해요." }); return true;
      }
      let label = "";
      try { label = decodeURIComponent(request.headers["x-thumbnail-label"] ?? ""); }
      catch { sendJson(response, 400, { error: "표시 이름 인코딩이 올바르지 않아요." }); return true; }
      const result = await manager.upload({ buffer: await readBody(request, MAX_UPLOAD), label });
      sendJson(response, 201, result); return true;
    }
    const body = await jsonBody(request);
    const settings = pathname.match(SETTINGS);
    if (settings && request.method === "POST" && body.confirmation === "update-theme-thumbnail") {
      sendJson(response, 200, await manager.update(settings[1], body)); return true;
    }
    if (pathname === `${ROOT}/force` && request.method === "POST" && body.confirmation === "force-theme-thumbnail") {
      sendJson(response, 200, await manager.force(body.date, body.filename ?? null)); return true;
    }
    const removal = pathname.match(REMOVE);
    if (removal && request.method === "DELETE" && body.confirmation === "delete-theme-thumbnail") {
      sendJson(response, 200, await manager.remove(removal[1])); return true;
    }
    sendJson(response, 400, { error: "요청 확인값이 올바르지 않아요." });
  } catch (error) { sendMutationError(response, sendJson, error); }
  return true;
}
