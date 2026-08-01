import assert from "node:assert/strict";
import test from "node:test";
import {
  buildXStreamRule,
  readXFilteredStream,
  runXFilteredStream,
  syncXStreamRule,
  xLinksFromStreamEvent,
} from "../src/modules/news/x-filtered-stream.mjs";

test("X 스트림 규칙은 allowlist 계정과 리포스트 제외만 포함한다", () => {
  assert.deepEqual(buildXStreamRule(new Set(["thsottiaux", "OpenAI"])), {
    value: "(from:thsottiaux OR from:OpenAI) -is:retweet",
    tag: "hanabit-news-v1",
  });
});

test("X 스트림 이벤트를 주 링크와 답글 부모 문맥 링크로 제한한다", () => {
  const event = {
    data: {
      id: "2091234567890123456",
      author_id: "10",
      referenced_tweets: [
        { type: "replied_to", id: "2091234567890123455" },
        { type: "retweeted", id: "2091234567890123454" },
      ],
    },
    includes: {
      users: [
        { id: "10", username: "thsottiaux" },
        { id: "11", username: "OpenAI" },
      ],
      tweets: [
        { id: "2091234567890123455", author_id: "11" },
        { id: "2091234567890123454", author_id: "11" },
      ],
    },
  };
  assert.deepEqual(xLinksFromStreamEvent(event, { allowedHandles: new Set(["thsottiaux"]) }), {
    handle: "thsottiaux",
    statusId: "2091234567890123456",
    links: [
      "https://x.com/thsottiaux/status/2091234567890123456",
      "https://x.com/OpenAI/status/2091234567890123455",
    ],
  });
});

test("등록되지 않은 작성자의 스트림 이벤트는 무시한다", () => {
  assert.equal(xLinksFromStreamEvent({
    data: { id: "2091234567890123456", author_id: "10" },
    includes: { users: [{ id: "10", username: "not_allowed" }] },
  }, { allowedHandles: new Set(["OpenAI"]) }), null);
});

test("X 스트림은 토큰을 URL에 넣지 않고 줄 단위 JSON만 전달한다", async () => {
  const events = [];
  let connected = 0;
  await readXFilteredStream({
    bearerToken: "secret-value",
    async onConnected() { connected += 1; },
    async onEvent(event) { events.push(event); },
    async fetchImpl(url, init) {
      assert.equal(url.hostname, "api.x.com");
      assert.equal(url.href.includes("secret-value"), false);
      assert.equal(init.headers.authorization, "Bearer secret-value");
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('\r\n{"data":{"id":"1"}}\n'));
          controller.close();
        },
      }), { status: 200 });
    },
  });
  assert.equal(connected, 1);
  assert.deepEqual(events, [{ data: { id: "1" } }]);
});

test("X API 오류에는 안전한 상태 코드만 기록한다", async () => {
  await assert.rejects(
    readXFilteredStream({
      bearerToken: "secret-value",
      async onEvent() {},
      async fetchImpl() { return new Response("", { status: 429 }); },
    }),
    (error) => error.statusCode === 429 && error.terminal === false,
  );
});

test("인증 실패는 재연결하지 않고 닫는다", async () => {
  let attempts = 0;
  await runXFilteredStream({
    bearerToken: "secret-value",
    signal: new AbortController().signal,
    async onEvent() {},
    async connect() {
      attempts += 1;
      throw Object.assign(new Error("unauthorized"), { terminal: true });
    },
  });
  assert.equal(attempts, 1);
});

test("Hanabit 소유 규칙만 교체하고 다른 규칙은 보존한다", async () => {
  const calls = [];
  const rule = buildXStreamRule(new Set(["OpenAI"]));
  const result = await syncXStreamRule({
    bearerToken: "secret-value",
    rule,
    existingRules: [
      { id: "2091234567890123450", tag: "hanabit-news-v1", value: "from:old" },
      { id: "2091234567890123451", tag: "someone-else", value: "cats" },
    ],
    async fetchImpl(url, init) {
      calls.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.changed, true);
  assert.deepEqual(calls, [
    { add: [rule] },
    { delete: { ids: ["2091234567890123450"] } },
  ]);
});
