import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStyleAssetManager } from "../src/modules/images/style-assets.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-styles-"));
  const stylesRoot = path.join(root, "styles");
  const pipelineRoot = path.join(root, "pipeline");
  const assetIndexPath = path.join(pipelineRoot, "state", "asset-index.json");
  const pythonExecutablePath = path.join(root, "python.exe");
  await Promise.all([
    mkdir(stylesRoot, { recursive: true }),
    mkdir(path.dirname(assetIndexPath), { recursive: true }),
    writeFile(pythonExecutablePath, "test", "utf8"),
    mkdir(pipelineRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(pipelineRoot, "build_index.py"), "test", "utf8"),
    writeFile(path.join(stylesRoot, "[화풍] 고딕.txt"), "gothic\n", "utf8"),
    writeFile(assetIndexPath, JSON.stringify({ styles: [{ id: "고딕", filename: "[화풍] 고딕.txt" }] }), "utf8"),
  ]);
  async function runProcess(command, args) {
    assert.equal(command, pythonExecutablePath);
    assert.deepEqual(args, [path.join(pipelineRoot, "build_index.py")]);
    const files = (await import("node:fs/promises")).readdir(stylesRoot);
    const styles = (await files).filter((name) => name.startsWith("[화풍] ")).map((filename) => ({
      id: filename.slice(5, -4), filename,
    }));
    await writeFile(assetIndexPath, JSON.stringify({ styles }), "utf8");
  }
  return {
    root,
    stylesRoot,
    assetIndexPath,
    manager: createStyleAssetManager({ stylesRoot, assetIndexPath, pipelineRoot, pythonExecutablePath, runProcess }),
  };
}

test("화풍 목록은 안전한 TXT와 색인 상태만 반환한다", async () => {
  const { root, stylesRoot, manager } = await fixture();
  try {
    await writeFile(path.join(stylesRoot, "메모.txt"), "hidden", "utf8");
    const result = await manager.list();
    assert.equal(result.count, 1);
    assert.deepEqual(result.styles.map(({ id, indexed }) => ({ id, indexed })), [{ id: "고딕", indexed: true }]);
    assert.equal(JSON.stringify(result).includes(stylesRoot), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("새 화풍 업로드는 덮어쓰지 않고 기존 Python 빌더로 즉시 색인한다", async () => {
  const { root, stylesRoot, manager } = await fixture();
  try {
    const result = await manager.upload({ filename: "[화풍] 빈티지화집.txt", content: "vintage" });
    assert.equal(result.count, 2);
    assert.equal(result.indexedCount, 2);
    assert.equal(await readFile(path.join(stylesRoot, "[화풍] 빈티지화집.txt"), "utf8"), "vintage\n");
    await assert.rejects(() => manager.upload({ filename: "[화풍] 빈티지화집.txt", content: "replace" }), /이미/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("잘못된 이름과 경로 이탈 화풍은 거부한다", async () => {
  const { root, manager } = await fixture();
  try {
    await assert.rejects(() => manager.upload({ filename: "../escape.txt", content: "bad" }), /형식/);
    await assert.rejects(() => manager.find("../고딕"), /형식/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
