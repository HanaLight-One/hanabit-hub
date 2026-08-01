import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { databaseSchemaVersion, openHubDatabase } from "../src/modules/database/hub-database.mjs";

test("허브 DB는 뉴스 원장 스키마를 반복 실행해도 한 번만 적용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-db-"));
  const filePath = path.join(root, "hub.sqlite");
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const database = openHubDatabase({ filePath, now: () => new Date("2026-08-01T00:00:00Z") });
      assert.equal(databaseSchemaVersion(database), 1);
      const migrations = database.prepare("SELECT version, name FROM schema_migrations").all();
      assert.equal(migrations.length, 1);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
      for (const expected of ["news_stories", "news_sources", "news_analysis", "news_approvals", "news_publications"]) {
        assert.equal(tables.includes(expected), true);
      }
      assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
      database.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("허브 DB는 상대경로를 거부한다", () => {
  assert.throws(() => openHubDatabase({ filePath: "state/hub.sqlite" }), /절대경로/);
});
