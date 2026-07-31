const EXECUTE_PATTERN = /^\/api\/images\/generation-drafts\/([a-f0-9]{32})\/execute$/u;
const STATUS_PATTERN = /^\/api\/images\/generation-jobs\/([a-f0-9]{32})$/u;
const CONFIRMATION = "generate-one-prompt-only-image";

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
    if (!body || Object.keys(body).length !== 1 || body.confirmation !== CONFIRMATION) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error("1장 생성 확인이 필요합니다."), { code: "BAD_BODY" });
  }
}

function failure(response, sendJson, error) {
  if (["INVALID_ID", "DRAFT_NOT_FOUND", "JOB_NOT_FOUND"].includes(error.code)) sendJson(response, 404, { error: "Not found" });
  else if (["NOT_PROMPT_ONLY", "ALREADY_STARTED"].includes(error.code)) sendJson(response, 409, { error: error.message });
  else if (["RUNTIME_UNAVAILABLE", "LAUNCH_FAILED"].includes(error.code)) sendJson(response, 503, { error: error.message });
  else throw error;
}

export async function handlePromptOnlyExecutionRoute({ request, response, pathname, executor, sendJson }) {
  const execute = pathname.match(EXECUTE_PATTERN);
  const status = pathname.match(STATUS_PATTERN);
  if (!execute && !status) return false;
  if (!executor) {
    sendJson(response, 404, { error: "Not found" });
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
    await readConfirmation(request);
    sendJson(response, 202, await executor.start(execute[1]));
  } catch (error) {
    if (error.code === "BAD_BODY") sendJson(response, 400, { error: error.message });
    else failure(response, sendJson, error);
  }
  return true;
}

export { CONFIRMATION };
