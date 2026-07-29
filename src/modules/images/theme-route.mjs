const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function handleThemeRoute({
  request,
  response,
  url,
  service,
  sendJson,
}) {
  if (url.pathname !== "/api/themes") return false;

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!service) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const date = url.searchParams.get("date");
  if (date !== null && !isValidDate(date)) {
    sendJson(response, 400, { error: "date must be a valid YYYY-MM-DD value" });
    return true;
  }

  const result = await service.get(date ?? undefined);
  sendJson(response, 200, {
    date: result.date,
    available: Boolean(result.theme),
    theme: result.theme,
  });
  return true;
}
