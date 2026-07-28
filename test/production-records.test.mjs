import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createProductionRecordStore,
  normalizeProductionRecord,
} from "../src/modules/images/production-records.mjs";

const validRecord = {
  imageId: "image-20260729-001",
  jobId: "job-20260729-001",
  characters: ["헤일라", "리벨라"],
  relationGroup: "성녀 pair",
  style: "고딕",
  createdAt: "2026-07-28T17:17:00.000Z",
  durationMs: 154000,
  retryCount: 0,
};

test("이미지 제작 기록을 안전한 형식으로 정규화한다", () => {
  const record = normalizeProductionRecord(validRecord);

  assert.deepEqual(record, {
    schemaVersion: 1,
    ...validRecord,
  });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.characters), true);
});

test("절대경로 같은 허용되지 않은 필드를 거부한다", () => {
  assert.throws(
    () => normalizeProductionRecord({ ...validRecord, absolutePath: "C:\\secret\\image.png" }),
    /허용되지 않은 제작 기록 필드/,
  );
});

test("경로로 해석될 수 있는 이미지 식별자를 거부한다", () => {
  assert.throws(
    () => normalizeProductionRecord({ ...validRecord, imageId: "../image.png" }),
    /안전한 영문·숫자 식별자/,
  );
});

test("제작 기록을 날짜 이미지와 별도의 JSON으로 보관한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-record-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createProductionRecordStore({ root });

  const saved = await store.save(validRecord);
  const loaded = await store.get(validRecord.imageId);
  const raw = JSON.parse(
    await readFile(path.join(root, `${validRecord.imageId}.json`), "utf8"),
  );

  assert.deepEqual(loaded, saved);
  assert.equal("absolutePath" in raw, false);
  assert.equal("prompt" in raw, false);
});
