import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNewsPushNotifier } from "../src/modules/news/news-push-notifier.mjs";

test("뉴스 Push는 전달 성공 영수증으로 반복 발송을 막는다", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-push-"));
  const id = "a".repeat(32);
  const itemRoot = path.join(stateRoot, "pending", id);
  const record = { id, workflow: { status: "pending_review" } };
  await mkdir(itemRoot, { recursive: true });
  await writeFile(path.join(itemRoot, "item.json"), JSON.stringify(record), "utf8");
  let sends = 0;
  try {
    const notifier = createNewsPushNotifier({
      stateRoot,
      pushNotifications: { async publish() { sends += 1; return { sent: 1 }; } },
      now: () => new Date("2026-08-01T01:02:03Z"),
    });
    const first = await notifier.notify(record);
    await notifier.notify(first);
    const saved = JSON.parse(await readFile(path.join(itemRoot, "item.json"), "utf8"));
    assert.equal(sends, 1);
    assert.deepEqual(saved.workflow.webPushReceipt, { sentAt: "2026-08-01T01:02:03.000Z", delivered: 1 });
  } finally { await rm(stateRoot, { recursive: true, force: true }); }
});
