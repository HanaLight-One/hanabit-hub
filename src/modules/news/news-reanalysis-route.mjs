const ROUTE_PATTERN = /^\/api\/news\/([a-f0-9]{32})\/reanalysis$/u;

function isSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host || request.headers["sec-fetch-site"] !== "same-origin") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function confirmed(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return false;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 1_024) return false;
  }
  try {
    return JSON.parse(raw || "{}")?.confirmation === "reclassify-news-item";
  } catch {
    return false;
  }
}

export async function handleNewsReanalysisRoute({ request, response, pathname, processor, sendJson }) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!processor) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: "Same-origin request required" });
    return true;
  }
  if (!(await confirmed(request))) {
    sendJson(response, 400, { error: "새 정책 재판정 확인값이 필요합니다." });
    return true;
  }
  try {
    const result = await processor.reprocess(match[1]);
    sendJson(response, 200, { id: result.id, status: result.workflow.status });
  } catch (error) {
    sendJson(response, error.code === "NOT_REPROCESSABLE" ? 409 : 400, { error: error.message });
  }
  return true;
}
