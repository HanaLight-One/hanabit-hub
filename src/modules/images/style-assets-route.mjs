import { createReadStream } from "node:fs";

const LIST_ROUTE = "/api/images/styles";
const UPLOAD_ROUTE = "/api/images/styles/upload";
const REINDEX_ROUTE = "/api/images/styles/reindex";
const DOWNLOAD_ROUTE = /^\/api\/images\/styles\/([^/]+)\/download$/u;
const MAX_BODY_BYTES = 600 * 1024;

function isSameOriginRequest(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || request.headers["sec-fetch-site"] !== "same-origin") return false;
  try { return new URL(origin).host === host; }
  catch { return false; }
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("JSON 요청이 필요합니다."), { code: "INVALID_JSON" }); }
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, "_").replaceAll('"', "'").replaceAll("\\", "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function mutationError(response, sendJson, error) {
  const badRequest = new Set(["INVALID_FILENAME", "EMPTY_STYLE", "INVALID_STYLE"]);
  if (badRequest.has(error.code)) sendJson(response, 400, { error: error.message });
  else if (error.code === "STYLE_TOO_LARGE" || error.code === "BODY_TOO_LARGE") sendJson(response, 413, { error: error.message });
  else if (["STYLE_EXISTS", "MUTATION_IN_PROGRESS"].includes(error.code)) sendJson(response, 409, { error: error.message });
  else throw error;
}

export async function handleStyleAssetsRoute({ request, response, url, manager, sendJson }) {
  const pathname = url.pathname;
  const isRoute = [LIST_ROUTE, UPLOAD_ROUTE, REINDEX_ROUTE].includes(pathname) || DOWNLOAD_ROUTE.test(pathname);
  if (!isRoute) return false;
  if (!manager) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (pathname === LIST_ROUTE) {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else sendJson(response, 200, await manager.list());
    return true;
  }

  const downloadMatch = pathname.match(DOWNLOAD_ROUTE);
  if (downloadMatch) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    let style;
    try { style = await manager.find(decodeURIComponent(downloadMatch[1])); }
    catch (error) {
      if (error instanceof URIError || error.code === "INVALID_FILENAME") {
        sendJson(response, 400, { error: "올바르지 않은 화풍 이름입니다." });
        return true;
      }
      throw error;
    }
    if (!style) {
      sendJson(response, 404, { error: "화풍을 찾을 수 없습니다." });
      return true;
    }
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": style.size,
      "content-disposition": contentDisposition(style.filename),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    const stream = createReadStream(style.target);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
    return true;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!isSameOriginRequest(request)) {
    sendJson(response, 403, { error: "Same-origin request required" });
    return true;
  }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    sendJson(response, 415, { error: "JSON request required" });
    return true;
  }

  try {
    const body = await readJsonBody(request);
    if (pathname === UPLOAD_ROUTE) {
      if (body?.confirmation !== "upload-style" || typeof body.filename !== "string" || typeof body.content !== "string") {
        sendJson(response, 400, { error: "화풍 업로드 확인이 필요합니다." });
      } else {
        sendJson(response, 201, await manager.upload(body));
      }
    } else if (body?.confirmation !== "reindex-styles" || Object.keys(body).length !== 1) {
      sendJson(response, 400, { error: "색인 갱신 확인이 필요합니다." });
    } else {
      sendJson(response, 200, await manager.reindex());
    }
  } catch (error) {
    if (error.code === "INVALID_JSON") sendJson(response, 400, { error: error.message });
    else mutationError(response, sendJson, error);
  }
  return true;
}
