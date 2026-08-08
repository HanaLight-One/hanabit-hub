const SETTINGS_PATH = "/api/images/prompt-oracle/settings";
const REROLL_PATH = "/api/images/prompt-oracle/reroll";
const POSE_SUGGEST_PATH = "/api/images/pose-advisor/suggest";
const MAX_BODY_BYTES = 32 * 1024;

function isSameOriginRequest(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || request.headers["sec-fetch-site"] !== "same-origin") return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("요청이 너무 커요."), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("JSON 요청이 필요해요."), { code: "INVALID_JSON" }); }
}

export async function handlePromptOracleRoute({ request, response, pathname, oracle, sendJson }) {
  if (![SETTINGS_PATH, REROLL_PATH, POSE_SUGGEST_PATH].includes(pathname)) return false;
  if (!oracle) { sendJson(response, 404, { error: "Not found" }); return true; }

  if (pathname === SETTINGS_PATH && request.method === "GET") {
    sendJson(response, 200, await oracle.readSettings());
    return true;
  }
  if (!isSameOriginRequest(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    sendJson(response, 415, { error: "JSON request required" }); return true;
  }
  if (pathname === SETTINGS_PATH && request.method === "PUT") {
    if (request.headers["x-prompt-oracle-confirmation"] !== "update-prompt-oracle-settings") {
      sendJson(response, 403, { error: "Confirmation required" }); return true;
    }
    try { sendJson(response, 200, await oracle.updateSettings(await readJsonBody(request))); }
    catch (error) {
      const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
      sendJson(response, status, { error: error.message });
    }
    return true;
  }
  if (pathname === REROLL_PATH && request.method === "POST") {
    try { sendJson(response, 200, await oracle.reroll(await readJsonBody(request))); }
    catch (error) {
      const status = error.code === "BUSY" ? 409 : ["INVALID_SETTINGS", "INVALID_PRESET", "NO_INGREDIENTS", "INVALID_JSON"].includes(error.code) ? 400 : 503;
      sendJson(response, status, { error: error.message });
    }
    return true;
  }
  if (pathname === POSE_SUGGEST_PATH && request.method === "POST") {
    try { sendJson(response, 200, await oracle.suggestPose(await readJsonBody(request))); }
    catch (error) {
      const status = error.code === "BUSY" ? 409 : ["INVALID_POSE_REQUEST", "INVALID_JSON"].includes(error.code) ? 400 : 503;
      sendJson(response, status, { error: error.message });
    }
    return true;
  }
  sendJson(response, 405, { error: "Method not allowed" });
  return true;
}
