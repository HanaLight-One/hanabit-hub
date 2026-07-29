import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";

async function withServer(archive, callback) {
  const server = createServer({ archive });
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

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-content-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const daily = path.join(root, "daily");
  const pilot = path.join(root, "pilot");
  await mkdir(path.join(daily, "2026-07-29"), { recursive: true });
  await mkdir(pilot, { recursive: true });
  const content = Buffer.from("fake-png-content");
  await writeFile(path.join(daily, "2026-07-29", "heila.png"), content);
  const archive = createImageArchive({
    dailyImagesRoot: daily,
    pilotImagesRoot: pilot,
  });
  return { archive, content, root };
}

test("이미지 ID로 원본 파일을 읽기 전용 스트리밍한다", async (context) => {
  const { archive, content, root } = await fixture(context);
  const { images } = await archive.list();

  await withServer(archive, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${images[0].contentUrl}`);
    const body = Buffer.from(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(body, content);
    assert.equal(response.headers.get("cache-control"), "private, max-age=60");
    assert.equal([...response.headers.values()].join(" ").includes(root), false);
  });
});

test("잘못되거나 없는 이미지 ID를 안전하게 거부한다", async (context) => {
  const { archive } = await fixture(context);

  await withServer(archive, async (baseUrl) => {
    const invalid = await fetch(
      `${baseUrl}/api/images/${encodeURIComponent("../secret")}/content`,
    );
    const missing = await fetch(
      `${baseUrl}/api/images/${"0".repeat(64)}/content`,
    );

    assert.equal(invalid.status, 400);
    assert.equal(missing.status, 404);
  });
});

test("원본 이미지 API는 쓰기 요청을 거부한다", async (context) => {
  const { archive } = await fixture(context);
  const { images } = await archive.list();

  await withServer(archive, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${images[0].contentUrl}`, {
      method: "DELETE",
    });
    assert.equal(response.status, 405);
  });
});
