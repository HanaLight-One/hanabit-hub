import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(themeService, callback) {
  const server = createServer({ themeService });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("테마 API가 오늘 및 선택 날짜 기록을 안전하게 제공한다", async () => {
  const calls = [];
  const service = {
    async get(date) {
      calls.push(date);
      return {
        date: date ?? "2026-07-29",
        theme: {
          date: date ?? "2026-07-29",
          theme: "별빛 아래 작은 약속",
          firstObservedAt: "2026-07-28T17:00:00.000Z",
          lastObservedAt: "2026-07-28T17:00:00.000Z",
        },
      };
    },
  };

  await withServer(service, async (baseUrl) => {
    const current = await fetch(`${baseUrl}/api/themes`);
    const past = await fetch(`${baseUrl}/api/themes?date=2026-07-28`);
    const body = await past.json();

    assert.equal(current.status, 200);
    assert.equal(past.status, 200);
    assert.deepEqual(calls, [undefined, "2026-07-28"]);
    assert.equal(body.available, true);
    assert.equal(body.theme.theme, "별빛 아래 작은 약속");
    assert.equal(JSON.stringify(body).includes("channel"), false);
    assert.equal(JSON.stringify(body).includes("path"), false);
  });
});

test("테마 API가 잘못된 날짜와 쓰기 요청을 거부한다", async () => {
  const service = { async get() {} };

  await withServer(service, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/themes?date=2026-02-30`);
    const write = await fetch(`${baseUrl}/api/themes`, { method: "POST" });

    assert.equal(invalid.status, 400);
    assert.equal(write.status, 405);
  });
});

test("테마 연동이 없으면 API를 노출하지 않는다", async () => {
  await withServer(null, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/themes`);
    assert.equal(response.status, 404);
  });
});
