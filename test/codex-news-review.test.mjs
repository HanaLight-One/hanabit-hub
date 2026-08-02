import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCodexNewsReviewer,
  invokeCodexNewsReview,
  shouldEscalateToCodex,
} from "../src/modules/news/codex-news-review.mjs";

function record(id = "a".repeat(32)) {
  return {
    id,
    source: { type: "x-post", account: "thsottiaux" },
    original: {
      content: "Codex",
      contexts: [{ relation: "replied-to", account: "RyanEls4", content: "Developing your App is the easy part" }],
    },
    media: [{ file: "media/01-image.png" }],
  };
}

function free(decision = "skip", confidence = 0.97, evidenceTag = "inference") {
  return {
    translation: { title: "Codex", body: "Codex" },
    triage: { decision, confidence, importance: "low", evidenceTag, reason: "단어 하나", advice: "보류", signals: [] },
  };
}

test("애매한 X 글만 Codex 심층검토 대상으로 승격한다", () => {
  assert.equal(shouldEscalateToCodex(record(), free("skip", 0.97)), true);
  assert.equal(shouldEscalateToCodex({ ...record(), media: [], original: { content: "ordinary chatter", contexts: [] } }, free("skip", 0.97, "opinion")), false);
  assert.equal(shouldEscalateToCodex({ ...record(), source: { type: "discord-announcement" } }, free("review", 0.5)), false);
});

test("Codex exec는 읽기 전용 일회성 스키마 출력만 사용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-codex-review-"));
  const executablePath = path.join(root, "codex.js");
  await writeFile(executablePath, "test", "utf8");
  try {
    const result = await invokeCodexNewsReview(record(), free(), {
      executablePath,
      workRoot: path.join(root, "runtime"),
      async runProcess(command, args, options) {
        assert.equal(command, process.execPath);
        assert.equal(args[0], executablePath);
        assert.equal(args.includes("--ephemeral"), true);
        assert.equal(args.includes("--ignore-user-config"), true);
        assert.equal(args.includes("--ignore-rules"), true);
        assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
        assert.match(options.input, /Developing your App is the easy part/);
        assert.match(options.input, /No image pixels are attached/);
        assert.match(options.input, /concrete inference can be publish/i);
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        const schemaPath = args[args.indexOf("--output-schema") + 1];
        const schema = JSON.parse(await readFile(schemaPath, "utf8"));
        assert.equal(schema.additionalProperties, false);
        await writeFile(outputPath, JSON.stringify({
          decision: "review",
          confidence: 0.86,
          importance: "medium",
          evidenceTag: "inference",
          reason: "앱 개발 장벽 완화를 암시하는 맥락이다.",
          advice: "이미지는 사람이 확인하고 게시 후보로 검토하세요.",
        }), "utf8");
      },
    });
    assert.equal(result.decision, "review");
    assert.equal(result.evidenceTag, "inference");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex 심층검토는 날짜별 상한과 항목별 영수증으로 반복 사용을 막는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-codex-budget-"));
  let calls = 0;
  const reviewer = createCodexNewsReviewer({
    stateRoot: root,
    executablePath: path.join(root, "codex.js"),
    dailyLimit: 2,
    now: () => new Date("2026-08-02T01:00:00Z"),
    async invoke() {
      calls += 1;
      return { decision: "publish", confidence: 0.9, importance: "high", evidenceTag: "inference", reason: "의미 있음", advice: "[유추] 게시 권장" };
    },
  });
  try {
    const first = await reviewer.review(record(), free());
    const reused = await reviewer.review(record(), free());
    const revisedRecord = { ...record(), workflow: { analysisRevision: 2 } };
    const revised = await reviewer.review(revisedRecord, free());
    const revisedReused = await reviewer.review(revisedRecord, free());
    const limited = await reviewer.review(record("b".repeat(32)), free());
    assert.equal(first.status, "complete");
    assert.equal(reused.reused, true);
    assert.equal(revised.status, "complete");
    assert.equal(revisedReused.reused, true);
    assert.equal(limited.status, "daily_limit");
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
