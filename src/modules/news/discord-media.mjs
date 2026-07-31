import { writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const DISCORD_IMAGE_PROXY_PATTERN = /^images-ext-\d+\.discordapp\.net$/u;
const EXTENSIONS = new Map([
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function validateDiscordUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (!ALLOWED_HOSTS.has(url.hostname) && !DISCORD_IMAGE_PROXY_PATTERN.test(url.hostname))
  ) {
    throw new Error("허용된 Discord 이미지 주소가 아닙니다.");
  }
  return url;
}

function safeStem(value) {
  const stem = path.basename(String(value ?? "image"), path.extname(String(value ?? "")))
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return stem || "image";
}

async function readLimitedBody(response) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_FILE_BYTES) throw new Error("Discord 이미지가 허용 크기를 넘었습니다.");

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) throw new Error("Discord 이미지가 허용 크기를 넘었습니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function downloadDiscordMedia(
  candidates,
  { destination, fetchImpl = fetch } = {},
) {
  const records = [];
  let totalBytes = 0;

  for (const [index, candidate] of candidates.entries()) {
    validateDiscordUrl(candidate.url);
    const response = await fetchImpl(candidate.url, { redirect: "follow" });
    if (!response.ok) throw new Error("Discord 이미지를 내려받지 못했습니다.");
    validateDiscordUrl(response.url || candidate.url);

    const contentType = String(
      response.headers.get("content-type") || candidate.contentType || "",
    ).split(";", 1)[0].toLowerCase();
    const extension = EXTENSIONS.get(contentType);
    if (!extension) throw new Error("지원하지 않는 Discord 이미지 형식입니다.");

    const body = await readLimitedBody(response);
    totalBytes += body.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("공지 이미지 총용량이 허용치를 넘었습니다.");

    const filename = `${String(index + 1).padStart(2, "0")}-${safeStem(candidate.name)}${extension}`;
    await writeFile(path.join(destination, filename), body);
    records.push({
      kind: candidate.kind,
      file: `media/${filename}`,
      contentType,
      size: body.length,
    });
  }

  return records;
}
