import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createThemeHistory } from "../src/modules/images/theme-history.mjs";
import { createTopicThemeSource } from "../src/modules/images/topic-theme-source.mjs";

test("현재 topic 파일을 02시 운영일 기준으로 기록한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-topic-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const topicPath = path.join(root, "topic.json");
  const history = createThemeHistory({ root: path.join(root, "history") });
  const source = createTopicThemeSource({
    topicPath,
    history,
    channelId: "expected-channel",
    channelName: "daily-theme",
  });
  await writeFile(
    topicPath,
    JSON.stringify({
      fetched_at: "2026-07-28T16:30:00Z",
      channel_id: "expected-channel",
      channel_name: "daily-theme",
      topic: "잠들기 전의 작은 별빛",
    }),
  );

  const captured = await source.capture();

  assert.equal(captured.date, "2026-07-28");
  assert.equal(captured.theme, "잠들기 전의 작은 별빛");
  assert.deepEqual(await history.get("2026-07-28"), captured);
});

test("채널이 다르거나 원본이 손상되면 기록하지 않는다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-topic-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const topicPath = path.join(root, "topic.json");
  const history = createThemeHistory({ root: path.join(root, "history") });
  const source = createTopicThemeSource({
    topicPath,
    history,
    channelId: "expected-channel",
  });
  await writeFile(
    topicPath,
    JSON.stringify({
      fetched_at: "2026-07-28T17:00:00Z",
      channel_id: "other-channel",
      topic: "기록되면 안 되는 테마",
    }),
  );

  assert.equal(await source.capture(), null);
  assert.equal(await history.get("2026-07-29"), null);
  await writeFile(topicPath, "{broken");
  assert.equal(await source.capture(), null);
});
