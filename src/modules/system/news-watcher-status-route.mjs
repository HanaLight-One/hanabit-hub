export async function handleNewsWatcherStatusRoute({
  request,
  response,
  pathname,
  watcherStatus,
  sendJson,
}) {
  if (pathname !== "/api/system/news-watcher") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  sendJson(
    response,
    200,
    watcherStatus
      ? await watcherStatus.read()
      : { ready: false, state: "unavailable", lastSeenAt: null },
  );
  return true;
}
