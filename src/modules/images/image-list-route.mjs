export async function handleImageListRoute({
  request,
  response,
  pathname,
  archive,
  sendJson,
}) {
  if (pathname !== "/api/images") return false;

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!archive) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  sendJson(response, 200, await archive.list());
  return true;
}
