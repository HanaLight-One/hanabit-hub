const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{20E3}]/gu;
const COMBINING_MARK_PATTERN = /\p{M}/gu;
const MEDIA_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_HEAD_TEXTS = new Set(["뉴스/소식", "💡 정보", "잡담", "AI창작"]);
const COVER_FOR_HEAD_TEXT = new Map([
  ["뉴스/소식", "news.png"],
  ["💡 정보", "information.png"],
  ["잡담", "chatter.png"],
  ["AI창작", "ai-creation.png"],
]);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeResult(target, value) {
  const resolved = path.resolve(target);
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, resolved);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value) {
  return String(value).split("\n")
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>")
    .join("");
}

function validateJob(value, jobPath) {
  if (value?.schemaVersion !== 1 || !/^[a-f0-9]{32}$/u.test(String(value.id ?? ""))) {
    throw new Error("INVALID_JOB");
  }
  if (value.galleryId !== "chatgpt" || !ALLOWED_HEAD_TEXTS.has(value.headTextName)) {
    throw new Error("INVALID_TARGET");
  }
  if (!String(value.title ?? "").trim() || !String(value.bodyText ?? "").trim()) {
    throw new Error("EMPTY_COPY");
  }
  if ([...String(value.title)].length > 80 || String(value.bodyText).length > 20_000) {
    throw new Error("COPY_TOO_LARGE");
  }
  if (!/^[a-f0-9]{64}$/u.test(String(value.contentHash ?? ""))) throw new Error("INVALID_HASH");
  const combined = `${value.title}\n${value.bodyText}`;
  if ((combined.match(EMOJI_PATTERN) ?? []).length) throw new Error("UNSUPPORTED_EMOJI");
  if ((combined.match(COMBINING_MARK_PATTERN) ?? []).length) throw new Error("UNSUPPORTED_MARK");
  const expectedResult = path.join(path.dirname(jobPath), "result.json");
  if (path.resolve(value.resultPath ?? "") !== expectedResult) throw new Error("INVALID_RESULT_PATH");
  if (!Array.isArray(value.media) || value.media.length > 10) throw new Error("INVALID_MEDIA");
  const expectedHash = createHash("sha256")
    .update(`${value.title}\0${value.bodyText}\0${value.media.length}`, "utf8")
    .digest("hex");
  if (value.contentHash !== expectedHash) throw new Error("CONTENT_CHANGED");
  const newsRoot = path.dirname(path.dirname(path.dirname(jobPath)));
  const mediaRoot = path.resolve(newsRoot, "pending", value.id, "media");
  const coverRoot = path.resolve(path.dirname(path.dirname(newsRoot)), "assets", "news", "dc-covers");
  for (const media of value.media) {
    const mediaPath = path.resolve(media.path ?? "");
    const sourceMedia = mediaPath.startsWith(`${mediaRoot}${path.sep}`);
    const coverMedia = path.dirname(mediaPath) === coverRoot &&
      COVER_FOR_HEAD_TEXT.get(value.headTextName) === path.basename(mediaPath) &&
      path.basename(mediaPath) === String(media.filename ?? "");
    if (!path.isAbsolute(media.path ?? "") ||
        (!sourceMedia && !coverMedia) ||
        !/^[a-zA-Z0-9_-]+\.(gif|jpe?g|png|webp)$/u.test(String(media.filename ?? "")) ||
        !MEDIA_TYPES.has(media.contentType)) {
      throw new Error("INVALID_MEDIA");
    }
    const info = fs.statSync(mediaPath);
    if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024) {
      throw new Error("INVALID_MEDIA");
    }
  }
  return value;
}

function safeDcUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && url.hostname === "gall.dcinside.com"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function publishNews({ jobPath, publisherRoot }) {
  if (process.env.PUBLISH_DRY_RUN !== "false") throw new Error("DRY_RUN_ENABLED");
  const job = validateJob(JSON.parse(fs.readFileSync(jobPath, "utf8")), jobPath);
  if (!path.isAbsolute(publisherRoot) || !fs.statSync(publisherRoot).isDirectory()) {
    throw new Error("PUBLISHER_UNAVAILABLE");
  }
  const publisherRequire = createRequire(path.join(publisherRoot, "package.json"));
  const dc = publisherRequire("@gurumnyang/dcinside.js");
  const headTexts = await dc.getGalleryHeadTexts({ galleryId: job.galleryId });
  const headText = headTexts.find((entry) => String(entry.name ?? "") === job.headTextName);
  if (!headText) throw new Error("HEAD_TEXT_UNAVAILABLE");

  const id = process.env.DC_ID?.trim();
  const password = process.env.DC_PW;
  const userAgent = process.env.DC_USER_AGENT?.trim() || undefined;
  if (!id || !password) throw new Error("CREDENTIALS_UNAVAILABLE");
  const login = await dc.mobileLogin({
    code: id,
    password,
    keepLoggedIn: process.env.DC_KEEP_LOGGED_IN !== "false",
    userAgent,
  });
  if (!login.success || !login.jar) throw new Error("LOGIN_FAILED");

  writeResult(job.resultPath, {
    status: "submitting",
    submittedAt: new Date().toISOString(),
    contentHash: job.contentHash,
  });
  let result;
  try {
    result = await dc.createPost({
      galleryId: job.galleryId,
      subject: job.title,
      content: textToHtml(job.bodyText),
      images: job.media.map((media) => ({
        data: fs.readFileSync(media.path),
        filename: media.filename,
        contentType: media.contentType,
      })),
      imagePosition: "start",
      headText: String(headText.id),
      useGallNickname: process.env.DC_USE_GALL_NICKNAME !== "false",
      jar: login.jar,
      userAgent,
    });
  } catch {
    writeResult(job.resultPath, {
      status: "ambiguous-no-retry",
      submittedAt: new Date().toISOString(),
      contentHash: job.contentHash,
    });
    return;
  }

  const postId = String(result.postId ?? "");
  const url = safeDcUrl(result.redirectUrl);
  const posted = Boolean(result.success && /^\d{4,}$/u.test(postId) && url);
  writeResult(job.resultPath, {
    status: posted ? "posted" : "ambiguous-no-retry",
    submittedAt: new Date().toISOString(),
    contentHash: job.contentHash,
    postId: posted ? postId : null,
    url: posted ? url : null,
  });
}

async function main() {
  const jobInput = argumentValue("--job");
  const publisherRootInput = argumentValue("--publisher-root");
  if (!jobInput || !publisherRootInput) {
    process.exitCode = 1;
    return;
  }
  const jobPath = path.resolve(jobInput);
  const publisherRoot = path.resolve(publisherRootInput);
  let resultPath = path.join(path.dirname(jobPath), "result.json");
  try {
    const raw = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    if (path.resolve(raw.resultPath ?? "") === resultPath) resultPath = raw.resultPath;
    await publishNews({ jobPath, publisherRoot });
  } catch {
    writeResult(resultPath, {
      status: "failed-preflight",
      submittedAt: new Date().toISOString(),
    });
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateJob, safeDcUrl };
