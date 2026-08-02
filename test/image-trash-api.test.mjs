import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(imageTrash, callback) {
  const server = createServer({ archive: null, imageTrash });
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

test("이미지 휴지통 API는 목록을 읽고 같은 출처의 정확한 확인값만 실행한다", async () => {
  const calls = [];
  const imageTrash = {
    async list() { return { enabled: true, items: [] }; },
    async move(id) { calls.push(["move", id]); return { id: "b".repeat(32) }; },
  };
  await withServer(imageTrash, async (baseUrl) => {
    assert.deepEqual(await (await fetch(`${baseUrl}/api/images/trash`)).json(), { enabled: true, items: [] });
    const route = `${baseUrl}/api/images/${"a".repeat(64)}/trash`;
    const rejected = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "move-image-to-trash" }),
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetch(route, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ confirmation: "move-image-to-trash" }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls, [["move", "a".repeat(64)]]);
  });
});

test("이미지 휴지통 API는 복원과 영구 삭제의 확인값을 서로 구분한다", async () => {
  const calls = [];
  const imageTrash = {
    async restore(id) { calls.push(["restore", id]); return { restored: true }; },
    async permanentlyDelete(id) { calls.push(["delete", id]); return { deleted: true }; },
  };
  await withServer(imageTrash, async (baseUrl) => {
    const id = "c".repeat(32);
    const headers = { "content-type": "application/json", origin: baseUrl, "sec-fetch-site": "same-origin" };
    const wrong = await fetch(`${baseUrl}/api/images/trash/${id}/delete`, {
      method: "POST", headers,
      body: JSON.stringify({ confirmation: "restore-image-from-trash" }),
    });
    assert.equal(wrong.status, 400);
    const restored = await fetch(`${baseUrl}/api/images/trash/${id}/restore`, {
      method: "POST", headers,
      body: JSON.stringify({ confirmation: "restore-image-from-trash" }),
    });
    const deleted = await fetch(`${baseUrl}/api/images/trash/${id}/delete`, {
      method: "POST", headers,
      body: JSON.stringify({ confirmation: "permanently-delete-image" }),
    });
    assert.equal(restored.status, 200);
    assert.equal(deleted.status, 200);
    assert.deepEqual(calls, [["restore", id], ["delete", id]]);
  });
});
