const SETUP_PATH = "/api/setup/discord-token";
const CONFIRMATION = "save-discord-bot-token";
const MAX_BODY_BYTES = 512;

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
      throw Object.assign(new Error("요청이 너무 큽니다."), {
        code: "BODY_TOO_LARGE",
      });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON 요청이 필요합니다."), {
      code: "INVALID_JSON",
    });
  }
}

function setupFailure(response, sendJson, error) {
  if (error.code === "ALREADY_CONFIGURED") {
    sendJson(response, 409, { error: "Bot Token이 이미 설정되어 있습니다." });
  } else if (error.code === "INVALID_TOKEN") {
    sendJson(response, 400, { error: error.message });
  } else if (error.code === "SAVE_IN_PROGRESS") {
    sendJson(response, 409, { error: "다른 저장 요청을 처리 중입니다." });
  } else {
    sendJson(response, 503, { error: "비밀값 저장소를 사용할 수 없습니다." });
  }
}

export async function handleDiscordTokenSetupRoute({
  request,
  response,
  pathname,
  setup,
  sendJson,
}) {
  if (pathname !== SETUP_PATH) return false;

  if (!setup) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (request.method === "GET") {
    try {
      sendJson(response, 200, await setup.status());
    } catch (error) {
      setupFailure(response, sendJson, error);
    }
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
    Object.keys(body).length !== 2 ||
    body.confirmation !== CONFIRMATION ||
    typeof body.token !== "string"
  ) {
    sendJson(response, 400, { error: "저장 확인이 필요합니다." });
    return true;
  }

  try {
    sendJson(response, 201, await setup.save(body.token));
  } catch (error) {
    setupFailure(response, sendJson, error);
  }
  return true;
}
