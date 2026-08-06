const ROUTE_PATTERN = /^\/api\/news\/([a-f0-9]{32})\/analysis-retry$/u;

async function confirmed(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return false;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 1_024) return false;
  }
  try {
    return JSON.parse(raw || "{}")?.confirmation === "retry-news-analysis";
  } catch {
    return false;
  }
}

export async function handleNewsAnalysisRetryRoute({ request, response, pathname, processor, sendJson }) {
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
  if (!(await confirmed(request))) {
    sendJson(response, 400, { error: "다시 분석 확인값이 필요합니다." });
    return true;
  }
  try {
    const queued = await processor.queueRetry(match[1]);
    void queued.completion.catch(() => {});
    sendJson(response, 202, { id: queued.record.id, status: queued.record.workflow.status });
  } catch (error) {
    sendJson(response, error.code === "NOT_RETRYABLE" ? 409 : 400, { error: error.message });
  }
  return true;
}
