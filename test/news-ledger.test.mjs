import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openHubDatabase } from "../src/modules/database/hub-database.mjs";
import { createNewsLedger } from "../src/modules/news/news-ledger.mjs";

test("뉴스 원장은 플랫폼 원문 중복과 승인 없는 게시를 DB 제약으로 차단한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-ledger-"));
  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  const ledger = createNewsLedger({ database, now: () => new Date("2026-08-01T01:02:03Z") });
  const storyA = "a".repeat(32);
  const storyB = "b".repeat(32);
  try {
    ledger.registerStory({ id: storyA, storyKey: "gpt-x-launch" });
    ledger.registerStory({ id: storyB, storyKey: "another-story" });
    ledger.attachSource({
      id: "c".repeat(32), storyId: storyA, platform: "x", externalId: "1234567890",
      sourceType: "x-post", account: "OpenAI", url: "https://x.com/OpenAI/status/1234567890",
      publishedAt: "2026-08-01T00:00:00Z", contentFingerprint: "fingerprint-a",
    });
    assert.throws(() => ledger.attachSource({
      id: "d".repeat(32), storyId: storyB, platform: "x", externalId: "1234567890",
      sourceType: "x-post", publishedAt: "2026-08-01T00:01:00Z", contentFingerprint: "fingerprint-b",
    }), /UNIQUE/u);
    assert.throws(() => ledger.recordPublication({
      storyId: storyA, status: "posted", postId: "100", contentHash: "e".repeat(64),
    }), /FOREIGN KEY/u);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test("뉴스 원장은 사건별 승인과 게시 영수증을 각각 한 번만 허용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-ledger-receipt-"));
  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  const ledger = createNewsLedger({ database, now: () => new Date("2026-08-01T01:02:03Z") });
  const storyId = "a".repeat(32);
  try {
    ledger.registerStory({ id: storyId, storyKey: "gpt-x-launch" });
    ledger.approveStory(storyId);
    assert.throws(() => ledger.approveStory(storyId), /UNIQUE/u);
    ledger.recordPublication({ storyId, status: "posted", postId: "100", contentHash: "f".repeat(64) });
    assert.throws(() => ledger.recordPublication({ storyId, status: "posted", postId: "101", contentHash: "f".repeat(64) }), /UNIQUE/u);
    assert.equal(database.prepare("SELECT status FROM news_stories WHERE id = ?").get(storyId).status, "published");
    assert.equal(database.prepare("SELECT post_id FROM news_publications WHERE story_id = ?").get(storyId).post_id, "100");
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});
