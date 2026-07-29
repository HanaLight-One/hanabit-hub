import { createReadStream } from "node:fs";

const ROUTE_PATTERN = /^\/api\/images\/([^/]+)\/download$/;

function contentDisposition(filename) {
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replaceAll('"', "'")
    .replaceAll("\\", "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function handleImageDownloadRoute({
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

    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": image.record.size,
      "content-disposition": contentDisposition(image.record.name),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    const stream = createReadStream(image.target);
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

export { contentDisposition };
