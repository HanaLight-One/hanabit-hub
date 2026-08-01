import assert from "node:assert/strict";
import test from "node:test";
import { createXStreamStatusNotifier } from "../src/modules/news/x-stream-status-notifier.mjs";

test("X 감시 상태는 바뀔 때만 news-log에 알린다", async () => {
  const messages = [];
  const notifier = createXStreamStatusNotifier({
    sourceCount: 6,
    channel: {
      async send(payload) { messages.push(payload); },
    },
  });

  assert.equal(await notifier.announce("connected"), true);
  assert.equal(await notifier.announce("connected"), false);
  assert.equal(await notifier.announce("reconnecting"), true);
  assert.equal(await notifier.announce("reconnecting"), false);
  assert.equal(await notifier.announce("connected"), true);

  assert.deepEqual(messages.map((message) => message.content), [
    "✅ X 실시간 감시 연결됨 · 감시 계정 6개",
    "⚠️ X 실시간 감시 재연결 중 · 잠시 후 다시 시도해요.",
    "✅ X 실시간 감시 재연결됨 · 감시 계정 6개",
  ]);
  assert.deepEqual(messages[0].allowedMentions, { parse: [] });
});

test("X 제한과 인증 중단은 원문 오류 없이 고정 문구로 알린다", async () => {
  const messages = [];
  const notifier = createXStreamStatusNotifier({
    sourceCount: 2,
    channel: { async send(payload) { messages.push(payload.content); } },
  });

  await notifier.announce("limited");
  await notifier.announce("stopped");

  assert.deepEqual(messages, [
    "🚨 X 실시간 감시 제한됨 · 크레딧 또는 사용 한도를 확인해 주세요.",
    "🚨 X 실시간 감시 중단 · 인증과 API 이용 상태를 확인해 주세요.",
  ]);
});
