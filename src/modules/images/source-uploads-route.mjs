const ROUTE = "/api/images/source-uploads";
const MAX_BYTES = 20 * 1024 * 1024;

function sameOrigin(request) {
  try {
    return request.headers["sec-fetch-site"] === "same-origin"
      && new URL(request.headers.origin).host === request.headers.host;
  } catch { return false; }
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error("업로드 파일이 20MB를 넘었어요."), { code: "TOO_LARGE" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function handleSourceUploadsRoute({ request, response, pathname, manager, sendJson }) {
  if (pathname !== ROUTE) return false;
  if (!manager) { sendJson(response, 404, { error: "Not found" }); return true; }
  if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
  if (!sameOrigin(request)) { sendJson(response, 403, { error: "Same-origin request required" }); return true; }
  if (request.headers["x-source-upload-confirmation"] !== "upload-generation-source") {
    sendJson(response, 400, { error: "소스 업로드 확인값이 필요해요." }); return true;
  }
  let originalName;
  try { originalName = decodeURIComponent(request.headers["x-source-file-name"] ?? "image"); }
  catch { sendJson(response, 400, { error: "파일 이름 인코딩이 올바르지 않아요." }); return true; }
  try {
    sendJson(response, 201, await manager.upload({ buffer: await readBody(request), originalName }));
  } catch (error) {
    if (["INVALID_UPLOAD", "TOO_LARGE"].includes(error.code)) sendJson(response, 413, { error: error.message });
    else if (["DISABLED", "INDEX_FAILED"].includes(error.code)) sendJson(response, 409, { error: error.message });
    else throw error;
  }
  return true;
}
