export async function handleCodexUsageRoute({ request, response, pathname, usage, sendJson }) {
  if (pathname !== "/api/system/codex/usage") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  const result = usage ? await usage.read() : { available: false };
  sendJson(response, 200, result);
  return true;
}

