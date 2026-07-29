import { createReadStream } from "node:fs";

const ROUTE_PATTERN = /^\/api\/images\/([^/]+)\/thumbnail$/;

export async function handleImageThumbnailRoute({
  request,
  response,
  pathname,
  thumbnails,
  sendJson,
}) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!thumbnails) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  try {
    const imageId = decodeURIComponent(match[1]);
    const thumbnail = await thumbnails.ensure(imageId);
    if (!thumbnail) {
      sendJson(response, 404, { error: "이미지를 찾을 수 없습니다." });
      return true;
    }

    response.writeHead(200, {
      "content-type": "image/webp",
      "content-length": thumbnail.size,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    const stream = createReadStream(thumbnail.target);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
  } catch (error) {
    if (error instanceof URIError || error instanceof TypeError) {
      sendJson(response, 400, { error: "올바르지 않은 이미지 식별자입니다." });
      return true;
    }
    throw error;
  }

  return true;
}
