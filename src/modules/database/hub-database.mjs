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
