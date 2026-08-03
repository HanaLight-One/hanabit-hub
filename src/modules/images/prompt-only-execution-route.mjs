const EXECUTE_PATTERN = /^\/api\/images\/generation-drafts\/([a-f0-9]{32})\/execute$/u;
const STATUS_PATTERN = /^\/api\/images\/generation-jobs\/([a-f0-9]{32})$/u;
const LIST_PATH = "/api/images/generation-jobs";
const CONFIRMATION = "generate-one-draft-image";
const BATCH_CONFIRMATION = "generate-draft-image-batch";

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

function failure(response, sendJson, error) {
  if (["INVALID_ID", "DRAFT_NOT_FOUND", "JOB_NOT_FOUND"].includes(error.code)) sendJson(response, 404, { error: "Not found" });
  else if (["NOT_EXECUTABLE", "ALREADY_STARTED"].includes(error.code)) sendJson(response, 409, { error: error.message });
  else if (["RUNTIME_UNAVAILABLE", "LAUNCH_FAILED"].includes(error.code)) sendJson(response, 503, { error: error.message });
  else throw error;
}

export async function handlePromptOnlyExecutionRoute({ request, response, pathname, executor, sendJson }) {
  const execute = pathname.match(EXECUTE_PATTERN);
  const status = pathname.match(STATUS_PATTERN);
  const listing = pathname === LIST_PATH;
  if (!execute && !status && !listing) return false;
  if (!executor) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (listing) {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else sendJson(response, 200, await executor.list());
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
    const { confirmation } = await readConfirmation(request);
    sendJson(response, 202, await executor.start(execute[1], { confirmation }));
  } catch (error) {
    if (error.code === "BAD_BODY") sendJson(response, 400, { error: error.message });
    else failure(response, sendJson, error);
  }
  return true;
}

export { BATCH_CONFIRMATION, CONFIRMATION };
