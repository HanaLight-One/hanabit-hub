import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createThemeHistory } from "../src/modules/images/theme-history.mjs";
import {
  createTopicThemeSource,
  normalizeTopicTheme,
} from "../src/modules/images/topic-theme-source.mjs";

test("Technique Tuesdays의 Discord Learn more 꼬리를 제거한다", () => {
  const asteriskTheme = [
    "Technique Tuesdays: dramatic rim lighting",
    "",
    "*Learn more:* https://discord.com/channels/974519864045756446/1530686647606444122/1530686647606444",
  ].join("\n");
  const underscoreTheme =
    "Technique Tuesdays :art: __ Bookplates — This book belongs to… " +
    "_Learn more:_ https://discord.com/channels/974519864045756446/1530686647606444122/1530686647606444122";

  assert.equal(
    normalizeTopicTheme(asteriskTheme),
    "Technique Tuesdays: dramatic rim lighting",
  );
  assert.equal(
    normalizeTopicTheme(underscoreTheme),
    "Technique Tuesdays :art: __ Bookplates — This book belongs to…",
  );
  assert.equal(
    normalizeTopicTheme("Learn more라는 단어가 포함된 일반 테마"),
    "Learn more라는 단어가 포함된 일반 테마",
  );
});

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

test("정리된 테마만 기록하고 topic 원본은 변경하지 않는다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-topic-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const topicPath = path.join(root, "topic.json");
  const history = createThemeHistory({ root: path.join(root, "history") });
  const source = createTopicThemeSource({ topicPath, history });
  const topic =
    "Technique Tuesdays: 색의 대비\n\n" +
    "*Learn more:* https://discord.com/channels/974519864045756446/1530686647606444122/1530686647606444";
  await writeFile(
    topicPath,
    JSON.stringify({
      fetched_at: "2026-07-28T17:00:00Z",
      topic,
    }),
  );

  const captured = await source.capture();

  assert.equal(captured.theme, "Technique Tuesdays: 색의 대비");
  assert.equal(JSON.parse(await readFile(topicPath, "utf8")).topic, topic);
});
