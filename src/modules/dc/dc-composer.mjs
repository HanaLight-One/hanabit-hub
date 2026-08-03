import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ID_PATTERN = /^[a-f0-9]{32}$/u;
const IMAGE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const MEDIA_TYPES = new Map([
  ["image/gif", ".gif"], ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
]);
const HEAD_TEXTS = Object.freeze(["잡담", "🛠 작업", "❓ 질문", "💡 정보", "뉴스/소식", "AI창작", "프롬프트", "🔞 후방", "🎄 대회", "공지"]);
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{20E3}]/gu;
const MARK_PATTERN = /\p{M}/gu;
const FINAL_STATUSES = new Set(["posted", "ambiguous"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const MAX_IMAGES = 50;
const MAX_BLOCKS = 101;

function dcError(code, message) { return Object.assign(new Error(message), { code }); }
function safeId(value) {
  const id = String(value ?? "");
  if (!ID_PATTERN.test(id)) throw dcError("INVALID_ID", "올바르지 않은 DC 편집실 ID입니다.");
  return id;
}
function cleanFilename(value) {
  const name = path.basename(String(value ?? "")).replace(/[\u0000-\u001f<>:"/\\|?*]/gu, "_").trim();
  return name.slice(0, 120) || "upload";
}
async function isFile(target) {
  try { return (await stat(target)).isFile(); } catch { return false; }
}
async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}
function defaultRunPublisher({ publisherRoot, scriptPath, jobPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--env-file=${path.join(publisherRoot, ".env")}`,
      scriptPath,
      "--job", jobPath,
      "--publisher-root", publisherRoot,
    ], { cwd: publisherRoot, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code }));
  });
}

export function createDcComposer({
  database,
  archive,
  root,
  enabled = false,
  publisherRoot = "",
  publisherScriptPath,
  galleryId = "chatgpt",
  runPublisher = defaultRunPublisher,
  now = () => new Date(),
} = {}) {
  if (!database || !archive?.find) throw new TypeError("DC 편집실에는 DB와 이미지 아카이브가 필요합니다.");
  if (!path.isAbsolute(root ?? "") || !path.isAbsolute(publisherScriptPath ?? "")) throw new TypeError("DC 상태와 게시 스크립트는 절대경로여야 합니다.");
  if (enabled && !path.isAbsolute(publisherRoot ?? "")) throw new TypeError("DC 게시자 루트는 절대경로여야 합니다.");
  if (galleryId !== "chatgpt") throw new TypeError("DC 편집실은 chatgpt 갤러리만 허용합니다.");
  const uploadRoot = path.join(root, "uploads");
  const jobRoot = path.join(root, "publication-jobs");
  const active = new Set();

  function uploadRecord(row) {
    if (!row) return null;
    return Object.freeze({ id: row.id, name: row.original_name, contentType: row.content_type, size: row.size_bytes, createdAt: row.created_at, contentUrl: `/api/dc/uploads/${row.id}/content` });
  }

  function preflight({ headText, title, bodyText, images }) {
    const errors = [];
    if (!HEAD_TEXTS.includes(headText)) errors.push("허용된 말머리를 선택해 주세요.");
    if (!title.trim()) errors.push("제목을 입력해 주세요.");
    if ([...title].length > 80) errors.push("제목은 80자 이하여야 해요.");
    if (!bodyText.trim()) errors.push("본문을 입력해 주세요.");
    if (bodyText.length > 20_000) errors.push("본문은 20,000자 이하여야 해요.");
    const combined = `${title}\n${bodyText}`;
    if ((combined.match(EMOJI_PATTERN) ?? []).length) errors.push("DC에서 거부될 수 있는 그림 이모지를 제거해 주세요.");
    if ((combined.match(MARK_PATTERN) ?? []).length) errors.push("DC에서 사라질 수 있는 결합 문자가 있어요.");
    if (images.length > MAX_IMAGES) errors.push(`이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있어요.`);
    return Object.freeze({ ready: errors.length === 0, errors: Object.freeze(errors) });
  }

  async function runtimeReady() {
    if (!enabled) return false;
    return (await Promise.all([
      isFile(path.join(publisherRoot, "package.json")),
      isFile(path.join(publisherRoot, ".env")),
      isFile(publisherScriptPath),
    ])).every(Boolean);
  }

  async function status() {
    return { enabled, publisherReady: await runtimeReady(), headTexts: HEAD_TEXTS };
  }

  async function listUploads() {
    return database.prepare("SELECT * FROM dc_uploads ORDER BY created_at DESC").all().map(uploadRecord);
  }

  async function upload({ filename, contentType, buffer }) {
    if (!enabled) throw dcError("DISABLED", "DC 편집실 업로드가 허용되지 않았습니다.");
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw dcError("EMPTY_UPLOAD", "업로드할 이미지가 비어 있습니다.");
    if (buffer.length > MAX_UPLOAD_BYTES) throw dcError("UPLOAD_TOO_LARGE", "이미지는 한 장당 20MB 이하여야 합니다.");
    const extension = MEDIA_TYPES.get(String(contentType ?? "").toLowerCase());
    if (!extension) throw dcError("INVALID_MEDIA", "PNG, JPG, WEBP, GIF 이미지만 업로드할 수 있습니다.");
    let metadata;
    try { metadata = await sharp(buffer, { animated: true }).metadata(); } catch { throw dcError("INVALID_MEDIA", "올바른 이미지 파일이 아닙니다."); }
    const detected = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
    if (detected !== String(contentType).toLowerCase()) throw dcError("INVALID_MEDIA", "파일 내용과 이미지 형식이 일치하지 않습니다.");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const duplicate = database.prepare("SELECT * FROM dc_uploads WHERE sha256 = ? AND size_bytes = ?").get(sha256, buffer.length);
    if (duplicate) return uploadRecord(duplicate);
    const id = crypto.randomUUID().replaceAll("-", "");
    const storageName = `${id}${extension}`;
    await mkdir(uploadRoot, { recursive: true });
    const temporary = path.join(uploadRoot, `${storageName}.${process.pid}.tmp`);
    const target = path.join(uploadRoot, storageName);
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, target);
    const createdAt = now().toISOString();
    try {
      database.prepare("INSERT INTO dc_uploads (id, original_name, storage_name, content_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, cleanFilename(filename), storageName, detected, buffer.length, sha256, createdAt);
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    return uploadRecord(database.prepare("SELECT * FROM dc_uploads WHERE id = ?").get(id));
  }

  async function uploadContent(idInput) {
    const id = safeId(idInput);
    const row = database.prepare("SELECT * FROM dc_uploads WHERE id = ?").get(id);
    if (!row) return null;
    const target = path.join(uploadRoot, row.storage_name);
    if (path.dirname(target) !== uploadRoot || !(await isFile(target))) return null;
    return { target, contentType: row.content_type, size: row.size_bytes };
  }

  async function deleteUpload(idInput) {
    if (!enabled) throw dcError("DISABLED", "DC 편집실 업로드가 허용되지 않았습니다.");
    const id = safeId(idInput);
    const used = database.prepare("SELECT 1 AS used FROM dc_draft_images WHERE source_type = 'upload' AND source_id = ? LIMIT 1").get(id);
    if (used) throw dcError("UPLOAD_IN_USE", "초안에서 사용 중인 이미지는 먼저 선택 해제해 주세요.");
    const row = database.prepare("SELECT * FROM dc_uploads WHERE id = ?").get(id);
    if (!row) throw dcError("NOT_FOUND", "업로드 이미지를 찾을 수 없습니다.");
    await rm(path.join(uploadRoot, row.storage_name), { force: true });
    database.prepare("DELETE FROM dc_uploads WHERE id = ?").run(id);
    return { deleted: true };
  }

  async function normalizedImages(values) {
    if (!Array.isArray(values) || values.length > MAX_IMAGES) throw dcError("INVALID_IMAGES", `이미지는 최대 ${MAX_IMAGES}장까지 선택할 수 있습니다.`);
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const sourceType = value?.sourceType;
      const sourceId = String(value?.sourceId ?? "");
      const key = `${sourceType}:${sourceId}`;
      if (seen.has(key)) continue;
      if (sourceType === "archive") {
        if (!IMAGE_ID_PATTERN.test(sourceId) || !(await archive.find(sourceId))) throw dcError("IMAGE_NOT_FOUND", "선택한 허브 이미지를 찾을 수 없습니다.");
      } else if (sourceType === "upload") {
        if (!ID_PATTERN.test(sourceId) || !database.prepare("SELECT 1 AS found FROM dc_uploads WHERE id = ?").get(sourceId)) throw dcError("IMAGE_NOT_FOUND", "선택한 업로드 이미지를 찾을 수 없습니다.");
      } else throw dcError("INVALID_IMAGES", "올바르지 않은 이미지 출처입니다.");
      seen.add(key);
      result.push({ sourceType, sourceId });
    }
    return result;
  }

  async function normalizedLayout(input = {}) {
    if (!Array.isArray(input.blocks)) {
      const images = await normalizedImages(input.images ?? []);
      return [
        ...images.map((image) => ({ type: "image", ...image })),
        { type: "text", text: String(input.bodyText ?? "") },
      ];
    }
    if (input.blocks.length === 0 || input.blocks.length > MAX_BLOCKS) {
      throw dcError("INVALID_BLOCKS", `본문 블록은 1개 이상 ${MAX_BLOCKS}개 이하로 구성해 주세요.`);
    }
    const imageInputs = input.blocks
      .filter((block) => block?.type === "image")
      .map(({ sourceType, sourceId }) => ({ sourceType, sourceId }));
    const images = await normalizedImages(imageInputs);
    if (images.length !== imageInputs.length) throw dcError("INVALID_BLOCKS", "같은 이미지는 원고에 한 번만 넣을 수 있어요.");
    let imageIndex = 0;
    let textLength = 0;
    const blocks = input.blocks.map((block) => {
      if (block?.type === "image") return { type: "image", ...images[imageIndex++] };
      if (block?.type !== "text") throw dcError("INVALID_BLOCKS", "텍스트 또는 이미지 블록만 사용할 수 있어요.");
      const text = String(block.text ?? "");
      textLength += text.length;
      return { type: "text", text };
    });
    if (textLength > MAX_TEXT_LENGTH) throw dcError("INVALID_BLOCKS", "본문은 20,000자 이하로 작성해 주세요.");
    return blocks;
  }

  async function saveDraft(input = {}) {
    if (!enabled) throw dcError("DISABLED", "DC 편집실 저장이 허용되지 않았습니다.");
    const id = input.id ? safeId(input.id) : crypto.randomUUID().replaceAll("-", "");
    const current = database.prepare("SELECT * FROM dc_drafts WHERE id = ?").get(id);
    if (FINAL_STATUSES.has(current?.status)) throw dcError("FINAL_DRAFT", "이미 게시 요청이 끝난 초안은 수정할 수 없습니다.");
    const headText = String(input.headText ?? "잡담");
    const title = String(input.title ?? "").trim();
    const blocks = await normalizedLayout(input);
    const bodyText = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n\n").trim();
    const images = blocks.filter((block) => block.type === "image").map(({ sourceType, sourceId }) => ({ sourceType, sourceId }));
    const checked = preflight({ headText, title, bodyText, images });
    const timestamp = now().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`INSERT INTO dc_drafts (id, gallery_id, head_text, title, body_text, layout_json, status, created_at, updated_at)
        VALUES (?, 'chatgpt', ?, ?, ?, ?, 'draft', ?, ?)
        ON CONFLICT(id) DO UPDATE SET head_text=excluded.head_text, title=excluded.title, body_text=excluded.body_text, layout_json=excluded.layout_json, status='draft', content_hash=NULL, updated_at=excluded.updated_at`)
        .run(id, headText, title, bodyText, JSON.stringify(blocks), current?.created_at ?? timestamp, timestamp);
      database.prepare("DELETE FROM dc_draft_images WHERE draft_id = ?").run(id);
      const insert = database.prepare("INSERT INTO dc_draft_images (draft_id, position, source_type, source_id) VALUES (?, ?, ?, ?)");
      images.forEach((image, position) => insert.run(id, position, image.sourceType, image.sourceId));
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return { ...(await getDraft(id)), preflight: checked };
  }

  async function imagePublic(sourceType, sourceId) {
    if (sourceType === "archive") {
      const image = await archive.find(sourceId);
      return image ? { sourceType, sourceId, name: image.record.name, contentUrl: image.record.thumbnailUrl } : null;
    }
    const row = database.prepare("SELECT * FROM dc_uploads WHERE id = ?").get(sourceId);
    return row ? { sourceType, sourceId, name: row.original_name, contentUrl: `/api/dc/uploads/${row.id}/content` } : null;
  }

  async function getDraft(idInput) {
    const id = safeId(idInput);
    const row = database.prepare("SELECT * FROM dc_drafts WHERE id = ?").get(id);
    if (!row) throw dcError("NOT_FOUND", "DC 초안을 찾을 수 없습니다.");
    const refs = database.prepare("SELECT source_type, source_id FROM dc_draft_images WHERE draft_id = ? ORDER BY position").all(id);
    const images = (await Promise.all(refs.map((item) => imagePublic(item.source_type, item.source_id)))).filter(Boolean);
    const imageMap = new Map(images.map((image) => [`${image.sourceType}:${image.sourceId}`, image]));
    let storedBlocks;
    try { storedBlocks = row.layout_json ? JSON.parse(row.layout_json) : null; } catch { storedBlocks = null; }
    const layout = Array.isArray(storedBlocks) ? storedBlocks : [
      ...refs.map((item) => ({ type: "image", sourceType: item.source_type, sourceId: item.source_id })),
      { type: "text", text: row.body_text },
    ];
    const blocks = layout.map((block) => block?.type === "text"
      ? { type: "text", text: String(block.text ?? "") }
      : { type: "image", ...imageMap.get(`${block?.sourceType}:${block?.sourceId}`) }).filter((block) => block.type === "text" || block.sourceId);
    return Object.freeze({ id, galleryId: row.gallery_id, headText: row.head_text, title: row.title, bodyText: row.body_text, blocks: Object.freeze(blocks), status: row.status, images: Object.freeze(images), createdAt: row.created_at, updatedAt: row.updated_at, publication: row.status === "posted" || row.status === "ambiguous" ? { status: row.status, submittedAt: row.submitted_at, postId: row.post_id, url: row.post_url } : null });
  }

  async function latestDraft() {
    const row = database.prepare("SELECT id FROM dc_drafts WHERE status IN ('draft', 'failed') ORDER BY updated_at DESC LIMIT 1").get();
    return row ? getDraft(row.id) : null;
  }

  async function preview(idInput) {
    const draft = await getDraft(idInput);
    const checked = preflight(draft);
    return { draft, preflight: checked, publisherReady: await runtimeReady(), canPublish: checked.ready && await runtimeReady() && !FINAL_STATUSES.has(draft.status) };
  }

  async function mediaSource(reference) {
    if (reference.sourceType === "archive") {
      const image = await archive.find(reference.sourceId);
      if (!image) throw dcError("IMAGE_NOT_FOUND", "게시할 허브 이미지를 찾을 수 없습니다.");
      return { target: image.target, extension: image.extension };
    }
    const row = database.prepare("SELECT * FROM dc_uploads WHERE id = ?").get(reference.sourceId);
    if (!row) throw dcError("IMAGE_NOT_FOUND", "게시할 업로드 이미지를 찾을 수 없습니다.");
    return { target: path.join(uploadRoot, row.storage_name), extension: path.extname(row.storage_name) };
  }

  async function publish(idInput) {
    const id = safeId(idInput);
    if (active.has(id)) throw dcError("ALREADY_SUBMITTING", "이미 게시 요청을 처리하고 있습니다.");
    active.add(id);
    try {
      const ready = await preview(id);
      if (!ready.publisherReady) throw dcError("RUNTIME_UNAVAILABLE", "DC 게시 실행 환경을 사용할 수 없습니다.");
      if (!ready.preflight.ready) throw dcError("PREFLIGHT_FAILED", "DC 원고 안전 검사를 통과하지 못했습니다.");
      if (FINAL_STATUSES.has(ready.draft.status) || ready.draft.status === "submitting") throw dcError("ALREADY_SUBMITTED", "이미 게시 요청 또는 최종 영수증이 있습니다.");
      const refs = database.prepare("SELECT source_type AS sourceType, source_id AS sourceId FROM dc_draft_images WHERE draft_id = ? ORDER BY position").all(id);
      const targetRoot = path.join(jobRoot, id);
      const mediaRoot = path.join(targetRoot, "media");
      await rm(targetRoot, { recursive: true, force: true });
      await mkdir(mediaRoot, { recursive: true });
      const media = [];
      for (const [index, reference] of refs.entries()) {
        const source = await mediaSource(reference);
        if (!(await isFile(source.target))) throw dcError("IMAGE_NOT_FOUND", "게시할 이미지 파일을 찾을 수 없습니다.");
        const filename = `${String(index + 1).padStart(2, "0")}${source.extension}`;
        const target = path.join(mediaRoot, filename);
        await copyFile(source.target, target);
        const buffer = await readFile(target);
        const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        const contentType = source.extension === ".jpg" || source.extension === ".jpeg" ? "image/jpeg" : `image/${source.extension.slice(1)}`;
        media.push({ path: target, filename, contentType, sha256 });
      }
      const mediaIndex = new Map(refs.map((reference, index) => [`${reference.sourceType}:${reference.sourceId}`, index]));
      const blocks = ready.draft.blocks.map((block) => block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "image", mediaIndex: mediaIndex.get(`${block.sourceType}:${block.sourceId}`) });
      const contentHash = crypto.createHash("sha256").update(JSON.stringify({ headText: ready.draft.headText, title: ready.draft.title, bodyText: ready.draft.bodyText, blocks, media: media.map(({ filename, sha256 }) => ({ filename, sha256 })) })).digest("hex");
      const jobPath = path.join(targetRoot, "job.json");
      const resultPath = path.join(targetRoot, "result.json");
      await writeJsonAtomic(jobPath, { schemaVersion: 2, id, galleryId, headTextName: ready.draft.headText, title: ready.draft.title, bodyText: ready.draft.bodyText, blocks, media, contentHash, resultPath });
      const submittedAt = now().toISOString();
      database.prepare("UPDATE dc_drafts SET status='submitting', content_hash=?, submitted_at=?, updated_at=? WHERE id=?").run(contentHash, submittedAt, submittedAt, id);
      await runPublisher({ publisherRoot, scriptPath: publisherScriptPath, jobPath }).catch(() => {});
      let result;
      try { result = JSON.parse(await readFile(resultPath, "utf8")); } catch { result = { status: "ambiguous-no-retry" }; }
      const status = result.status === "posted" ? "posted" : result.status === "failed-preflight" ? "failed" : "ambiguous";
      const postId = status === "posted" && /^\d{4,}$/u.test(String(result.postId ?? "")) ? String(result.postId) : null;
      const postUrl = status === "posted" && /^https:\/\/gall\.dcinside\.com\//u.test(String(result.url ?? "")) ? String(result.url) : null;
      const finalStatus = status === "posted" && postId && postUrl ? "posted" : status === "failed" ? "failed" : "ambiguous";
      database.prepare("UPDATE dc_drafts SET status=?, post_id=?, post_url=?, updated_at=? WHERE id=?").run(finalStatus, finalStatus === "posted" ? postId : null, finalStatus === "posted" ? postUrl : null, now().toISOString(), id);
      return getDraft(id);
    } finally { active.delete(id); }
  }

  return Object.freeze({ headTexts: HEAD_TEXTS, status, listUploads, upload, uploadContent, deleteUpload, saveDraft, getDraft, latestDraft, preview, publish, runtimeReady });
}
