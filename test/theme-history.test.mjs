import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createThemeHistory } from "../src/modules/images/theme-history.mjs";

test("02시 전 관측한 테마를 전날 날짜로 보관한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-theme-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const history = createThemeHistory({ root });

  const saved = await history.record("잠들기 전의 작은 별빛", new Date("2026-07-28T16:30:00Z"));

  assert.deepEqual(await history.get("2026-07-28"), saved);
  assert.equal(await history.get("2026-07-29"), null);
  assert.equal("path" in saved, false);
});

test("같은 테마를 다시 관측하면 최초 시각을 보존한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-theme-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const history = createThemeHistory({ root });

  const first = await history.record("푸른 새벽", new Date("2026-07-28T17:00:00Z"));
  const second = await history.record("푸른 새벽", new Date("2026-07-28T18:00:00Z"));

  assert.equal(second.firstObservedAt, first.firstObservedAt);
  assert.equal(second.lastObservedAt, "2026-07-28T18:00:00.000Z");
});

test("저장 파일에도 내부 절대경로를 기록하지 않는다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-theme-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const history = createThemeHistory({ root });

  await history.record("여름빛 정원", new Date("2026-07-28T17:00:00Z"));
  const stored = JSON.parse(await readFile(path.join(root, "2026-07-29.json"), "utf8"));

  assert.deepEqual(Object.keys(stored).sort(), [
    "date",
    "firstObservedAt",
    "lastObservedAt",
    "schemaVersion",
    "theme",
  ]);
});
