const ROUTE_PATTERN = /^\/api\/images\/([^/]+)$/;

export async function handleImageDetailRoute({
  request,
  response,
  pathname,
  archive,
  sendJson,
}) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!archive) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  try {
    const imageId = decodeURIComponent(match[1]);
    const image = await archive.find(imageId);
    if (!image) {
      sendJson(response, 404, { error: "이미지를 찾을 수 없습니다." });
      return true;
    }
    sendJson(response, 200, { image: image.record });
  } catch (error) {
    if (error instanceof URIError || error instanceof TypeError) {
      sendJson(response, 400, { error: "올바르지 않은 이미지 식별자입니다." });
      return true;
    }
    throw error;
  }

  return true;
}
