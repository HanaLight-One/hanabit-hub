export async function handleNewsListRoute({ request, response, pathname, reader, sendJson }) {
  if (pathname !== "/api/news") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }
  if (!reader) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }
  sendJson(response, 200, await reader.list());
  return true;
}
