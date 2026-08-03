import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { databaseSchemaVersion, openHubDatabase } from "../src/modules/database/hub-database.mjs";

test("허브 DB는 뉴스와 이미지 스키마를 반복 실행해도 한 번씩만 적용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-db-"));
  const filePath = path.join(root, "hub.sqlite");
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const database = openHubDatabase({ filePath, now: () => new Date("2026-08-01T00:00:00Z") });
      assert.equal(databaseSchemaVersion(database), 7);
      const migrations = database.prepare("SELECT version, name FROM schema_migrations").all();
      assert.equal(migrations.length, 7);
      assert.equal(database.prepare("PRAGMA table_info(dc_drafts)").all().some((column) => column.name === "layout_json"), true);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
      for (const expected of ["news_stories", "news_sources", "news_analysis", "news_approvals", "news_publications", "image_assets", "image_generation_metadata", "dc_uploads", "dc_drafts", "dc_draft_images"]) {
        assert.equal(tables.includes(expected), true);
      }
      assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
      database.prepare(`
        INSERT INTO image_assets (id, source, storage_key, file_name, indexed_at)
        VALUES (?, 'upload', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run("u".repeat(64), "2026-08-02/upload.png", "upload.png", "2026-08-02T00:00:00Z");
      assert.equal(
        database.prepare("SELECT source FROM image_assets WHERE id = ?").get("u".repeat(64)).source,
        "upload",
      );
      database.prepare(`
        INSERT INTO dc_drafts (id, gallery_id, head_text, title, body_text, status, created_at, updated_at)
        VALUES (?, 'chatgpt', '잡담', '제목', '본문', 'draft', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run("d".repeat(32), "2026-08-02T00:00:00Z", "2026-08-02T00:00:00Z");
      database.prepare(`
        INSERT INTO dc_draft_images (draft_id, position, source_type, source_id)
        VALUES (?, 49, 'archive', ?)
        ON CONFLICT(draft_id, position) DO NOTHING
      `).run("d".repeat(32), "a".repeat(64));
      assert.equal(database.prepare("SELECT position FROM dc_draft_images WHERE draft_id = ?").get("d".repeat(32)).position, 49);
      assert.throws(() => database.prepare(`
        INSERT INTO dc_draft_images (draft_id, position, source_type, source_id)
        VALUES (?, 50, 'archive', ?)
      `).run("d".repeat(32), "b".repeat(64)), /CHECK constraint failed/u);
      database.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("허브 DB는 상대경로를 거부한다", () => {
  assert.throws(() => openHubDatabase({ filePath: "state/hub.sqlite" }), /절대경로/);
});
