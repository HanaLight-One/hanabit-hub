const STATUS = "/api/notifications/status";
const SUBSCRIPTIONS = "/api/notifications/subscriptions";
const TEST = "/api/notifications/test";

function isSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  return Boolean(origin && host && request.headers["sec-fetch-site"] === "same-origin" && new URL(origin).host === host);
}

async function readJson(request) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) return null;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > 8_192) return null;
  }
  try { return JSON.parse(raw || "{}"); } catch { return null; }
}

export async function handlePushNotificationRoute({ request, response, pathname, service, sendJson }) {
  if (![STATUS, SUBSCRIPTIONS, TEST].includes(pathname)) return false;
  if (!service) { sendJson(response, 404, { error: "Not found" }); return true; }
  if (pathname === STATUS) {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" });
    else sendJson(response, 200, await service.status());
    return true;
  }
  if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
  if (!isSameOrigin(request)) { sendJson(response, 403, { error: "Forbidden" }); return true; }
  const body = await readJson(request);
  if (!body) { sendJson(response, 400, { error: "올바른 JSON 요청이 필요합니다." }); return true; }
  try {
    if (pathname === TEST) {
      if (body.confirmation !== "send-missed-you-notification") throw new TypeError("테스트 알림 확인값이 필요합니다.");
      sendJson(response, 200, await service.publish("test.missed-you"));
    } else if (body.action === "subscribe") {
      sendJson(response, 200, await service.subscribe(body.subscription));
    } else if (body.action === "unsubscribe") {
      sendJson(response, 200, await service.unsubscribe(body.endpoint));
    } else {
      sendJson(response, 400, { error: "알림 구독 작업을 확인해 주세요." });
    }
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
  return true;
}
