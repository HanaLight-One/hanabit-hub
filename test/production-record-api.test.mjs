import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { createProductionRecordStore } from "../src/modules/images/production-records.mjs";

const recordInput = {
  imageId: "image-20260729-001",
  jobId: "job-20260729-001",
  characters: ["헤일라", "리벨라"],
  relationGroup: "성녀 pair",
  style: "고딕",
  createdAt: "2026-07-28T17:17:00.000Z",
  durationMs: 154000,
  retryCount: 0,
};

async function withServer(recordStore, callback) {
  const server = createServer({ recordStore });
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

test("안전한 이미지 식별자로 제작 기록을 조회한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-record-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createProductionRecordStore({ root });
  await store.save(recordInput);

  await withServer(store, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/images/${recordInput.imageId}/production-record`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.record, { schemaVersion: 1, ...recordInput });
    assert.equal(JSON.stringify(body).includes(root), false);
  });
});

test("없는 제작 기록은 안전한 404 응답을 반환한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-record-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createProductionRecordStore({ root });

  await withServer(store, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/images/image-missing/production-record`,
    );
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, "제작 기록을 찾을 수 없습니다.");
    assert.equal(JSON.stringify(body).includes(root), false);
  });
});

test("경로 이탈 이미지 식별자를 거부한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-record-api-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createProductionRecordStore({ root });

  await withServer(store, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/images/${encodeURIComponent("../secret")}/production-record`,
    );

    assert.equal(response.status, 400);
  });
});

test("저장소가 연결되지 않았을 때 기능 존재를 노출하지 않는다", async () => {
  await withServer(null, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/images/image-20260729-001/production-record`,
    );
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, "Not found");
  });
});
