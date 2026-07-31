const ROUTE = "/api/images/generation-drafts";
const MAX_BODY_BYTES = 64 * 1024;

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
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON 요청이 필요합니다."), { code: "INVALID_JSON" });
  }
}

export async function handleGenerationDraftRoute({ request, response, pathname, drafts, sendJson }) {
  if (pathname !== ROUTE) return false;
  if (!drafts) {
    sendJson(response, 404, { error: "Not found" });
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
    sendJson(response, 201, await drafts.create(body));
  } catch (error) {
    if (error.code === "BODY_TOO_LARGE") sendJson(response, 413, { error: error.message });
    else if (["INVALID_JSON", "INVALID_REQUEST", "INVALID_PROMPT", "INVALID_MODE", "INVALID_SOURCE", "INVALID_SELECTION"].includes(error.code)) {
      sendJson(response, 400, { error: error.message });
    } else throw error;
  }
  return true;
}
