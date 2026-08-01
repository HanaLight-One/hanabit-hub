import assert from "node:assert/strict";
import test from "node:test";
import { createXStreamDiscordBridge } from "../src/modules/news/x-stream-discord-bridge.mjs";

test("X 스트림 게시물과 부모 문맥을 Discord 한 메시지로 한 번만 전달한다", async () => {
  const sent = [];
  const detected = {
    handle: "thsottiaux",
    statusId: "2091234567890123456",
    links: [
      "https://x.com/thsottiaux/status/2091234567890123456",
      "https://x.com/OpenAI/status/2091234567890123455",
    ],
  };
  const bridge = createXStreamDiscordBridge({
    channel: { async send(message) { sent.push(message); } },
    allowedHandles: new Set(["thsottiaux"]),
    collector: { async hasPost() { return false; } },
    parseEvent() { return detected; },
  });
  assert.deepEqual(await bridge.forwardEvent({}), { status: "forwarded", contextCount: 1 });
  assert.deepEqual(await bridge.forwardEvent({}), { status: "existing", contextCount: 1 });
  assert.deepEqual(sent, [{
    content: detected.links.join("\n"),
    allowedMentions: { parse: [] },
  }]);
});

test("이미 수집한 X 게시물은 Discord에 다시 전달하지 않는다", async () => {
  let sends = 0;
  const bridge = createXStreamDiscordBridge({
    channel: { async send() { sends += 1; } },
    allowedHandles: new Set(["thsottiaux"]),
    collector: { async hasPost() { return true; } },
    parseEvent() {
      return { handle: "thsottiaux", statusId: "2091234567890123456", links: ["https://x.com/a/status/1"] };
    },
  });
  assert.equal((await bridge.forwardEvent({})).status, "existing");
  assert.equal(sends, 0);
});

