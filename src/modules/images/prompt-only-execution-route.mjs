const EXECUTE_PATTERN = /^\/api\/images\/generation-drafts\/([a-f0-9]{32})\/execute$/u;
const STATUS_PATTERN = /^\/api\/images\/generation-jobs\/([a-f0-9]{32})$/u;
const REGENERATE_PATTERN = /^\/api\/images\/generation-jobs\/([a-f0-9]{32})\/regenerate$/u;
const LIST_PATH = "/api/images/generation-jobs";
const CONFIRMATION = "generate-one-draft-image";
const BATCH_CONFIRMATION = "generate-draft-image-batch";
const REGENERATE_CONFIRMATION = "regenerate-same-settings";
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

function readListLimit(request) {
  const raw = new URL(request.url, "http://127.0.0.1").searchParams.get("limit");
  if (!raw || !/^\d+$/u.test(raw)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Number.parseInt(raw, 10)));
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || request.headers["sec-fetch-site"] !== "same-origin") return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function readConfirmation(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "BAD_BODY" });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      ![CONFIRMATION, BATCH_CONFIRMATION].includes(body.confirmation)
    ) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error("실제 이미지 생성 확인이 필요합니다."), { code: "BAD_BODY" });
  }
}

async function readRegeneration(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "BAD_BODY" });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !body ||
      Object.keys(body).sort().join(",") !== "confirmation,slot" ||
      body.confirmation !== REGENERATE_CONFIRMATION ||
      !Number.isInteger(body.slot)
    ) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error("동일 설정 재생성 확인이 필요합니다."), { code: "BAD_BODY" });
  }
}

function failure(response, sendJson, error) {
  if (["INVALID_ID", "DRAFT_NOT_FOUND", "JOB_NOT_FOUND"].includes(error.code)) sendJson(response, 404, { error: "Not found" });
  else if (["NOT_EXECUTABLE", "ALREADY_STARTED"].includes(error.code)) sendJson(response, 409, { error: error.message });
  else if (error.code === "INVALID_SLOT") sendJson(response, 400, { error: error.message });
  else if (error.code === "JOB_NOT_REGENERATABLE") sendJson(response, 409, { error: error.message });
  else if (["RUNTIME_UNAVAILABLE", "LAUNCH_FAILED"].includes(error.code)) sendJson(response, 503, { error: error.message });
  else throw error;
}

export async function handlePromptOnlyExecutionRoute({ request, response, pathname, executor, sendJson }) {
  const execute = pathname.match(EXECUTE_PATTERN);
  const status = pathname.match(STATUS_PATTERN);
  const regenerate = pathname.match(REGENERATE_PATTERN);
  const listing = pathname === LIST_PATH;
  if (!execute && !status && !regenerate && !listing) return false;
  if (!executor) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (listing) {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else sendJson(response, 200, await executor.list({ limit: readListLimit(request) }));
    return true;
  }

  if (status) {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else {
      try { sendJson(response, 200, await executor.status(status[1])); }
      catch (error) { failure(response, sendJson, error); }
    }
    return true;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!sameOrigin(request)) {
    sendJson(response, 403, { error: "Same-origin request required" });
    return true;
  }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    sendJson(response, 415, { error: "JSON request required" });
    return true;
  }
  try {
    if (regenerate) {
      const { slot } = await readRegeneration(request);
      sendJson(response, 202, await executor.regenerate(regenerate[1], { slot }));
      return true;
    }
    const { confirmation } = await readConfirmation(request);
    sendJson(response, 202, await executor.start(execute[1], { confirmation }));
  } catch (error) {
    if (error.code === "BAD_BODY") sendJson(response, 400, { error: error.message });
    else failure(response, sendJson, error);
  }
  return true;
}

export { BATCH_CONFIRMATION, CONFIRMATION, REGENERATE_CONFIRMATION };
