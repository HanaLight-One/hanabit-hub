import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DELETE_STATUSES = new Set(["deleted", "failed-preflight", "ambiguous-no-retry"]);
const DELETE_REASONS = new Set([
  "CONFIRMED",
  "CAPTCHA_REQUIRED",
  "CSRF_TOKEN_MISSING",
  "DELETE_KEY_MISSING",
  "DELETE_NOT_CONFIRMED",
  "DELETE_REQUEST_UNCERTAIN",
  "POST_STILL_VISIBLE",
  "PUBLIC_ABSENCE_CONFIRMED",
]);

function publicDeleteResult(value, postId) {
  if (!DELETE_STATUSES.has(value?.status)) return { status: "ambiguous-no-retry", postId };
  const reason = DELETE_REASONS.has(value?.reason) ? value.reason : null;
  return { status: value.status, postId, ...(reason ? { reason } : {}) };
}

function defaultRunDelete({ publisherRoot, scriptPath, jobPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--env-file=${path.join(publisherRoot, ".env")}`,
      scriptPath,
      "--job",
      jobPath,
      "--publisher-root",
      publisherRoot,
    ], { cwd: publisherRoot, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code }));
  });
}

export function createOpenAIStatusPostReplacer({
  root,
  publisherRoot,
  deleteScriptPath,
  runDelete = defaultRunDelete,
  now = () => new Date(),
} = {}) {
  if (!path.isAbsolute(root ?? "") || !path.isAbsolute(publisherRoot ?? "") || !path.isAbsolute(deleteScriptPath ?? "")) {
    throw new TypeError("상태 글 교체 경로는 절대경로여야 합니다.");
  }
  const jobsRoot = path.join(root, "openai-status-delete-jobs");

  async function replace(previousPost, { humanAuthorization = null } = {}) {
    if (
      !["automatic", "adopted-replaceable"].includes(previousPost?.ownership) ||
      !/^\d{4,}$/u.test(String(previousPost?.postId ?? ""))
    ) {
      return { status: "protected", postId: String(previousPost?.postId ?? "") };
    }
    const postId = String(previousPost.postId);
    if (humanAuthorization !== null && !/^[a-f0-9]{12}$/u.test(humanAuthorization)) {
      throw new TypeError("사람이 승인한 상태 글 삭제 식별자가 올바르지 않습니다.");
    }
    const jobRoot = path.join(
      jobsRoot,
      humanAuthorization ? `${postId}-human-${humanAuthorization}` : postId,
    );
    const jobPath = path.join(jobRoot, "job.json");
    const resultPath = path.join(jobRoot, "result.json");
    const intentPath = path.join(jobRoot, "deletion.intent");
    await mkdir(jobRoot, { recursive: true });
    try {
      const existing = JSON.parse(await readFile(resultPath, "utf8"));
      if (DELETE_STATUSES.has(existing?.status)) return publicDeleteResult(existing, postId);
    } catch {}
    try {
      const intent = await open(intentPath, "wx");
      await intent.writeFile(`${now().toISOString()}\n`, "utf8");
      await intent.close();
    } catch (error) {
      if (error.code === "EEXIST") return { status: "ambiguous-no-retry", postId };
      throw error;
    }
    await writeFile(jobPath, `${JSON.stringify({
      schemaVersion: 1,
      galleryId: "chatgpt",
      postId,
      resultPath,
    }, null, 2)}\n`, "utf8");
    await runDelete({ publisherRoot, scriptPath: deleteScriptPath, jobPath }).catch(() => {});
    try {
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      return publicDeleteResult(result, postId);
    } catch {
      return { status: "ambiguous-no-retry", postId };
    }
  }

  return Object.freeze({ replace });
}
