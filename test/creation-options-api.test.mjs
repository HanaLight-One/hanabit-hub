import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(creationOptionsCatalog, callback) {
  const server = createServer({ creationOptionsCatalog });
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

test("추가생성 옵션 API가 화풍 목록을 제공한다", async () => {
  const catalog = {
    async list() {
      return { styles: [{ id: "고딕", label: "고딕" }] };
    },
  };

  await withServer(catalog, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/creation-options`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.styles, [{ id: "고딕", label: "고딕" }]);
  });
});

test("추가생성 옵션 API가 쓰기 요청을 거부한다", async () => {
  const catalog = { async list() {} };

  await withServer(catalog, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/creation-options`, {
      method: "POST",
    });
    assert.equal(response.status, 405);
  });
});

test("화풍 연동이 없으면 옵션 API를 노출하지 않는다", async () => {
  await withServer(null, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/images/creation-options`);
    assert.equal(response.status, 404);
  });
});
