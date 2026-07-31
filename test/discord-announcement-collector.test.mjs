import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiscordAnnouncementCollector } from "../src/modules/news/discord-announcement-collector.mjs";

const channelId = "1532598696586383360";
const message = {
  id: "1533000000000000000",
  type: 0,
  channelId,
  content: "New announcement",
  embeds: [],
  attachments: [],
  createdTimestamp: Date.parse("2026-07-31T00:00:00Z"),
};

test("실시간과 보충 수집은 같은 중복 방지 저장소를 사용한다", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-collector-"));
  try {
    const collector = createDiscordAnnouncementCollector({ stateRoot, channelId });
    assert.deepEqual(await collector.collectMessage(message), {
      status: "created",
      mediaCount: 0,
    });
    assert.deepEqual(await collector.collectMessage(message), {
      status: "existing",
      mediaCount: 0,
    });

    const summary = await collector.collectRecent(
      { messages: { async fetch() { return new Map([[message.id, message]]); } } },
      { limit: 100 },
    );
    assert.deepEqual(summary, {
      scanned: 1,
      eligible: 1,
      existing: 1,
      created: 0,
      media: 0,
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
