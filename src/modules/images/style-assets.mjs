import { spawn } from "node:child_process";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_STYLE_BYTES = 512 * 1024;
const STYLE_FILENAME = /^\[화풍\] ([^\\/\u0000-\u001f\u007f]{1,80})\.txt$/u;

function styleError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeFilename(value) {
  const filename = String(value ?? "").normalize("NFC").trim();
  const match = filename.match(STYLE_FILENAME);
  if (!match || match[1].trim() !== match[1] || /^[. ]+$/u.test(match[1])) {
    throw styleError("INVALID_FILENAME", "[화풍] 이름.txt 형식의 파일만 사용할 수 있어요.");
  }
  return Object.freeze({ filename, id: match[1] });
}

function normalizeContent(value) {
  const content = String(value ?? "").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const bytes = Buffer.byteLength(content, "utf8");
  if (!content.trim()) throw styleError("EMPTY_STYLE", "비어 있는 화풍 파일은 업로드할 수 없어요.");
  if (bytes > MAX_STYLE_BYTES) throw styleError("STYLE_TOO_LARGE", "화풍 파일은 512KB 이하여야 해요.");
  if (content.includes("\0")) throw styleError("INVALID_STYLE", "화풍 파일 형식이 올바르지 않아요.");
  return content.endsWith("\n") ? content : `${content}\n`;
}

function run(command, args, { cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("화풍 색인 갱신 시간이 초과되었습니다."));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("화풍 색인을 갱신하지 못했습니다."));
    });
  });
}

export function createStyleAssetManager({
  stylesRoot,
  assetIndexPath,
  pipelineRoot,
  pythonExecutablePath,
  runProcess = run,
}) {
  for (const value of [stylesRoot, assetIndexPath, pipelineRoot, pythonExecutablePath]) {
    if (!path.isAbsolute(value ?? "")) throw new TypeError("화풍 관리 경로는 절대경로여야 합니다.");
  }
  const builderPath = path.join(pipelineRoot, "build_index.py");
  let mutationInProgress = false;

  async function indexedFilenames() {
    const info = await stat(assetIndexPath);
    if (!info.isFile() || info.size > MAX_INDEX_BYTES) throw new Error("화풍 색인을 안전하게 읽을 수 없습니다.");
    const index = JSON.parse(await readFile(assetIndexPath, "utf8"));
    const styles = Array.isArray(index.styles) ? index.styles : Object.values(index.styles ?? {});
    return new Set(styles.map((style) => String(style?.filename ?? "")));
  }

  async function list() {
    const indexed = await indexedFilenames();
    const entries = await readdir(stylesRoot, { withFileTypes: true });
    const styles = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      let normalized;
      try { normalized = normalizeFilename(entry.name); }
      catch { continue; }
      const info = await stat(path.join(stylesRoot, normalized.filename));
      if (!info.isFile() || info.size > MAX_STYLE_BYTES) continue;
      styles.push(Object.freeze({
        id: normalized.id,
        filename: normalized.filename,
        size: info.size,
        indexed: indexed.has(normalized.filename),
        downloadUrl: `/api/images/styles/${encodeURIComponent(normalized.id)}/download`,
      }));
    }
    styles.sort((left, right) => left.id.localeCompare(right.id, "ko"));
    return Object.freeze({
      count: styles.length,
      indexedCount: styles.filter((style) => style.indexed).length,
      styles: Object.freeze(styles),
    });
  }

  async function rebuild() {
    const [python, builder] = await Promise.all([stat(pythonExecutablePath), stat(builderPath)]);
    if (!python.isFile() || !builder.isFile()) throw new Error("고정된 화풍 색인 빌더를 사용할 수 없습니다.");
    await runProcess(pythonExecutablePath, [builderPath], { cwd: pipelineRoot });
    const result = await list();
    if (result.indexedCount !== result.count) throw new Error("일부 화풍이 색인에 반영되지 않았습니다.");
    return result;
  }

  async function withMutation(action) {
    if (mutationInProgress) throw styleError("MUTATION_IN_PROGRESS", "다른 화풍 작업을 처리 중이에요.");
    mutationInProgress = true;
    try { return await action(); }
    finally { mutationInProgress = false; }
  }

  async function reindex() {
    return withMutation(async () => ({ updated: true, ...(await rebuild()) }));
  }

  async function upload({ filename: filenameInput, content: contentInput } = {}) {
    return withMutation(async () => {
      const { filename, id } = normalizeFilename(filenameInput);
      const content = normalizeContent(contentInput);
      const target = path.join(stylesRoot, filename);
      try {
        await writeFile(target, content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (error.code === "EEXIST") throw styleError("STYLE_EXISTS", "같은 이름의 화풍이 이미 있어요.");
        throw error;
      }
      try {
        const result = await rebuild();
        return Object.freeze({ uploaded: true, id, filename, ...result });
      } catch (error) {
        await unlink(target).catch(() => {});
        throw error;
      }
    });
  }

  async function find(idInput) {
    const id = String(idInput ?? "").normalize("NFC");
    const normalized = normalizeFilename(`[화풍] ${id}.txt`);
    const catalog = await list();
    const style = catalog.styles.find((entry) => entry.id === normalized.id);
    if (!style) return null;
    return Object.freeze({ ...style, target: path.join(stylesRoot, style.filename) });
  }

  return Object.freeze({ list, upload, reindex, find });
}
