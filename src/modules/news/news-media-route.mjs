import { createReadStream } from "node:fs";

const ROUTE_PATTERN = /^\/api\/news\/([^/]+)\/media\/([^/]+)$/u;

export async function handleNewsMediaRoute({
  request,
  response,
  pathname,
  reader,
  sendJson,
}) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!reader) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  try {
    const media = await reader.findMedia(
      decodeURIComponent(match[1]),
      decodeURIComponent(match[2]),
    );
    if (!media) {
      sendJson(response, 404, { error: "뉴스 이미지를 찾을 수 없습니다." });
      return true;
    }
    response.writeHead(200, {
      "content-type": media.contentType,
      "content-length": media.size,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    });
    const stream = createReadStream(media.target);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
  } catch (error) {
    if (error instanceof URIError || error instanceof TypeError || error.code === "ENOENT") {
      sendJson(response, error.code === "ENOENT" ? 404 : 400, {
        error: error.code === "ENOENT" ? "뉴스 이미지를 찾을 수 없습니다." : "올바르지 않은 미디어 식별자입니다.",
      });
      return true;
    }
    throw error;
  }
  return true;
}
