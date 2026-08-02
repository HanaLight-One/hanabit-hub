import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNewsWatcherStatus } from "../src/modules/system/news-watcher-status.mjs";
import { createServer } from "../src/server.mjs";

test("뉴스 감시기 상태는 로그 내용 없이 최근 신호만 공개한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-watcher-status-"));
  try {
    const signalPath = path.join(root, "discord-watcher.log");
    await writeFile(signalPath, "SECRET internal path and token", "utf8");
    const mtime = new Date("2026-08-02T02:50:00.000Z");
    await utimes(signalPath, mtime, mtime);

    const result = await createNewsWatcherStatus({
      signalPath,
      now: () => new Date("2026-08-02T03:00:00.000Z"),
    }).read();

    assert.deepEqual(result, {
      ready: true,
      state: "connected",
      lastSeenAt: "2026-08-02T02:50:00.000Z",
    });
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("20분을 넘긴 뉴스 감시 신호는 지연으로 표시한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-watcher-stale-"));
  try {
    const signalPath = path.join(root, "discord-watcher.log");
    await writeFile(signalPath, "safe", "utf8");
    const mtime = new Date("2026-08-02T02:30:00.000Z");
    await utimes(signalPath, mtime, mtime);
    assert.deepEqual(
      await createNewsWatcherStatus({
        signalPath,
        now: () => new Date("2026-08-02T03:00:01.000Z"),
      }).read(),
      { ready: false, state: "stale", lastSeenAt: "2026-08-02T02:30:00.000Z" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("뉴스 감시기 상태 API는 읽기 전용 계약만 제공한다", async () => {
  const payload = { ready: true, state: "connected", lastSeenAt: "2026-08-02T03:00:00.000Z" };
  const server = createServer({
    systemNewsWatcher: { async read() { return payload; } },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/system/news-watcher`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
    assert.equal(
      (await fetch(`${baseUrl}/api/system/news-watcher`, { method: "POST" })).status,
      405,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
