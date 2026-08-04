import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenAIStatusPostReplacer } from "../src/modules/news/openai-status-post-replacer.mjs";

test("수동 글은 삭제하지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-replace-"));
  let calls = 0;
  const replacer = createOpenAIStatusPostReplacer({
    root,
    publisherRoot: root,
    deleteScriptPath: path.join(root, "delete.cjs"),
    runDelete: async () => { calls += 1; },
  });
  assert.equal((await replacer.replace({ postId: "120497", ownership: "manual" })).status, "protected");
  assert.equal(calls, 0);
});

test("자동 글 삭제는 같은 번호에 한 번만 요청한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-replace-"));
  let calls = 0;
  const replacer = createOpenAIStatusPostReplacer({
    root,
    publisherRoot: root,
    deleteScriptPath: path.join(root, "delete.cjs"),
    runDelete: async ({ jobPath }) => {
      calls += 1;
      const job = JSON.parse(await readFile(jobPath, "utf8"));
      await writeFile(job.resultPath, JSON.stringify({ status: "deleted", postId: job.postId }), "utf8");
    },
  });
  const previous = { postId: "120600", ownership: "automatic" };
  assert.equal((await replacer.replace(previous)).status, "deleted");
  assert.equal((await replacer.replace(previous)).status, "deleted");
  assert.equal(calls, 1);
});
