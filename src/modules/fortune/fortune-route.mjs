export async function handleFortuneRoute({ request, response, url, archive, sendJson }) {
  if (url.pathname !== "/api/fortune") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!archive) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }
  try {
    const requestedDate = url.searchParams.get("date") || undefined;
    const [fortune, dates] = await Promise.all([archive.get(requestedDate), archive.dates()]);
    sendJson(response, 200, { ...fortune, dates });
  } catch (error) {
    if (error instanceof TypeError) {
      sendJson(response, 400, { error: "올바른 날짜가 필요합니다." });
    } else {
      throw error;
    }
  }
  return true;
}
