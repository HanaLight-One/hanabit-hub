const ROUTE_PATTERN = /^\/api\/images\/([^/]+)\/production-record$/;

export async function handleProductionRecordRoute({
  request,
  response,
  pathname,
  store,
  sendJson,
}) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!store) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  let imageId;
  try {
    imageId = decodeURIComponent(match[1]);
    const record = await store.get(imageId);
    if (!record) {
      sendJson(response, 404, { error: "제작 기록을 찾을 수 없습니다." });
      return true;
    }
    sendJson(response, 200, { record });
  } catch (error) {
    if (error instanceof URIError || error instanceof TypeError) {
      sendJson(response, 400, { error: "올바르지 않은 이미지 식별자입니다." });
      return true;
    }
    throw error;
  }

  return true;
}
