import { createReadStream } from "node:fs";

const UPLOAD_CONTENT = /^\/api\/dc\/uploads\/([a-f0-9]{32})\/content$/u;
const UPLOAD_ITEM = /^\/api\/dc\/uploads\/([a-f0-9]{32})$/u;
const PREVIEW = /^\/api\/dc\/drafts\/([a-f0-9]{32})\/preview$/u;
const PUBLISH = /^\/api\/dc\/drafts\/([a-f0-9]{32})\/publish$/u;
const MAX_JSON = 256 * 1024;
const MAX_UPLOAD = 20 * 1024 * 1024;

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || request.headers["sec-fetch-site"] !== "same-origin") return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function readBody(request, maximum) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) throw Object.assign(new Error("JSON 요청이 필요합니다."), { code: "INVALID_JSON" });
  try { return JSON.parse((await readBody(request, MAX_JSON)).toString("utf8") || "{}"); }
  catch (error) { if (error.code) throw error; throw Object.assign(new Error("JSON 요청이 필요합니다."), { code: "INVALID_JSON" }); }
}

function statusFor(error) {
  if (["NOT_FOUND", "IMAGE_NOT_FOUND"].includes(error.code)) return 404;
  if (["DISABLED", "FINAL_DRAFT"].includes(error.code)) return 403;
  if (["ALREADY_SUBMITTING", "ALREADY_SUBMITTED", "UPLOAD_IN_USE"].includes(error.code)) return 409;
  if (["UPLOAD_TOO_LARGE", "BODY_TOO_LARGE"].includes(error.code)) return 413;
  if (["INVALID_ID", "INVALID_MEDIA", "EMPTY_UPLOAD", "INVALID_IMAGES", "INVALID_BLOCKS", "INVALID_JSON", "PREFLIGHT_FAILED"].includes(error.code)) return 400;
  if (error.code === "RUNTIME_UNAVAILABLE") return 503;
  return null;
}

export async function handleDcComposerRoute({ request, response, pathname, composer, sendJson }) {
  const contentMatch = pathname.match(UPLOAD_CONTENT);
  const uploadMatch = pathname.match(UPLOAD_ITEM);
  const previewMatch = pathname.match(PREVIEW);
  const publishMatch = pathname.match(PUBLISH);
  const matched = pathname === "/api/dc/composer" || pathname === "/api/dc/uploads" || pathname === "/api/dc/drafts" || contentMatch || uploadMatch || previewMatch || publishMatch;
  if (!matched) return false;
  if (!composer) { sendJson(response, 404, { error: "Not found" }); return true; }

  try {
    if (pathname === "/api/dc/composer") {
      if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
      else sendJson(response, 200, { ...(await composer.status()), uploads: await composer.listUploads(), draft: await composer.latestDraft() });
      return true;
    }
    if (contentMatch) {
      if (request.method !== "GET") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
      const content = await composer.uploadContent(contentMatch[1]);
      if (!content) { sendJson(response, 404, { error: "이미지를 찾을 수 없습니다." }); return true; }
      response.writeHead(200, { "content-type": content.contentType, "content-length": content.size, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      const stream = createReadStream(content.target);
      stream.on("error", (error) => response.destroy(error));
      stream.pipe(response);
      return true;
    }
    if (pathname === "/api/dc/uploads" && request.method === "POST") {
      if (!sameOrigin(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
      const contentType = String(request.headers["content-type"] ?? "").split(";")[0].toLowerCase();
      const filename = decodeURIComponent(String(request.headers["x-upload-filename"] ?? "upload"));
      sendJson(response, 201, await composer.upload({ filename, contentType, buffer: await readBody(request, MAX_UPLOAD) }));
      return true;
    }
    if (uploadMatch) {
      if (request.method !== "DELETE") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
      if (!sameOrigin(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
      const body = await readJson(request);
      if (body.confirmation !== "delete-dc-upload") { sendJson(response, 400, { error: "업로드 삭제 확인값이 필요합니다." }); return true; }
      sendJson(response, 200, await composer.deleteUpload(uploadMatch[1]));
      return true;
    }
    if (pathname === "/api/dc/drafts") {
      if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
      if (!sameOrigin(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
      const body = await readJson(request);
      if (body.confirmation !== "save-dc-draft") { sendJson(response, 400, { error: "초안 저장 확인값이 필요합니다." }); return true; }
      sendJson(response, 200, await composer.saveDraft(body));
      return true;
    }
    if (previewMatch) {
      if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
      else sendJson(response, 200, await composer.preview(previewMatch[1]));
      return true;
    }
    if (publishMatch) {
      if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
      if (!sameOrigin(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
      const body = await readJson(request);
      if (body.confirmation !== "publish-dc-compose-now") { sendJson(response, 400, { error: "실제 DC 게시 확인값이 필요합니다." }); return true; }
      sendJson(response, 200, await composer.publish(publishMatch[1]));
      return true;
    }
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error instanceof URIError) {
      sendJson(response, 400, { error: "올바르지 않은 파일 이름입니다." });
      return true;
    }
    const status = statusFor(error);
    if (status) sendJson(response, status, { error: error.message }); else throw error;
  }
  return true;
}
