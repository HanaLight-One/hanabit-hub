import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(service, callback) {
  const server = createServer({ notificationService: service });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("Push 알림 API는 공개키만 제공하고 같은 출처 구독만 허용한다", async () => {
  const calls = [];
  const service = {
    async status() { return { supported: true, publicKey: "public", subscriberCount: 0 }; },
    async subscribe(value) { calls.push(value); return { subscribed: true, subscriberCount: 1 }; },
    async unsubscribe() { return { subscribed: false, subscriberCount: 0 }; },
    async publish() { return { sent: 1 }; },
  };
  await withServer(service, async (baseUrl) => {
    const status = await (await fetch(`${baseUrl}/api/notifications/status`)).json();
    assert.deepEqual(status, { supported: true, publicKey: "public", subscriberCount: 0 });
    const forbidden = await fetch(`${baseUrl}/api/notifications/subscriptions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(forbidden.status, 403);
    const allowed = await fetch(`${baseUrl}/api/notifications/subscriptions`, {
      method: "POST",
      headers: { origin: baseUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ action: "subscribe", subscription: { endpoint: "safe" } }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(calls.length, 1);
  });
});

test("테스트 Push는 정확한 확인 문구만 허용한다", async () => {
  let sends = 0;
  const service = {
    async status() { return {}; }, async subscribe() {}, async unsubscribe() {},
    async publish(type) { sends += 1; assert.equal(type, "test.missed-you"); return { sent: 1 }; },
  };
  await withServer(service, async (baseUrl) => {
    const headers = { origin: baseUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    assert.equal((await fetch(`${baseUrl}/api/notifications/test`, { method: "POST", headers, body: "{}" })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/notifications/test`, { method: "POST", headers, body: JSON.stringify({ confirmation: "send-missed-you-notification" }) })).status, 200);
    assert.equal(sends, 1);
  });
});
