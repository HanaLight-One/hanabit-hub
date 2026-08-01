import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiscordNewsNotifier } from "../src/modules/news/discord-news-notifier.mjs";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";

test("게시 검토 뉴스는 식별자와 함께 news-pending에 한 번만 보낸다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-notifier-"));
  const id = "1".repeat(32);
  const store = createPendingNewsStore({ root });
  await store.create({
    id,
    source: { type: "x-post", url: "https://x.com/thsottiaux/status/12345" },
    workflow: {
      status: "pending_review",
      translation: { title: "코덱스 한도 초기화", body: "한도가 초기화됐습니다." },
      triage: { decision: "publish", reason: "사용량 정책 변경" },
    },
  });
  const sent = [];
  const pendingChannel = {
    messages: { async fetch() { return new Map(); } },
    async send(payload) { sent.push(payload); return { id: "1534000000000000000", content: payload.content }; },
  };
  try {
    const notifier = createDiscordNewsNotifier({ stateRoot: root, pendingChannel });
    await notifier.notify(await store.read(id));
    await notifier.notify(await store.read(id));
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /바로 올리자아/);
    assert.match(sent[0].content, new RegExp(id));
    assert.equal((await store.read(id)).workflow.discordPendingReceipt.messageId, "1534000000000000000");
  } finally { await rm(root, { recursive: true, force: true }); }
});
