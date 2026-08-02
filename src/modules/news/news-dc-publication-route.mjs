const PREVIEW_ROUTE = /^\/api\/news\/([a-f0-9]{32})\/dc-preview$/u;
const PUBLICATION_ROUTE = /^\/api\/news\/([a-f0-9]{32})\/dc-publication$/u;
const CONFIRMATION = "publish-news-to-dc-now";

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

async function readConfirmation(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return null;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 1_024) return null;
  }
  try {
    return JSON.parse(raw || "{}")?.confirmation === CONFIRMATION ? CONFIRMATION : null;
  } catch {
    return null;
  }
}

function statusFor(error) {
  if (error.code === "NOT_FOUND") return 404;
  if (["APPROVAL_REQUIRED", "ALREADY_SUBMITTED", "ALREADY_SUBMITTING"].includes(error.code)) return 409;
  if (error.code === "RUNTIME_UNAVAILABLE") return 503;
  return 400;
}

export async function handleNewsDcPublicationRoute({
  request,
  response,
  pathname,
  publicationService,
  sendJson,
}) {
  const previewMatch = pathname.match(PREVIEW_ROUTE);
  if (previewMatch) {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!publicationService) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    try {
      sendJson(response, 200, await publicationService.preview(previewMatch[1]));
    } catch (error) {
      sendJson(response, statusFor(error), { error: error.message });
    }
    return true;
  }

  const publicationMatch = pathname.match(PUBLICATION_ROUTE);
  if (!publicationMatch) return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!publicationService) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }
  if (!isSameOriginRequest(request)) {
    sendJson(response, 403, { error: "같은 출처 요청만 허용합니다." });
    return true;
  }
  if ((await readConfirmation(request)) === null) {
    sendJson(response, 400, { error: "실제 게시 확인값이 필요합니다." });
    return true;
  }

  try {
    sendJson(response, 200, await publicationService.publish(publicationMatch[1]));
  } catch (error) {
    sendJson(response, statusFor(error), { error: error.message });
  }
  return true;
}
