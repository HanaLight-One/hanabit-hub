import { ACTION_ID } from "./codex-control.mjs";

const STATUS_PATH = "/api/system/codex";
const RESTART_PATH = "/api/system/codex/restart";
const MAX_BODY_BYTES = 1_024;

function isSameOriginRequest(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  const fetchSite = request.headers["sec-fetch-site"];
  if (!origin || !host || fetchSite !== "same-origin") return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("요청이 너무 큽니다."), { code: "BODY_TOO_LARGE" });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON 요청이 필요합니다."), { code: "INVALID_JSON" });
  }
}

export async function handleCodexControlRoute({
  request,
  response,
  pathname,
  control,
  sendJson,
}) {
  if (pathname !== STATUS_PATH && pathname !== RESTART_PATH) return false;

  if (!control) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (pathname === STATUS_PATH) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    sendJson(response, 200, await control.status());
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

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.code === "BODY_TOO_LARGE" ? 413 : 400, {
      error: error.message,
    });
    return true;
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    body.confirmation !== ACTION_ID
  ) {
    sendJson(response, 400, { error: "재기동 확인이 필요합니다." });
    return true;
  }

  try {
    sendJson(response, 202, await control.restart());
  } catch (error) {
    if (error.code === "ACTION_DISABLED") {
      sendJson(response, 404, { error: "Not found" });
    } else if (error.code === "COOLDOWN") {
      sendJson(response, 429, { error: error.message });
    } else {
      sendJson(response, 503, { error: "재기동 요청을 전달하지 못했습니다." });
    }
  }
  return true;
}
