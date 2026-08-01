const ROUTE_PATTERN = /^\/api\/news\/([a-f0-9]{32})\/dc-approval$/u;

async function readConfirmation(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
    return null;
  }

  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 1_024) return null;
  }

  try {
    const value = JSON.parse(raw || "{}");
    return value?.confirmation === "approve-dc-publication" ? value.confirmation : null;
  } catch {
    return null;
  }
}

export async function handleNewsApprovalRoute({
  request,
  response,
  pathname,
  approvalService,
  sendJson,
}) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!approvalService) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }
  if ((await readConfirmation(request)) === null) {
    sendJson(response, 400, { error: "승인 확인값이 필요합니다." });
    return true;
  }

  try {
    sendJson(response, 200, await approvalService.approveForDc(match[1]));
  } catch (error) {
    const status = error.code === "NOT_FOUND" ? 404 :
      ["NOT_REVIEWABLE", "ALREADY_PUBLISHED"].includes(error.code) ? 409 : 400;
    sendJson(response, status, { error: error.message });
  }
  return true;
}
