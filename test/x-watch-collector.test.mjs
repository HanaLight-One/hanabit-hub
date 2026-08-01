import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createXWatchCollector } from "../src/modules/news/x-watch-collector.mjs";

test("X 수집기는 같은 게시물을 한 번만 대기함에 저장한다", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hanabit-x-collector-"));
  const id = "d".repeat(32);
  const message = { id: "1533000000000000001", createdTimestamp: 1 };
  const normalized = {
    id,
    mediaCandidates: [],
    record: { id, source: { type: "x-post" }, original: { content: "news" }, workflow: { status: "pending_translation" } },
  };
  let resolves = 0;
  try {
    const collector = createXWatchCollector({
      stateRoot,
      channelId: "1532598778865914067",
      allowedHandles: new Set(["thsottiaux"]),
      identifyMessage() { return { id, post: {} }; },
      async resolveMessage() { resolves += 1; return normalized; },
    });
    assert.equal((await collector.collectMessage(message)).status, "created");
    assert.equal((await collector.collectMessage(message)).status, "existing");
    const summary = await collector.collectRecent({ messages: { async fetch() { return new Map([[message.id, message]]); } } });
    assert.equal(summary.existing, 1);
    assert.deepEqual(summary.ids, [id]);
    assert.equal(resolves, 1);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
