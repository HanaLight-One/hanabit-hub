import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { invokeFreeNewsAnalysis } from "../src/modules/news/free-news-analysis.mjs";

test("무료 API runner에 제한된 번역·판정 JSON을 요청하고 실행 파일을 정리한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-analysis-"));
  const runnerPath = path.join(root, "runner.ps1");
  const pythonExecutablePath = path.join(root, "python.exe");
  const keyStorePath = path.join(root, "openai-api-key.dpapi");
  const runtimeRoot = path.join(root, "runtime");
  await writeFile(runnerPath, "test", "utf8");
  try {
    const result = await invokeFreeNewsAnalysis({
      id: "e".repeat(32),
      source: { type: "x-post", account: "thsottiaux" },
      original: {
        content: "One more day",
        embeds: [],
        contexts: [{ relation: "linked-post", account: "OpenAIDevs", content: "A new model is available today." }],
      },
    }, {
      runnerPath,
      runtimeRoot,
      pythonExecutablePath,
      keyStorePath,
      async runProcess(command, args) {
        assert.match(command, /powershell\.exe$/i);
        const promptPath = args[args.indexOf("-PromptFile") + 1];
        const outputPath = args[args.indexOf("-Output") + 1];
        const schemaPath = args[args.indexOf("-JsonSchemaFile") + 1];
        assert.equal(args[args.indexOf("-PythonExecutablePath") + 1], pythonExecutablePath);
        assert.equal(args[args.indexOf("-KeyStorePath") + 1], keyStorePath);
        const prompt = await readFile(promptPath, "utf8");
        const schema = JSON.parse(await readFile(schemaPath, "utf8"));
        assert.match(prompt, /One more day/);
        assert.match(prompt, /CONTEXT 1 RELATION: linked-post/);
        assert.match(prompt, /A new model is available today/);
        assert.match(prompt, /translation object must contain only SOURCE TEXT/);
        assert.match(prompt, /Do not compress SOURCE into a headline/);
        assert.match(prompt, /Translate empower or empowering as enabling the person/);
        assert.match(prompt, /Do not omit CONTEXT translations/);
        assert.match(prompt, /credible insider explicitly saying they used a named capability is usually inference/);
        assert.match(prompt, /newsworthiness separately from certainty/);
        assert.equal(schema.type, "object");
        assert.deepEqual(schema.required, ["translation", "contextTranslations", "triage"]);
        assert.equal(schema.additionalProperties, false);
        assert.equal(schema.properties.contextTranslations.minItems, 1);
        assert.equal(schema.properties.contextTranslations.maxItems, 1);
        assert.equal(schema.properties.contextTranslations.items.additionalProperties, false);
        assert.equal(schema.properties.triage.additionalProperties, false);
        assert.deepEqual(schema.properties.triage.properties.decision.enum, ["skip", "review", "publish"]);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify({
          translation: { title: "코덱스 한도 초기화", body: "사용량 한도가 초기화됐습니다." },
          contextTranslations: [{ index: 1, body: "오늘 새 모델을 사용할 수 있습니다. https://example.com/context" }],
          triage: { decision: "publish", confidence: 0.98, importance: "high", evidenceTag: "confirmed", reason: "구체적인 서비스 변경", advice: "게시 가치가 높습니다.", signals: ["usage-limit"] },
        }), "utf8");
      },
    });
    assert.equal(result.triage.decision, "publish");
    assert.equal(result.triage.importance, "high");
    assert.equal(result.triage.evidenceTag, "confirmed");
    assert.equal(result.contextTranslations[0].body, "오늘 새 모델을 사용할 수 있습니다.");
    await assert.rejects(() => readFile(path.join(runtimeRoot, "e".repeat(32), "prompt.txt"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empowering의 자립 의미와 링크 소개 구조가 빠진 번역은 다시 요청한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-fidelity-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "test", "utf8");
  let attempts = 0;
  try {
    const result = await invokeFreeNewsAnalysis({
      id: "6".repeat(32),
      source: { type: "x-post", account: "gdb" },
      original: {
        content: "chatgpt for empowering your dad to build: https://t.co/example",
        contexts: [],
      },
    }, {
      runnerPath,
      runtimeRoot: path.join(root, "runtime"),
      async wait() {},
      async runProcess(command, args) {
        attempts += 1;
        const outputPath = args[args.indexOf("-Output") + 1];
        const body = attempts === 1
          ? "ChatGPT로 아빠가 무언가를 만들도록 돕기"
          : "아빠가 직접 무언가를 만들 수 있도록 지원하는 ChatGPT.";
        await writeFile(outputPath, JSON.stringify({
          translation: { title: "아빠의 만들기를 돕는 ChatGPT", body },
          contextTranslations: [],
          triage: {
            decision: "publish",
            confidence: 0.9,
            importance: "medium",
            evidenceTag: "confirmed",
            reason: "구체적인 활용 사례",
            advice: "사례로 소개",
            signals: ["use-case"],
          },
        }), "utf8");
      },
    });
    assert.equal(attempts, 2);
    assert.equal(result.translation.body, "아빠가 직접 무언가를 만들 수 있도록 지원하는 ChatGPT:");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("URL만 남긴 짧은 원문 번역 본문은 원문 전용 제목 번역으로 복구한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-url-only-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "test", "utf8");
  try {
    const result = await invokeFreeNewsAnalysis({
      id: "4".repeat(32),
      source: { type: "x-post", account: "gdb" },
      original: { content: "Ask ChatGPT Work to do any recurring task https://example.com/post", contexts: [] },
    }, {
      runnerPath,
      runtimeRoot: path.join(root, "runtime"),
      async wait() {},
      async runProcess(command, args) {
        const outputPath = args[args.indexOf("-Output") + 1];
        await writeFile(outputPath, JSON.stringify({
          translation: { title: "반복 작업", body: "https://example.com/post" },
          contextTranslations: [],
          triage: { decision: "publish", confidence: 0.9, importance: "high", evidenceTag: "inference", reason: "반복 작업", advice: "유추로 게시", signals: [] },
        }), "utf8");
      },
    });
    assert.equal(result.translation.body, "반복 작업");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("무료 API 일시 실패는 최대 두 번 다시 시도하고 성공 결과를 사용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-analysis-retry-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "test", "utf8");
  let attempts = 0;
  try {
    const result = await invokeFreeNewsAnalysis({
      id: "2".repeat(32),
      source: { type: "x-post", account: "thsottiaux" },
      original: { content: "Usage limits reset", embeds: [] },
    }, {
      runnerPath,
      runtimeRoot: path.join(root, "runtime"),
      async wait() {},
      async runProcess(command, args) {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary failure");
        const outputPath = args[args.indexOf("-Output") + 1];
        await writeFile(outputPath, JSON.stringify({
          translation: { title: "초기화", body: "사용량이 초기화됐습니다." },
          contextTranslations: [],
          triage: { decision: "publish", confidence: 0.9, importance: "medium", evidenceTag: "inference", reason: "구체적인 변경", advice: "[유추]로 게시하세요.", signals: [] },
        }), "utf8");
      },
    });
    assert.equal(attempts, 3);
    assert.equal(result.triage.decision, "publish");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("관련 글이 있으면 작성자별 번역을 빠뜨린 응답을 거부한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-context-translation-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "test", "utf8");
  try {
    await assert.rejects(() => invokeFreeNewsAnalysis({
      id: "3".repeat(32),
      source: { type: "x-post", account: "gdb" },
      original: {
        content: "Ask ChatGPT Work to do any recurring task.",
        contexts: [{ relation: "linked-post", account: "brttbmn", content: "ChatGPT Work is the new cron job." }],
      },
    }, {
      runnerPath,
      runtimeRoot: path.join(root, "runtime"),
      async wait() {},
      async runProcess(command, args) {
        const outputPath = args[args.indexOf("-Output") + 1];
        await writeFile(outputPath, JSON.stringify({
          translation: { title: "반복 작업", body: "ChatGPT Work에 반복 작업을 맡겨보세요." },
          contextTranslations: [],
          triage: { decision: "publish", confidence: 0.9, importance: "high", evidenceTag: "inference", reason: "반복 작업", advice: "유추로 게시", signals: [] },
        }), "utf8");
      },
    }), /관련 글 번역 개수/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("통합 응답이 관련 글 번역을 빠뜨리면 작은 별도 요청으로 보충한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-context-fallback-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "test", "utf8");
  try {
    const result = await invokeFreeNewsAnalysis({
      id: "5".repeat(32),
      source: { type: "x-post", account: "gdb" },
      original: {
        content: "Ask ChatGPT Work to do any recurring task.",
        contexts: [{ relation: "linked-post", account: "brttbmn", content: "ChatGPT Work is the new cron job." }],
      },
    }, {
      runnerPath,
      runtimeRoot: path.join(root, "runtime"),
      async wait() {},
      async runProcess(command, args) {
        const outputPath = args[args.indexOf("-Output") + 1];
        const schemaPath = args[args.indexOf("-JsonSchemaFile") + 1];
        const schema = JSON.parse(await readFile(schemaPath, "utf8"));
        if (outputPath.includes("context-output-")) {
          assert.deepEqual(schema.required, ["contextTranslations"]);
          assert.equal(schema.properties.contextTranslations.minItems, 1);
          assert.equal(schema.properties.contextTranslations.maxItems, 1);
        } else {
          assert.deepEqual(schema.required, ["translation", "contextTranslations", "triage"]);
        }
        const value = outputPath.includes("context-output-")
          ? { contextTranslations: { "1": "ChatGPT Work는 새로운 크론 작업입니다." } }
          : {
              translation: { title: "반복 작업", body: "ChatGPT Work에 반복 작업을 맡겨보세요." },
              contextTranslations: [],
              triage: { decision: "publish", confidence: 0.9, importance: "high", evidenceTag: "inference", reason: "반복 작업", advice: "유추로 게시", signals: [] },
            };
        await writeFile(outputPath, JSON.stringify(value), "utf8");
      },
    });
    assert.equal(result.contextTranslations[0].body, "ChatGPT Work는 새로운 크론 작업입니다.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
