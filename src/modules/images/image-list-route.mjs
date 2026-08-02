export async function handleImageListRoute({
  request,
  response,
  pathname,
  archive,
  store = null,
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

  const payload = await archive.list();
  if (!store?.availableImageIds) {
    sendJson(response, 200, payload);
    return true;
  }
  const available = new Set(store.availableImageIds());
  sendJson(response, 200, {
    ...payload,
    images: payload.images.map((image) => ({
      ...image,
      hasProductionRecord: available.has(image.id),
    })),
  });
  return true;
}
