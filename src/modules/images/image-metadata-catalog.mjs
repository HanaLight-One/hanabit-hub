import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const JOB_FILE_PATTERN = /^[a-f0-9]{32}\.json$/u;
const DATE_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_JOB_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const CHARACTER_MODES = new Set(["auto", "none", "custom"]);
const STYLE_MODES = new Set(["auto", "none", "selected", "prompt", "rendering"]);

function safeText(value, maximum) {
  const result = String(value ?? "").trim();
  return result && result.length <= maximum ? result : null;
}

function safePrompt(value) {
  const prompt = safeText(value, 12_000);
  if (!prompt) return null;
  const internalPath = /(?:[a-z]:[\\/]|file:\/\/|\\\\)/iu;
  const sanitized = prompt
    .split(/\r?\n/u)
    .map((line) => internalPath.test(line) ? "[내부 참조 경로 숨김]" : line)
    .filter((line, index, lines) => line !== "[내부 참조 경로 숨김]" || lines[index - 1] !== line)
    .join("\n")
    .trim();
  return sanitized || null;
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function elapsed(startedAt, completedAt) {
  const start = Date.parse(startedAt ?? "");
  const end = Date.parse(completedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function parseArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function publicRecord(row) {
  if (!row) return null;
  return Object.freeze({
    schemaVersion: 2,
    imageId: row.image_id,
    jobId: row.job_id,
    prompt: row.prompt,
    characterIds: Object.freeze(parseArray(row.character_ids_json)),
    characters: Object.freeze(parseArray(row.character_labels_json)),
    characterMode: row.character_mode,
    relationGroup: row.relation_group,
    style: row.style_label,
    styleMode: row.style_mode,
    styleId: row.style_id,
    useImageAnchors: row.use_image_anchors == null ? null : row.use_image_anchors === 1,
    purpose: row.purpose,
    generationMode: row.generation_mode,
    createdAt: row.created_at,
    durationMs: row.duration_ms,
    retryCount: row.retry_count,
    metadataSource: row.metadata_source,
  });
}

export function createImageMetadataCatalog({ database, archive, jobRoot, dailyManifestRoot = null, optionsCatalog = null, legacyStore = null, now = () => new Date() }) {
  if (!database || !archive?.findByTarget || !archive?.listIndexable) throw new TypeError("이미지 DB와 아카이브가 필요합니다.");
  if (!path.isAbsolute(jobRoot ?? "")) throw new TypeError("이미지 작업 루트는 절대경로여야 합니다.");
  if (dailyManifestRoot != null && !path.isAbsolute(dailyManifestRoot)) {
    throw new TypeError("Daily manifest root must be an absolute path.");
  }
  let syncInFlight = null;

  async function labels() {
    try {
      const options = optionsCatalog ? await optionsCatalog.list() : { characters: [], styles: [] };
      return {
        characters: new Map(options.characters.map((item) => [item.id, item.label])),
        styles: new Map(options.styles.map((item) => [item.id, item.label])),
      };
    } catch {
      return { characters: new Map(), styles: new Map() };
    }
  }

  function upsert(image, job, optionLabels, metadataSource = "hub-job") {
    const characterMode = CHARACTER_MODES.has(job.characters?.mode) ? job.characters.mode : "unknown";
    const characterIds = characterMode === "custom"
      ? [...new Set((Array.isArray(job.characters?.ids) ? job.characters.ids : []).map((value) => safeText(value, 80)).filter(Boolean))].slice(0, 20)
      : [];
    const characterLabels = characterIds.map((id) => optionLabels.characters.get(id) ?? id);
    let styleMode = "unknown";
    let styleId = null;
    if (job.style && typeof job.style === "object" && STYLE_MODES.has(job.style.mode)) {
      styleMode = job.style.mode;
      styleId = safeText(job.style.id, 120);
    } else if (typeof job.style === "string" && safeText(job.style, 120)) {
      styleMode = "selected";
      styleId = safeText(job.style, 120);
    }
    const styleLabel = styleId == null ? null : optionLabels.styles.get(styleId) ?? styleId;
    const indexedAt = now().toISOString();
    const prompt = safePrompt(job.prompt);
    const createdAt = safeDate(job.completedAt ?? job.startedAt ?? job.createdAt);
    const durationMs = elapsed(job.startedAt ?? job.createdAt, job.completedAt);
    const retryCount = Number.isInteger(job.retryCount) && job.retryCount >= 0 ? job.retryCount : null;
    const useImageAnchors = typeof job.useImageAnchors === "boolean" ? Number(job.useImageAnchors) : null;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO image_assets (id, source, storage_key, file_name, indexed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source = excluded.source,
          storage_key = excluded.storage_key,
          file_name = excluded.file_name,
          indexed_at = excluded.indexed_at
      `).run(image.record.id, image.record.source, image.storageKey, image.record.name, indexedAt);
      database.prepare(`
        INSERT INTO image_generation_metadata (
          image_id, job_id, prompt, character_mode, character_ids_json,
          character_labels_json, style_mode, style_id, style_label,
          relation_group, use_image_anchors, purpose, generation_mode, created_at, duration_ms,
          retry_count, metadata_source, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(image_id) DO UPDATE SET
          job_id = excluded.job_id,
          prompt = excluded.prompt,
          character_mode = excluded.character_mode,
          character_ids_json = excluded.character_ids_json,
          character_labels_json = excluded.character_labels_json,
          style_mode = excluded.style_mode,
          style_id = excluded.style_id,
          style_label = excluded.style_label,
          relation_group = excluded.relation_group,
          use_image_anchors = excluded.use_image_anchors,
          purpose = excluded.purpose,
          generation_mode = excluded.generation_mode,
          created_at = excluded.created_at,
          duration_ms = excluded.duration_ms,
          retry_count = excluded.retry_count,
          metadata_source = excluded.metadata_source,
          indexed_at = excluded.indexed_at
      `).run(
        image.record.id,
        safeText(job.id, 128),
        prompt,
        characterMode,
        JSON.stringify(characterIds),
        JSON.stringify(characterLabels),
        styleMode,
        styleId,
        styleLabel,
        safeText(job.relationGroup, 120),
        useImageAnchors,
        safeText(job.purpose, 80),
        safeText(job.executionMode ?? job.mode, 80),
        createdAt,
        durationMs,
        retryCount,
        metadataSource,
        indexedAt,
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  async function synchronizeDailyManifests(optionLabels) {
    if (!dailyManifestRoot) return 0;
    let directories;
    try {
      directories = await readdir(dailyManifestRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }

    let metadata = 0;
    for (const directory of directories) {
      if (!directory.isDirectory() || !DATE_DIRECTORY_PATTERN.test(directory.name)) continue;
      const datedRoot = path.join(dailyManifestRoot, directory.name);
      const manifestPath = path.join(datedRoot, "manifest.json");
      try {
        const info = await stat(manifestPath);
        if (info.size > MAX_MANIFEST_BYTES) continue;
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (
          manifest.status !== "complete" ||
          manifest.production_eligible !== true ||
          manifest.test_run === true ||
          !Array.isArray(manifest.jobs)
        ) continue;

        for (const manifestJob of manifest.jobs.slice(0, 64)) {
          if (manifestJob?.status !== "complete") continue;
          const relativeOutput = safeText(manifestJob.final_output ?? manifestJob.output, 512);
          if (!relativeOutput || path.isAbsolute(relativeOutput)) continue;
          const output = path.resolve(datedRoot, relativeOutput);
          if (output !== datedRoot && !output.startsWith(`${datedRoot}${path.sep}`)) continue;
          const image = await archive.findByTarget(output);
          if (!image) continue;
          const characters = Array.isArray(manifestJob.characters)
            ? manifestJob.characters.map((value) => safeText(value, 80)).filter(Boolean)
            : [];
          const styleId = safeText(manifestJob.style_id, 120);
          const rendering = safeText(manifestJob.rendering, 120);
          const attempts = Number.isInteger(manifestJob.attempts) && manifestJob.attempts > 0
            ? manifestJob.attempts
            : null;
          upsert(image, {
            id: `${manifest.date ?? directory.name}/${manifestJob.id ?? path.basename(relativeOutput)}`,
            prompt: manifestJob.final_prompt,
            characters: { mode: characters.length ? "custom" : "none", ids: characters },
            style: styleId
              ? { mode: "selected", id: styleId }
              : rendering
                ? { mode: "rendering", id: rendering }
                : { mode: "none" },
            relationGroup: manifestJob.relationship?.id,
            useImageAnchors: Boolean(manifestJob.requires_reference_inspection),
            purpose: "daily-theme",
            executionMode: manifestJob.group,
            startedAt: manifestJob.attempt_started_at,
            completedAt: manifestJob.completed_at,
            retryCount: attempts == null ? null : attempts - 1,
          }, optionLabels, "daily-manifest");
          metadata += 1;
        }
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }
    return metadata;
  }

  async function synchronize() {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      const indexedAt = now().toISOString();
      const assets = await archive.listIndexable();
      const saveAsset = database.prepare(`
        INSERT INTO image_assets (id, source, storage_key, file_name, indexed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source = excluded.source,
          storage_key = excluded.storage_key,
          file_name = excluded.file_name,
          indexed_at = excluded.indexed_at
      `);
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const image of assets) {
          saveAsset.run(
            image.record.id,
            image.record.source,
            image.storageKey,
            image.record.name,
            indexedAt,
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      let entries;
      try {
        entries = await readdir(jobRoot, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") entries = [];
        else throw error;
      }
      const optionLabels = await labels();
      let metadata = 0;
      for (const entry of entries) {
        if (!entry.isFile() || !JOB_FILE_PATTERN.test(entry.name)) continue;
        const target = path.join(jobRoot, entry.name);
        try {
          const info = await stat(target);
          if (info.size > MAX_JOB_BYTES) continue;
          const job = JSON.parse(await readFile(target, "utf8"));
          if (job.status !== "complete" || !Array.isArray(job.outputs)) continue;
          for (const output of job.outputs.slice(0, 20)) {
            if (!path.isAbsolute(output ?? "")) continue;
            const image = await archive.findByTarget(output);
            if (!image) continue;
            upsert(image, job, optionLabels);
            metadata += 1;
          }
        } catch (error) {
          if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
      }
      metadata += await synchronizeDailyManifests(optionLabels);
      return { assets: assets.length, metadata };
    })();
    try {
      return await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }

  async function get(imageId) {
    const statement = database.prepare(
      "SELECT * FROM image_generation_metadata WHERE image_id = ?",
    );
    let row = statement.get(String(imageId ?? ""));
    if (!row) {
      await synchronize();
      row = statement.get(String(imageId ?? ""));
    }
    if (row) return publicRecord(row);
    return legacyStore ? legacyStore.get(imageId) : null;
  }

  return Object.freeze({ get, synchronize });
}
