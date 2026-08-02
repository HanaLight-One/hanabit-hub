import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: "news story ledger foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS news_stories (
        id TEXT PRIMARY KEY,
        story_key TEXT NOT NULL UNIQUE,
        canonical_title TEXT,
        status TEXT NOT NULL CHECK (status IN ('discovered', 'review', 'approved', 'published', 'blocked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS news_sources (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL REFERENCES news_stories(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('discord', 'x')),
        external_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        account TEXT,
        url TEXT,
        published_at TEXT NOT NULL,
        content_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (platform, external_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS news_sources_story_id_idx ON news_sources(story_id);
      CREATE INDEX IF NOT EXISTS news_sources_fingerprint_idx ON news_sources(content_fingerprint);

      CREATE TABLE IF NOT EXISTS news_analysis (
        story_id TEXT PRIMARY KEY REFERENCES news_stories(id) ON DELETE CASCADE,
        translation_title TEXT NOT NULL,
        translation_body TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('skip', 'review', 'publish')),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        reason TEXT NOT NULL,
        analyzed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS news_approvals (
        story_id TEXT PRIMARY KEY REFERENCES news_stories(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status = 'approved'),
        approved_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS news_publications (
        story_id TEXT PRIMARY KEY REFERENCES news_approvals(story_id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('posted', 'failed', 'ambiguous')),
        post_id TEXT UNIQUE,
        content_hash TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        CHECK (status <> 'posted' OR post_id IS NOT NULL)
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "image generation metadata catalog",
    sql: `
      CREATE TABLE IF NOT EXISTS image_assets (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('daily', 'pilot')),
        storage_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        UNIQUE (source, storage_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS image_generation_metadata (
        image_id TEXT PRIMARY KEY REFERENCES image_assets(id) ON DELETE CASCADE,
        job_id TEXT,
        prompt TEXT,
        character_mode TEXT NOT NULL CHECK (character_mode IN ('auto', 'none', 'custom', 'unknown')),
        character_ids_json TEXT NOT NULL,
        character_labels_json TEXT NOT NULL,
        style_mode TEXT NOT NULL CHECK (style_mode IN ('auto', 'none', 'selected', 'prompt', 'rendering', 'unknown')),
        style_id TEXT,
        style_label TEXT,
        relation_group TEXT,
        use_image_anchors INTEGER CHECK (use_image_anchors IN (0, 1) OR use_image_anchors IS NULL),
        purpose TEXT,
        generation_mode TEXT,
        created_at TEXT,
        duration_ms INTEGER CHECK (duration_ms >= 0 OR duration_ms IS NULL),
        retry_count INTEGER CHECK (retry_count >= 0 OR retry_count IS NULL),
        metadata_source TEXT NOT NULL CHECK (metadata_source IN ('hub-job', 'legacy-record')),
        indexed_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS image_generation_job_id_idx
        ON image_generation_metadata(job_id);
    `,
  },
  {
    version: 3,
    name: "daily image manifest metadata source",
    sql: `
      DROP INDEX IF EXISTS image_generation_job_id_idx;
      ALTER TABLE image_generation_metadata RENAME TO image_generation_metadata_v2;

      CREATE TABLE image_generation_metadata (
        image_id TEXT PRIMARY KEY REFERENCES image_assets(id) ON DELETE CASCADE,
        job_id TEXT,
        prompt TEXT,
        character_mode TEXT NOT NULL CHECK (character_mode IN ('auto', 'none', 'custom', 'unknown')),
        character_ids_json TEXT NOT NULL,
        character_labels_json TEXT NOT NULL,
        style_mode TEXT NOT NULL CHECK (style_mode IN ('auto', 'none', 'selected', 'prompt', 'rendering', 'unknown')),
        style_id TEXT,
        style_label TEXT,
        relation_group TEXT,
        use_image_anchors INTEGER CHECK (use_image_anchors IN (0, 1) OR use_image_anchors IS NULL),
        purpose TEXT,
        generation_mode TEXT,
        created_at TEXT,
        duration_ms INTEGER CHECK (duration_ms >= 0 OR duration_ms IS NULL),
        retry_count INTEGER CHECK (retry_count >= 0 OR retry_count IS NULL),
        metadata_source TEXT NOT NULL CHECK (metadata_source IN ('hub-job', 'daily-manifest', 'legacy-record')),
        indexed_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO image_generation_metadata SELECT * FROM image_generation_metadata_v2;
      DROP TABLE image_generation_metadata_v2;

      CREATE INDEX image_generation_job_id_idx
        ON image_generation_metadata(job_id);
    `,
  },
  {
    version: 4,
    name: "dc composer drafts and uploads",
    sql: `
      CREATE TABLE IF NOT EXISTS dc_uploads (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        storage_name TEXT NOT NULL UNIQUE,
        content_type TEXT NOT NULL CHECK (content_type IN ('image/gif', 'image/jpeg', 'image/png', 'image/webp')),
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS dc_drafts (
        id TEXT PRIMARY KEY,
        gallery_id TEXT NOT NULL CHECK (gallery_id = 'chatgpt'),
        head_text TEXT NOT NULL,
        title TEXT NOT NULL,
        body_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'submitting', 'posted', 'ambiguous', 'failed')),
        content_hash TEXT,
        post_id TEXT,
        post_url TEXT,
        submitted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS dc_draft_images (
        draft_id TEXT NOT NULL REFERENCES dc_drafts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0 AND position < 10),
        source_type TEXT NOT NULL CHECK (source_type IN ('archive', 'upload')),
        source_id TEXT NOT NULL,
        PRIMARY KEY (draft_id, position),
        UNIQUE (draft_id, source_type, source_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS dc_drafts_updated_at_idx ON dc_drafts(updated_at DESC);
    `,
  },
  {
    version: 5,
    name: "uploaded image asset source",
    sql: `
      DROP INDEX IF EXISTS image_generation_job_id_idx;
      ALTER TABLE image_generation_metadata RENAME TO image_generation_metadata_v4;
      ALTER TABLE image_assets RENAME TO image_assets_v4;

      CREATE TABLE image_assets (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('daily', 'pilot', 'upload')),
        storage_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        UNIQUE (source, storage_key)
      ) STRICT;

      CREATE TABLE image_generation_metadata (
        image_id TEXT PRIMARY KEY REFERENCES image_assets(id) ON DELETE CASCADE,
        job_id TEXT,
        prompt TEXT,
        character_mode TEXT NOT NULL CHECK (character_mode IN ('auto', 'none', 'custom', 'unknown')),
        character_ids_json TEXT NOT NULL,
        character_labels_json TEXT NOT NULL,
        style_mode TEXT NOT NULL CHECK (style_mode IN ('auto', 'none', 'selected', 'prompt', 'rendering', 'unknown')),
        style_id TEXT,
        style_label TEXT,
        relation_group TEXT,
        use_image_anchors INTEGER CHECK (use_image_anchors IN (0, 1) OR use_image_anchors IS NULL),
        purpose TEXT,
        generation_mode TEXT,
        created_at TEXT,
        duration_ms INTEGER CHECK (duration_ms >= 0 OR duration_ms IS NULL),
        retry_count INTEGER CHECK (retry_count >= 0 OR retry_count IS NULL),
        metadata_source TEXT NOT NULL CHECK (metadata_source IN ('hub-job', 'daily-manifest', 'legacy-record')),
        indexed_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO image_assets SELECT * FROM image_assets_v4;
      INSERT INTO image_generation_metadata SELECT * FROM image_generation_metadata_v4;
      DROP TABLE image_generation_metadata_v4;
      DROP TABLE image_assets_v4;

      CREATE INDEX image_generation_job_id_idx
        ON image_generation_metadata(job_id);
    `,
  },
]);

function migrate(database, now) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()
      .map((row) => Number(row.version)),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, now().toISOString());
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openHubDatabase({ filePath, now = () => new Date() }) {
  if (!path.isAbsolute(filePath)) throw new TypeError("허브 DB는 절대경로여야 합니다.");
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA busy_timeout = 5000");
    migrate(database, now);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function databaseSchemaVersion(database) {
  return Number(database.prepare("PRAGMA user_version").get().user_version);
}
