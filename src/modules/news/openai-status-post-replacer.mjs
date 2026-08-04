import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

  async function replace(previousPost) {
    if (previousPost?.ownership !== "automatic" || !/^\d{4,}$/u.test(String(previousPost?.postId ?? ""))) {
      return { status: "protected", postId: String(previousPost?.postId ?? "") };
    }
    const postId = String(previousPost.postId);
    const jobRoot = path.join(jobsRoot, postId);
    const jobPath = path.join(jobRoot, "job.json");
    const resultPath = path.join(jobRoot, "result.json");
    const intentPath = path.join(jobRoot, "deletion.intent");
    await mkdir(jobRoot, { recursive: true });
    try {
      const existing = JSON.parse(await readFile(resultPath, "utf8"));
      if (["deleted", "ambiguous-no-retry", "failed-preflight"].includes(existing?.status)) return existing;
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
      return ["deleted", "failed-preflight", "ambiguous-no-retry"].includes(result?.status)
        ? { status: result.status, postId }
        : { status: "ambiguous-no-retry", postId };
    } catch {
      return { status: "ambiguous-no-retry", postId };
    }
  }

  return Object.freeze({ replace });
}

