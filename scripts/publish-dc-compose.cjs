const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const { textToHtml } = require("../src/modules/news/news-dc-html.cjs");

const MEDIA_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const HEAD_TEXTS = new Set(["잡담", "🛠 작업", "❓ 질문", "💡 정보", "뉴스/소식", "AI창작", "프롬프트", "🔞 후방", "🎄 대회", "공지"]);
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{20E3}]/gu;
const MARK_PATTERN = /\p{M}/gu;

function argumentValue(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function writeResult(target, value) {
  const temporary = `${path.resolve(target)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, path.resolve(target));
}
function fileHash(target) { return createHash("sha256").update(fs.readFileSync(target)).digest("hex"); }

function validateBlocks(blocks, mediaLength) {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 25) throw new Error("INVALID_BLOCKS");
  const used = new Set();
  for (const block of blocks) {
    if (block?.type === "text") {
      if (typeof block.text !== "string") throw new Error("INVALID_BLOCKS");
      continue;
    }
    if (block?.type !== "image" || !Number.isInteger(block.mediaIndex) || block.mediaIndex < 0 || block.mediaIndex >= mediaLength || used.has(block.mediaIndex)) throw new Error("INVALID_BLOCKS");
    used.add(block.mediaIndex);
  }
  if (used.size !== mediaLength) throw new Error("INVALID_BLOCKS");
  return blocks;
}

function composeInlineContent(job) {
  if (job.schemaVersion === 1) return { content: textToHtml(job.bodyText), imagePosition: "start" };
  const blocks = validateBlocks(job.blocks, job.media.length);
  return {
    content: blocks.map((block) => block.type === "text" ? textToHtml(block.text) : `{{DC_IMAGE_${block.mediaIndex + 1}}}`).join(""),
    imagePosition: "inline",
  };
}

function validateComposeJob(value, jobPath) {
  if (![1, 2].includes(value?.schemaVersion) || !/^[a-f0-9]{32}$/u.test(String(value.id ?? ""))) throw new Error("INVALID_JOB");
  if (value.galleryId !== "chatgpt" || !HEAD_TEXTS.has(value.headTextName)) throw new Error("INVALID_TARGET");
  if (!String(value.title ?? "").trim() || !String(value.bodyText ?? "").trim()) throw new Error("EMPTY_COPY");
  if ([...String(value.title)].length > 80 || String(value.bodyText).length > 20_000) throw new Error("COPY_TOO_LARGE");
  const combined = `${value.title}\n${value.bodyText}`;
  if ((combined.match(EMOJI_PATTERN) ?? []).length) throw new Error("UNSUPPORTED_EMOJI");
  if ((combined.match(MARK_PATTERN) ?? []).length) throw new Error("UNSUPPORTED_MARK");
  const jobRoot = path.dirname(path.resolve(jobPath));
  if (path.resolve(value.resultPath ?? "") !== path.join(jobRoot, "result.json")) throw new Error("INVALID_RESULT_PATH");
  if (!Array.isArray(value.media) || value.media.length > 10) throw new Error("INVALID_MEDIA");
  const mediaRoot = path.join(jobRoot, "media");
  for (const [index, media] of value.media.entries()) {
    const target = path.resolve(media.path ?? "");
    const expectedName = `${String(index + 1).padStart(2, "0")}${path.extname(target)}`;
    if (path.dirname(target) !== mediaRoot || path.basename(target) !== expectedName || media.filename !== expectedName || !MEDIA_TYPES.has(media.contentType)) throw new Error("INVALID_MEDIA");
    const info = fs.statSync(target);
    if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024 || fileHash(target) !== media.sha256) throw new Error("INVALID_MEDIA");
  }
  if (value.schemaVersion === 2) validateBlocks(value.blocks, value.media.length);
  const hashInput = { headText: value.headTextName, title: value.title, bodyText: value.bodyText };
  if (value.schemaVersion === 2) hashInput.blocks = value.blocks;
  hashInput.media = value.media.map(({ filename, sha256 }) => ({ filename, sha256 }));
  const expectedHash = createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");
  if (value.contentHash !== expectedHash) throw new Error("CONTENT_CHANGED");
  return value;
}

function safeDcUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:") return null;
    if (url.hostname === "gall.dcinside.com") return url.href;
    const match = url.hostname === "m.dcinside.com" ? url.pathname.match(/^\/board\/chatgpt\/(\d+)\/?$/u) : null;
    return match ? `https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=${match[1]}` : null;
  } catch { return null; }
}

async function withoutWatermark(FormDataCtor, action) {
  const original = FormDataCtor?.prototype?.append;
  if (typeof original !== "function") throw new Error("WATERMARK_GUARD_UNAVAILABLE");
  FormDataCtor.prototype.append = function append(name, ...values) {
    if (String(name) === "add_watermark") return undefined;
    return original.call(this, name, ...values);
  };
  try { return await action(); } finally { FormDataCtor.prototype.append = original; }
}

async function publish({ jobPath, publisherRoot }) {
  if (process.env.PUBLISH_DRY_RUN !== "false") throw new Error("DRY_RUN_ENABLED");
  const job = validateComposeJob(JSON.parse(fs.readFileSync(jobPath, "utf8")), jobPath);
  if (!path.isAbsolute(publisherRoot) || !fs.statSync(publisherRoot).isDirectory()) throw new Error("PUBLISHER_UNAVAILABLE");
  const requirePublisher = createRequire(path.join(publisherRoot, "package.json"));
  const dc = requirePublisher("@gurumnyang/dcinside.js");
  const FormDataCtor = requirePublisher("form-data");
  const heads = await dc.getGalleryHeadTexts({ galleryId: job.galleryId });
  const head = heads.find((entry) => String(entry.name ?? "") === job.headTextName);
  if (!head) throw new Error("HEAD_TEXT_UNAVAILABLE");
  const id = process.env.DC_ID?.trim();
  const password = process.env.DC_PW;
  if (!id || !password) throw new Error("CREDENTIALS_UNAVAILABLE");
  const userAgent = process.env.DC_USER_AGENT?.trim() || undefined;
  const login = await dc.mobileLogin({ code: id, password, keepLoggedIn: process.env.DC_KEEP_LOGGED_IN !== "false", userAgent });
  if (!login.success || !login.jar) throw new Error("LOGIN_FAILED");
  writeResult(job.resultPath, { status: "submitting", submittedAt: new Date().toISOString(), contentHash: job.contentHash });
  let result;
  try {
    const inline = composeInlineContent(job);
    result = await withoutWatermark(FormDataCtor, () => dc.createPost({
      galleryId: job.galleryId,
      subject: job.title,
      content: inline.content,
      images: job.media.map((media) => ({ data: fs.readFileSync(media.path), filename: media.filename, contentType: media.contentType })),
      imagePosition: inline.imagePosition,
      headText: String(head.id),
      useGallNickname: process.env.DC_USE_GALL_NICKNAME !== "false",
      jar: login.jar,
      userAgent,
    }));
  } catch {
    writeResult(job.resultPath, { status: "ambiguous-no-retry", submittedAt: new Date().toISOString(), contentHash: job.contentHash });
    return;
  }
  const postId = String(result.postId ?? "");
  const url = safeDcUrl(result.redirectUrl);
  const posted = Boolean(result.success && /^\d{4,}$/u.test(postId) && url);
  writeResult(job.resultPath, { status: posted ? "posted" : "ambiguous-no-retry", submittedAt: new Date().toISOString(), contentHash: job.contentHash, postId: posted ? postId : null, url: posted ? url : null });
}

async function main() {
  const jobInput = argumentValue("--job");
  const publisherInput = argumentValue("--publisher-root");
  if (!jobInput || !publisherInput) return void (process.exitCode = 1);
  const jobPath = path.resolve(jobInput);
  let resultPath = path.join(path.dirname(jobPath), "result.json");
  try {
    const raw = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    if (path.resolve(raw.resultPath ?? "") === resultPath) resultPath = raw.resultPath;
    await publish({ jobPath, publisherRoot: path.resolve(publisherInput) });
  } catch {
    writeResult(resultPath, { status: "failed-preflight", submittedAt: new Date().toISOString() });
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { validateComposeJob, composeInlineContent, safeDcUrl, withoutWatermark };
