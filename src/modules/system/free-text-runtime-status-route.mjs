export async function handleFreeTextRuntimeStatusRoute({
  request,
  response,
  pathname,
  runtimeStatus,
  sendJson,
}) {
  if (pathname !== "/api/system/free-text-runtime") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const result = runtimeStatus
    ? await runtimeStatus.read()
    : {
        ready: false,
        mode: "external-or-unconfigured",
        components: {
          runner: { ready: false, tracked: false },
          python: { ready: false },
          keyStore: { ready: false },
        },
      };
  sendJson(response, 200, result);
  return true;
}
