import { createReadStream } from "node:fs";

const ROUTE_PATTERN = /^\/api\/news\/dc-covers\/([a-z-]+)$/u;

export async function handleNewsDcCoverRoute({
  request,
  response,
  pathname,
  publicationService,
  sendJson,
}) {
  const match = pathname.match(ROUTE_PATTERN);
  if (!match) return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!publicationService) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  try {
    const cover = await publicationService.findCover(match[1]);
    if (!cover) {
      sendJson(response, 404, { error: "뉴스 기본 커버를 찾을 수 없습니다." });
      return true;
    }
    response.writeHead(200, {
      "content-type": cover.contentType,
      "content-length": cover.size,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    });
    const stream = createReadStream(cover.target);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof TypeError) {
      sendJson(response, error.code === "ENOENT" ? 404 : 400, {
        error: error.code === "ENOENT" ? "뉴스 기본 커버를 찾을 수 없습니다." : error.message,
      });
      return true;
    }
    throw error;
  }
  return true;
}
