const ID_PATTERN = /^[a-f0-9]{32}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function id(value, label) {
  const result = String(value ?? "");
  if (!ID_PATTERN.test(result)) throw new TypeError(`${label} ID가 올바르지 않습니다.`);
  return result;
}

function text(value, maximum, label) {
  const result = String(value ?? "").trim();
  if (!result || result.length > maximum) throw new TypeError(`${label} 값이 올바르지 않습니다.`);
  return result;
}

export function createNewsLedger({ database, now = () => new Date() }) {
  function registerStory({ id: storyId, storyKey, title = null }) {
    const timestamp = now().toISOString();
    database.prepare(`
      INSERT INTO news_stories
        (id, story_key, canonical_title, status, created_at, updated_at)
      VALUES (?, ?, ?, 'discovered', ?, ?)
    `).run(
      id(storyId, "뉴스 사건"),
      text(storyKey, 200, "뉴스 사건 키"),
      title == null ? null : text(title, 200, "뉴스 제목"),
      timestamp,
      timestamp,
    );
    return storyId;
  }

  function attachSource({ id: sourceId, storyId, platform, externalId, sourceType, account = null, url = null, publishedAt, contentFingerprint }) {
    if (!new Set(["discord", "x"]).has(platform)) throw new TypeError("뉴스 플랫폼이 올바르지 않습니다.");
    database.prepare(`
      INSERT INTO news_sources
        (id, story_id, platform, external_id, source_type, account, url, published_at, content_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id(sourceId, "뉴스 출처"),
      id(storyId, "뉴스 사건"),
      platform,
      text(externalId, 200, "외부 출처"),
      text(sourceType, 80, "출처 종류"),
      account == null ? null : text(account, 80, "출처 계정"),
      url == null ? null : text(url, 2_048, "출처 URL"),
      text(publishedAt, 40, "게시 시각"),
      text(contentFingerprint, 200, "본문 지문"),
      now().toISOString(),
    );
    return sourceId;
  }

  function approveStory(storyId) {
    const safeId = id(storyId, "뉴스 사건");
    const timestamp = now().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(
        "INSERT INTO news_approvals (story_id, status, approved_at) VALUES (?, 'approved', ?)",
      ).run(safeId, timestamp);
      database.prepare(
        "UPDATE news_stories SET status = 'approved', updated_at = ? WHERE id = ?",
      ).run(timestamp, safeId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function recordPublication({ storyId, status, postId = null, contentHash }) {
    const safeId = id(storyId, "뉴스 사건");
    if (!new Set(["posted", "failed", "ambiguous"]).has(status)) throw new TypeError("게시 상태가 올바르지 않습니다.");
    if (!HASH_PATTERN.test(String(contentHash ?? ""))) throw new TypeError("게시 본문 해시가 올바르지 않습니다.");
    const timestamp = now().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO news_publications
          (story_id, status, post_id, content_hash, submitted_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(safeId, status, postId == null ? null : text(postId, 100, "게시물 ID"), contentHash, timestamp);
      if (status === "posted") {
        database.prepare(
          "UPDATE news_stories SET status = 'published', updated_at = ? WHERE id = ?",
        ).run(timestamp, safeId);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return Object.freeze({ registerStory, attachSource, approveStory, recordPublication });
}
