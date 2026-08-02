import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPushNotificationService } from "../src/modules/notifications/push-notifications.mjs";

const subscription = {
  endpoint: "https://push.example.test/send/device-1",
  keys: { p256dh: "a".repeat(32), auth: "b".repeat(16) },
};

test("Push 알림은 키와 구독을 상태 폴더에만 보관하고 고정 문구를 전송한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-push-"));
  const sent = [];
  const sender = {
    generateVAPIDKeys: () => ({ publicKey: "public", privateKey: "private" }),
    setVapidDetails: () => {},
    async sendNotification(target, payload) { sent.push({ target, payload: JSON.parse(payload) }); },
  };
  try {
    const service = createPushNotificationService({ root, sender, now: () => new Date("2026-08-01T00:00:00Z") });
    assert.equal((await service.status()).subscriberCount, 0);
    assert.equal((await service.subscribe(subscription)).subscriberCount, 1);
    assert.equal((await service.publish("test.missed-you")).sent, 1);
    assert.equal(sent[0].payload.body, "그냥 보고팠어요!!!!!");
    assert.equal((await service.publish("news.published")).sent, 1);
    assert.equal(sent[1].payload.url, "/news");
    const stored = await readFile(path.join(root, "subscriptions.json"), "utf8");
    assert.equal(stored.includes("private"), false);
    assert.equal((await service.unsubscribe(subscription.endpoint)).subscriberCount, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("만료된 Push 구독은 실패 후 안전하게 정리한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-push-stale-"));
  const sender = {
    generateVAPIDKeys: () => ({ publicKey: "public", privateKey: "private" }),
    setVapidDetails: () => {},
    async sendNotification() { throw Object.assign(new Error("gone"), { statusCode: 410 }); },
  };
  try {
    const service = createPushNotificationService({ root, sender });
    await service.subscribe(subscription);
    assert.deepEqual(await service.publish("news.created"), { type: "news.created", sent: 0, failed: 0, removed: 1 });
    assert.equal((await service.status()).subscriberCount, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
