export async function handleCreationOptionsRoute({
  request,
  response,
  pathname,
  catalog,
  sendJson,
}) {
  if (pathname !== "/api/images/creation-options") return false;

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!catalog) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  sendJson(response, 200, await catalog.list());
  return true;
}
