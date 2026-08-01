import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import webPush from "web-push";

const EVENT_CATALOG = Object.freeze({
  "image.completed": { title: "이미지 생성 완료", body: "이미지 생성이 완료되었어요오!!!", url: "/images", tag: "image-completed" },
  "news.created": { title: "새 뉴스 도착", body: "뉴스가 올라갔어요오!!!!", url: "/news", tag: "news-created" },
  "news.duplicate-review": { title: "사람 판단 필요", body: "뉴스가 중복이에요!!!! 사람 판단이 필요해요오오오!!!!!", url: "/news", tag: "news-duplicate" },
  "theme.registered": { title: "오늘의 테마", body: "오늘의 테마가 정상 등록되었어요오!!!!", url: "/images", tag: "theme-registered" },
  "fortune.registered": { title: "오늘의 운세", body: "오늘의 운세가 정상 등록되었어요오!!!!!!!", url: "/fortune", tag: "fortune-registered" },
  "test.missed-you": { title: "하나빛", body: "그냥 보고팠어요!!!!!", url: "/", tag: "hanabit-missed-you" },
});

function validateSubscription(value) {
  let endpoint;
  try { endpoint = new URL(String(value?.endpoint ?? "")); } catch { throw new TypeError("올바른 Push 구독이 필요합니다."); }
  if (endpoint.protocol !== "https:" || endpoint.href.length > 2_048) throw new TypeError("올바른 Push 구독이 필요합니다.");
  const p256dh = String(value?.keys?.p256dh ?? "");
  const auth = String(value?.keys?.auth ?? "");
  if (!/^[A-Za-z0-9_-]{20,256}$/u.test(p256dh) || !/^[A-Za-z0-9_-]{8,128}$/u.test(auth)) {
    throw new TypeError("Push 구독 키가 올바르지 않습니다.");
  }
  return { endpoint: endpoint.href, expirationTime: null, keys: { p256dh, auth } };
}

async function readJson(target, fallback) {
  try { return JSON.parse(await readFile(target, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function createPushNotificationService({ root, now = () => new Date(), sender = webPush }) {
  if (!path.isAbsolute(root)) throw new TypeError("Push 알림 상태 루트는 절대경로여야 합니다.");
  const keysPath = path.join(root, "vapid.json");
  const subscriptionsPath = path.join(root, "subscriptions.json");
  let initialization;

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      await mkdir(root, { recursive: true });
      let keys = await readJson(keysPath, null);
      if (!keys) {
        const generated = sender.generateVAPIDKeys();
        try {
          await writeFile(keysPath, `${JSON.stringify(generated, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
          keys = generated;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          keys = await readJson(keysPath, null);
        }
      }
      if (!keys?.publicKey || !keys?.privateKey) throw new Error("Push 알림 키를 준비하지 못했습니다.");
      sender.setVapidDetails("https://studio.hanabit.one", keys.publicKey, keys.privateKey);
      return keys;
    })();
    return initialization;
  }

  async function readSubscriptions() {
    const value = await readJson(subscriptionsPath, { schemaVersion: 1, subscriptions: [] });
    return Array.isArray(value.subscriptions) ? value.subscriptions : [];
  }

  async function status() {
    const keys = await initialize();
    const subscriptions = await readSubscriptions();
    return { supported: true, publicKey: keys.publicKey, subscriberCount: subscriptions.length };
  }

  async function subscribe(input) {
    await initialize();
    const subscription = validateSubscription(input);
    const subscriptions = await readSubscriptions();
    const id = createHash("sha256").update(subscription.endpoint).digest("hex").slice(0, 24);
    const next = subscriptions.filter((entry) => entry.id !== id);
    next.push({ id, subscription, subscribedAt: now().toISOString() });
    await writeJsonAtomic(subscriptionsPath, { schemaVersion: 1, subscriptions: next });
    return { subscribed: true, subscriberCount: next.length };
  }

  async function unsubscribe(endpointValue) {
    let endpoint;
    try { endpoint = new URL(String(endpointValue ?? "")).href; } catch { throw new TypeError("해제할 Push 구독이 필요합니다."); }
    const subscriptions = await readSubscriptions();
    const next = subscriptions.filter((entry) => entry.subscription?.endpoint !== endpoint);
    if (next.length !== subscriptions.length) {
      await writeJsonAtomic(subscriptionsPath, { schemaVersion: 1, subscriptions: next });
    }
    return { subscribed: false, subscriberCount: next.length };
  }

  async function publish(type) {
    const event = EVENT_CATALOG[type];
    if (!event) throw new TypeError("허용되지 않은 알림 종류입니다.");
    await initialize();
    const subscriptions = await readSubscriptions();
    const staleIds = new Set();
    let sent = 0;
    let failed = 0;
    const payload = JSON.stringify({ ...event, type });
    for (const entry of subscriptions) {
      try {
        await sender.sendNotification(entry.subscription, payload, { TTL: 300, urgency: "normal" });
        sent += 1;
      } catch (error) {
        if ([404, 410].includes(error?.statusCode)) staleIds.add(entry.id);
        else failed += 1;
      }
    }
    if (staleIds.size) {
      const next = subscriptions.filter((entry) => !staleIds.has(entry.id));
      await writeJsonAtomic(subscriptionsPath, { schemaVersion: 1, subscriptions: next });
    }
    return { type, sent, failed, removed: staleIds.size };
  }

  return Object.freeze({ status, subscribe, unsubscribe, publish });
}

export { EVENT_CATALOG };
