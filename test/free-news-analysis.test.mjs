import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { invokeFreeNewsAnalysis } from "../src/modules/news/free-news-analysis.mjs";

test("무료 API runner에 제한된 번역·판정 JSON을 요청하고 실행 파일을 정리한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-analysis-"));
  const runnerPath = path.join(root, "runner.ps1");
  const runtimeRoot = path.join(root, "runtime");
  await writeFile(runnerPath, "test", "utf8");
  try {
    const result = await invokeFreeNewsAnalysis({
      id: "e".repeat(32),
      source: { type: "x-post", account: "thsottiaux" },
      original: { content: "Usage limits reset", embeds: [] },
    }, {
      runnerPath,
      runtimeRoot,
      async runProcess(command, args) {
        assert.match(command, /powershell\.exe$/i);
        const promptPath = args[args.indexOf("-PromptFile") + 1];
        const outputPath = args[args.indexOf("-Output") + 1];
        assert.match(await readFile(promptPath, "utf8"), /Usage limits reset/);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify({
          translation: { title: "코덱스 한도 초기화", body: "사용량 한도가 초기화됐습니다." },
          triage: { decision: "publish", confidence: 0.98, reason: "구체적인 서비스 변경", signals: ["usage-limit"] },
        }), "utf8");
      },
    });
    assert.equal(result.triage.decision, "publish");
    await assert.rejects(() => readFile(path.join(runtimeRoot, "e".repeat(32), "prompt.txt"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
