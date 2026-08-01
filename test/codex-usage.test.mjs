import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createCodexUsageService } from "../src/modules/system/codex-usage.mjs";
import { createServer } from "../src/server.mjs";

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {};
  child.stdin = {
    write(line) {
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: 0, result: {} })}\n`)));
      }
      if (message.method === "account/rateLimits/read") {
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({
          id: 1,
          result: {
            rateLimits: {
              limitId: "codex",
              primary: { usedPercent: 71, windowDurationMins: 10_080, resetsAt: 1_786_173_988 },
              secondary: null,
            },
          },
        })}\n`)));
      }
    },
  };
  return child;
}

test("Codex app-server 응답은 남은 퍼센트와 초기화 시각만 공개한다", async () => {
  const service = createCodexUsageService({
    executablePath: "codex.exe",
    spawnProcess: fakeSpawn,
    now: () => new Date("2026-08-01T12:00:00.000Z"),
  });
  assert.deepEqual(await service.read(), {
    available: true,
    source: "codex-app-server",
    checkedAt: "2026-08-01T12:00:00.000Z",
    primary: {
      usedPercent: 71,
      remainingPercent: 29,
      durationMinutes: 10_080,
      resetsAt: "2026-08-08T07:26:28.000Z",
    },
    secondary: null,
  });
});

test("Codex 사용량 API는 읽기 전용 공개 계약만 반환한다", async () => {
  const server = createServer({
    systemUsage: { async read() { return { available: true, primary: { remainingPercent: 29 } }; } },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/system/codex/usage`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: true, primary: { remainingPercent: 29 } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
