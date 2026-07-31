const ROUTE_PATTERN = /^\/api\/fortune\/text\/(\d{4}-\d{2}-\d{2})$/u;

export async function handleFortuneTextRoute({ request, response, pathname, archive, sendJson }) {
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
    const result = await archive.text(match[1]);
    if (!result) {
      sendJson(response, 404, { error: "운세 본문을 찾을 수 없습니다." });
      return true;
    }
    const body = Buffer.from(result.text, "utf8");
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": body.length,
      "content-disposition": `attachment; filename="fortune-${result.date}.txt"`,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    if (error instanceof TypeError) {
      sendJson(response, 400, { error: "올바른 날짜가 필요합니다." });
    } else {
      throw error;
    }
  }
  return true;
}
