import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(manager, callback) {
  const server = createServer({ archive: null, sourceUploadManager: manager });
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

test("소스 업로드 API는 같은 출처와 명시적 확인값을 요구한다", async () => {
  const calls = [];
  const manager = {
    async upload(input) {
      calls.push(input);
      return { uploaded: true, image: { id: "a".repeat(64), source: "upload" } };
    },
  };
  await withServer(manager, async (baseUrl) => {
    const rejected = await fetch(`${baseUrl}/api/images/source-uploads`, {
      method: "POST",
      body: Buffer.from("image"),
    });
    assert.equal(rejected.status, 403);

    const accepted = await fetch(`${baseUrl}/api/images/source-uploads`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "sec-fetch-site": "same-origin",
        "content-type": "image/png",
        "x-source-upload-confirmation": "upload-generation-source",
        "x-source-file-name": encodeURIComponent("참조.png"),
      },
      body: Buffer.from("image"),
    });
    assert.equal(accepted.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].originalName, "참조.png");
    assert.equal(calls[0].buffer.toString(), "image");
  });
});
