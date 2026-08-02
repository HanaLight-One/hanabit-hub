import { createReadStream } from "node:fs";

const MOVE_ROUTE = /^\/api\/images\/([a-f0-9]{64})\/trash$/u;
const ITEM_ROUTE = /^\/api\/images\/trash\/([a-f0-9]{32})\/(restore|delete|content)$/u;
const CONTENT_TYPES = Object.freeze({ ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" });

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || request.headers["sec-fetch-site"] !== "same-origin") return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function confirmation(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return null;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 1024) return null;
  }
  try { return JSON.parse(raw || "{}").confirmation ?? null; } catch { return null; }
}

function errorStatus(error) {
  if (["NOT_FOUND", "INVALID_ID"].includes(error.code)) return 404;
  if (["PROTECTED", "DISABLED"].includes(error.code)) return 403;
  if (error.code === "TARGET_EXISTS") return 409;
  if (error.code === "UNSAFE_PATH") return 400;
  return null;
}

export async function handleImageTrashRoute({ request, response, pathname, trash, sendJson }) {
  const moveMatch = pathname.match(MOVE_ROUTE);
  const itemMatch = pathname.match(ITEM_ROUTE);
  if (pathname !== "/api/images/trash" && !moveMatch && !itemMatch) return false;
  if (!trash) { sendJson(response, 404, { error: "Not found" }); return true; }

  if (pathname === "/api/images/trash") {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else sendJson(response, 200, await trash.list());
    return true;
  }

  if (itemMatch?.[2] === "content") {
    if (request.method !== "GET") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
    const content = await trash.findContent(itemMatch[1]);
    if (!content) { sendJson(response, 404, { error: "이미지를 찾을 수 없습니다." }); return true; }
    response.writeHead(200, { "content-type": CONTENT_TYPES[content.extension] ?? "application/octet-stream", "content-length": content.size, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    const stream = createReadStream(content.target);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
    return true;
  }

  if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
  if (!sameOrigin(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
  const confirmed = await confirmation(request);
  const action = moveMatch ? "move-image-to-trash" : itemMatch[2] === "restore" ? "restore-image-from-trash" : "permanently-delete-image";
  if (confirmed !== action) { sendJson(response, 400, { error: "정확한 확인값이 필요합니다." }); return true; }
  try {
    const result = moveMatch ? await trash.move(moveMatch[1]) : itemMatch[2] === "restore" ? await trash.restore(itemMatch[1]) : await trash.permanentlyDelete(itemMatch[1]);
    sendJson(response, 200, result);
  } catch (error) {
    const status = errorStatus(error);
    if (status) sendJson(response, status, { error: error.message }); else throw error;
  }
  return true;
}
