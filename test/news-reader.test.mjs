import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNewsReader } from "../src/modules/news/news-reader.mjs";

test("뉴스 리더는 내부 경로와 Discord ID 없이 공개 계약을 반환한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-reader-"));
  const id = "a".repeat(32);
  const itemRoot = path.join(root, "pending", id);
  try {
    await mkdir(path.join(itemRoot, "media"), { recursive: true });
    await writeFile(path.join(itemRoot, "media", "01-news.png"), "image", "utf8");
    await writeFile(path.join(itemRoot, "item.json"), JSON.stringify({
      id,
      source: { type: "discord-announcement", channelId: "secret-channel", messageId: "secret-message", url: "https://discord.com/channels/1/2/3", publishedAt: "2026-07-31T00:00:00Z" },
      original: { language: "en", content: "Hello", embeds: [], links: ["https://openai.com/news"], contexts: [{ relation: "linked-post", account: "OpenAI", content: "Parent context", url: "https://x.com/OpenAI/status/12345" }] },
      workflow: {
        status: "pending_review",
        translation: { title: "한글 제목", body: "한글 본문" },
        freeTriage: { decision: "review", confidence: 0.7, importance: "medium", evidenceTag: "inference", reason: "애매함", advice: "상위 검토" },
        triage: { decision: "publish", confidence: 0.95, importance: "high", evidenceTag: "official", reason: "공식 발표", advice: "바로 검토하세요." },
        codexReview: { status: "complete", reviewedAt: "2026-07-31T00:01:00Z", decision: "publish", confidence: 0.95, importance: "high", evidenceTag: "official", reason: "공식 발표", advice: "바로 검토하세요." },
        dcPublication: null,
      },
      collectedAt: "2026-07-31T00:01:00Z",
      media: [{ kind: "attachment", file: "media/01-news.png", contentType: "image/png", size: 5 }],
    }), "utf8");

    const reader = createNewsReader({
      root,
      sourceProfiles: new Map([["openai", {
        displayName: "OpenAI",
        handle: "OpenAI",
        affiliation: "OpenAI",
        affiliationConfirmed: true,
        roles: ["회사 공식 발표 채널"],
        topics: ["모델"],
        trustLabel: "공식 출처",
        verifiedAt: "2026-08-02",
        whyTracked: "공식 발표 출처예요.",
      }]]),
    });
    const payload = await reader.list();
    const serialized = JSON.stringify(payload);
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].media[0].url, `/api/news/${id}/media/01-news.png`);
    assert.equal(payload.items[0].workflow.translation.title, "한글 제목");
    assert.equal(payload.items[0].workflow.triage.decision, "publish");
    assert.equal(payload.items[0].workflow.triage.advice, "바로 검토하세요.");
    assert.equal(payload.items[0].workflow.triage.evidenceTag, "official");
    assert.equal(payload.items[0].workflow.autoPublishGate.decision, "eligible");
    assert.equal(payload.items[0].workflow.canReanalyze, false);
    assert.equal(payload.items[0].workflow.freeTriage.decision, "review");
    assert.equal(payload.items[0].workflow.codexReview.status, "complete");
    assert.equal(payload.items[0].source.profile.trustLabel, "공식 출처");
    assert.equal(payload.items[0].original.contexts[0].content, "Parent context");
    assert.equal(payload.items[0].workflow.canApproveForDc, true);
    assert.equal(payload.items[0].workflow.dcApproval, null);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes("secret-channel"), false);
    assert.equal(serialized.includes("secret-message"), false);
    const media = await reader.findMedia(id, "01-news.png");
    assert.equal(media.contentType, "image/png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("뉴스 리더는 없는 대기함을 빈 목록으로 반환한다", async () => {
  const root = path.join(os.tmpdir(), `hanabit-missing-${Date.now()}`);
  assert.deepEqual(await createNewsReader({ root }).list(), { items: [], total: 0, skipped: 0 });
});
