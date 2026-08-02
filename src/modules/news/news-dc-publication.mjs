import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createPendingNewsStore } from "./news-item-store.mjs";
import { composeNewsDcCopy } from "./news-dc-copy.mjs";
import { isAllowedNewsDcHeadText } from "./news-dc-head-text.mjs";
import { createNewsDcCoverCatalog } from "./news-dc-covers.mjs";
import { evaluateNewsAutoPublish } from "./news-auto-publish-policy.mjs";
import { applyNewsEditorialShadow } from "./news-editorial-governor.mjs";
import { findNewsSourceProfile } from "./news-source-profiles.mjs";

const ID_PATTERN = /^[a-f0-9]{32}$/u;
const POSTED_STATUS = "posted";
const FINAL_STATUSES = new Set([POSTED_STATUS, "ambiguous-no-retry"]);

function publicationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateId(id) {
  if (!ID_PATTERN.test(String(id ?? ""))) {
    throw publicationError("INVALID_ID", "올바르지 않은 뉴스 ID입니다.");
  }
  return String(id);
}

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function safePublication(value) {
  if (!value || !["submitting", "posted", "failed-preflight", "ambiguous-no-retry"].includes(value.status)) {
    return null;
  }
  return {
    status: value.status,
    mode: value.mode === "automatic" ? "automatic" : "manual",
    submittedAt: String(value.submittedAt ?? ""),
    postId: value.status === "posted" ? String(value.postId ?? "") || null : null,
    url: value.status === "posted" && /^https:\/\/gall\.dcinside\.com\//u.test(String(value.url ?? ""))
      ? String(value.url)
      : null,
  };
}

function defaultRunPublisher({ publisherRoot, scriptPath, jobPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--env-file=${path.join(publisherRoot, ".env")}`,
        scriptPath,
        "--job",
        jobPath,
        "--publisher-root",
        publisherRoot,
      ],
      {
        cwd: publisherRoot,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    child.once("error", reject);
    child.once("close", (code) => resolve({ code }));
  });
}

export function createNewsDcPublicationService({
  root,
  sourceProfiles = new Map(),
  enabled = false,
  autoPublishEnabled = false,
  publisherRoot = "",
  galleryId = "chatgpt",
  coverRoot,
  publisherScriptPath,
  runPublisher = defaultRunPublisher,
  now = () => new Date(),
} = {}) {
  if (!path.isAbsolute(root ?? "") || !path.isAbsolute(publisherScriptPath ?? "") || !path.isAbsolute(coverRoot ?? "")) {
    throw new TypeError("뉴스 상태와 게시 스크립트는 절대경로여야 합니다.");
  }
  if (enabled && !path.isAbsolute(publisherRoot ?? "")) {
    throw new TypeError("DC 게시자 루트는 절대경로여야 합니다.");
  }
  if (galleryId !== "chatgpt") {
    throw new TypeError("뉴스 게시 대상은 chatgpt 갤러리만 허용합니다.");
  }

  const store = createPendingNewsStore({ root });
  const covers = createNewsDcCoverCatalog({ root: coverRoot });
  const jobRoot = path.join(root, "dc-publication-jobs");
  const autoStatePath = path.join(root, "auto-publication.json");
  const active = new Set();
  let autoActivation;

  async function initializeAutoPublishing() {
    if (!enabled || !autoPublishEnabled) return null;
    if (autoActivation) return autoActivation;
    try {
      const stored = JSON.parse(await readFile(autoStatePath, "utf8"));
      if (stored?.schemaVersion !== 1 || !Number.isFinite(Date.parse(stored.activatedAt))) {
        throw publicationError("AUTO_STATE_INVALID", "뉴스 자동 게시 시작 영수증이 올바르지 않습니다.");
      }
      autoActivation = Object.freeze({ schemaVersion: 1, activatedAt: stored.activatedAt });
      return autoActivation;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(root, { recursive: true });
    const value = { schemaVersion: 1, activatedAt: now().toISOString() };
    try {
      const handle = await open(autoStatePath, "wx");
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.close();
      autoActivation = Object.freeze(value);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stored = JSON.parse(await readFile(autoStatePath, "utf8"));
      if (stored?.schemaVersion !== 1 || !Number.isFinite(Date.parse(stored.activatedAt))) {
        throw publicationError("AUTO_STATE_INVALID", "뉴스 자동 게시 시작 영수증이 올바르지 않습니다.");
      }
      autoActivation = Object.freeze({ schemaVersion: 1, activatedAt: stored.activatedAt });
    }
    return autoActivation;
  }

  async function automaticDecisionFor(id) {
    const activation = await initializeAutoPublishing();
    if (!activation) return { decision: "disabled", code: "auto_publish_disabled" };
    const activationTime = Date.parse(activation.activatedAt);
    const records = await store.list({ limit: 100 });
    const candidates = records.map((record) => {
      const profile = findNewsSourceProfile(record.source, sourceProfiles);
      const processedAt = Date.parse(record.workflow?.processedAt ?? "");
      const publishedAt = Date.parse(record.source?.publishedAt ?? "");
      const beforeActivation =
        !Number.isFinite(processedAt) || processedAt < activationTime ||
        !Number.isFinite(publishedAt) || publishedAt < activationTime;
      const gate = beforeActivation
        ? { decision: "blocked", code: "before_activation", reason: "자동 게시 시작 전 항목이에요." }
        : evaluateNewsAutoPublish(record, profile);
      return {
        ...record,
        source: { ...record.source, profile },
        workflow: { ...record.workflow, autoPublishGate: gate },
      };
    });
    const target = applyNewsEditorialShadow(candidates).find((record) => record.id === id);
    if (!target) return { decision: "blocked", code: "not_found" };
    return {
      decision: target.workflow?.editorialShadow?.decision ?? "hold",
      code: target.workflow?.editorialShadow?.code ?? target.workflow?.autoPublishGate?.code ?? "quality_review",
      gate: target.workflow?.autoPublishGate,
      shadow: target.workflow?.editorialShadow,
    };
  }

  async function runtimeReady() {
    if (!enabled) return false;
    return (await Promise.all([
      isFile(path.join(publisherRoot, "package.json")),
      isFile(path.join(publisherRoot, ".env")),
      isFile(publisherScriptPath),
    ])).every(Boolean);
  }

  async function draftFor(id) {
    const safeId = validateId(id);
    const record = await store.read(safeId);
    const hasSourceMedia = Array.isArray(record.media) && record.media.length > 0;
    const draft = composeNewsDcCopy(record, { sourceProfiles, fallbackCover: !hasSourceMedia });
    const cover = draft.usesFallbackCover ? await covers.forHeadText(draft.headText) : null;
    if (draft.usesFallbackCover && !cover) {
      throw publicationError("COVER_MISSING", "선택된 말머리의 기본 커버를 찾을 수 없습니다.");
    }
    return { safeId, record, draft, cover };
  }

  async function preview(id) {
    try {
      const { safeId, record, draft, cover } = await draftFor(id);
      const publication = safePublication(record.workflow?.dcPublication);
      const approved = record.workflow?.dcApproval?.status === "approved";
      const ready = await runtimeReady();
      return {
        id: safeId,
        headText: draft.headText,
        title: draft.title,
        bodyText: draft.bodyText,
        imageCount: draft.imageCount,
        imagePlacement: draft.imagePlacement,
        fallbackCover: cover ? { used: true, id: cover.id, url: cover.url } : { used: false },
        preflight: draft.preflight,
        publisherReady: ready,
        approvalRequired: !approved,
        canPublish: ready && draft.preflight.ready && !FINAL_STATUSES.has(publication?.status),
        publication,
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        throw publicationError("NOT_FOUND", "뉴스 항목을 찾을 수 없습니다.");
      }
      throw error;
    }
  }

  async function publish(id, { automatic = false, automaticDecision = null } = {}) {
    const safeId = validateId(id);
    if (active.has(safeId)) {
      throw publicationError("ALREADY_SUBMITTING", "이미 DC 게시 요청을 처리하고 있습니다.");
    }
    active.add(safeId);
    let intentPath;
    try {
      if (!(await runtimeReady())) {
        throw publicationError("RUNTIME_UNAVAILABLE", "DC 게시 실행 환경을 사용할 수 없습니다.");
      }
      const { record, draft, cover } = await draftFor(safeId);
      if (!isAllowedNewsDcHeadText(draft.headText)) {
        throw publicationError("HEAD_TEXT_NOT_ALLOWED", "허용되지 않은 DC 말머리입니다.");
      }
      const profile = findNewsSourceProfile(record.source, sourceProfiles);
      const currentAutoGate = evaluateNewsAutoPublish(record, profile);
      if (automatic && (automaticDecision?.decision !== "ready" || currentAutoGate.decision !== "eligible")) {
        throw publicationError("AUTO_NOT_ELIGIBLE", "현재 자동 게시 품질 관문을 통과하지 못했습니다.");
      }
      if (!automatic && record.workflow?.dcApproval?.status !== "approved") {
        throw publicationError("APPROVAL_REQUIRED", "DC 게시 승인이 먼저 필요합니다.");
      }
      if (!draft.preflight.ready) {
        throw publicationError("PREFLIGHT_FAILED", "DC 원고 안전 검사를 통과하지 못했습니다.");
      }
      const currentPublication = safePublication(record.workflow?.dcPublication);
      if (FINAL_STATUSES.has(currentPublication?.status) || currentPublication?.status === "submitting") {
        throw publicationError("ALREADY_SUBMITTED", "이미 게시 요청 또는 최종 영수증이 있습니다.");
      }

      const mediaFiles = cover
        ? [{ target: cover.target, filename: cover.filename, contentType: cover.contentType }]
        : await store.mediaFiles(safeId);
      const mediaByName = new Map((record.media ?? []).map((entry) => [path.basename(entry.file), entry]));
      for (const media of mediaFiles) {
        if (!(await isFile(media.target))) {
          throw publicationError("MEDIA_MISSING", "게시할 뉴스 이미지 파일을 찾을 수 없습니다.");
        }
      }

      const targetRoot = path.join(jobRoot, safeId);
      const jobPath = path.join(targetRoot, "job.json");
      const resultPath = path.join(targetRoot, "result.json");
      intentPath = path.join(targetRoot, "submission.intent");
      await rm(targetRoot, { recursive: true, force: true });
      await mkdir(targetRoot, { recursive: true });
      const intent = await open(intentPath, "wx");
      await intent.writeFile(`${draft.contentHash}\n`, "utf8");
      await intent.close();

      await writeJsonAtomic(jobPath, {
        schemaVersion: 1,
        id: safeId,
        galleryId,
        headTextName: draft.headText,
        title: draft.title,
        bodyText: draft.bodyText,
        contentHash: draft.contentHash,
        resultPath,
        media: mediaFiles.map((media) => ({
          path: media.target,
          filename: media.filename,
          contentType: String(media.contentType ?? mediaByName.get(media.filename)?.contentType ?? ""),
        })),
      });

      const submittedAt = now().toISOString();
      await store.update(safeId, (current) => ({
        ...current,
        workflow: {
          ...current.workflow,
          dcPublication: {
            schemaVersion: 1,
            status: "submitting",
            mode: automatic ? "automatic" : "manual",
            submittedAt,
            contentHash: draft.contentHash,
          },
        },
      }));

      await runPublisher({ publisherRoot, scriptPath: publisherScriptPath, jobPath }).catch(() => {});
      let result;
      try {
        result = JSON.parse(await readFile(resultPath, "utf8"));
      } catch {
        result = { status: "ambiguous-no-retry" };
      }
      let status = ["posted", "failed-preflight", "ambiguous-no-retry"].includes(result.status)
        ? result.status
        : "ambiguous-no-retry";
      const resultUrl = String(result.url ?? "");
      const resultPostId = String(result.postId ?? "");
      if (
        status === "posted" &&
        (!/^\d{4,}$/u.test(resultPostId) || !/^https:\/\/gall\.dcinside\.com\//u.test(resultUrl))
      ) {
        status = "ambiguous-no-retry";
      }
      const publication = {
        schemaVersion: 1,
        status,
        mode: automatic ? "automatic" : "manual",
        submittedAt,
        contentHash: draft.contentHash,
        ...(status === "posted"
          ? { postId: resultPostId, url: resultUrl }
          : {}),
      };
      await store.update(safeId, (current) => ({
        ...current,
        workflow: {
          ...current.workflow,
          status: status === "posted" ? "published" : automatic ? "pending_review" : "approved_for_dc",
          dcPublication: publication,
        },
      }));
      if (status === "failed-preflight") {
        await rm(intentPath, { force: true });
      }
      return { id: safeId, publication: safePublication(publication) };
    } catch (error) {
      if (error.code === "ENOENT") {
        throw publicationError("NOT_FOUND", "뉴스 항목을 찾을 수 없습니다.");
      }
      throw error;
    } finally {
      active.delete(safeId);
    }
  }

  async function autoPublish(id) {
    const decision = await automaticDecisionFor(validateId(id));
    if (decision.decision !== "ready") {
      return { id, status: decision.decision, code: decision.code };
    }
    const result = await publish(id, { automatic: true, automaticDecision: decision });
    return { ...result, status: result.publication?.status ?? "ambiguous-no-retry" };
  }

  return Object.freeze({
    preview,
    publish,
    autoPublish,
    initializeAutoPublishing,
    findCover: covers.find,
  });
}
