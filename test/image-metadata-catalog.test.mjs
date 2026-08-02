import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openHubDatabase } from "../src/modules/database/hub-database.mjs";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";
import { createImageMetadataCatalog } from "../src/modules/images/image-metadata-catalog.mjs";

test("완료된 Hub 작업을 이미지 ID와 연결해 프롬프트와 선택 정보를 DB에 색인한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-image-db-"));
  const imageRoot = path.join(root, "images");
  const jobRoot = path.join(root, "jobs");
  const output = path.join(imageRoot, "2026-08-01", "extra-requests", "free-play", "job-a", "result.png");
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(jobRoot, { recursive: true });
  await writeFile(output, "image", "utf8");
  const jobId = "a".repeat(32);
  await writeFile(path.join(jobRoot, `${jobId}.json`), JSON.stringify({
    id: jobId,
    status: "complete",
    prompt: "고딕 다과회에서 서로 웃고 있는 세 사람",
    characters: { mode: "custom", ids: ["pink-bridge", "헤일라", "리벨라"] },
    style: { mode: "selected", id: "gothic", ids: ["gothic", "watercolor"] },
    useImageAnchors: true,
    purpose: "free-play",
    executionMode: "guided-cast",
    startedAt: "2026-08-01T02:00:00.000Z",
    completedAt: "2026-08-01T02:02:34.000Z",
    outputs: [output],
  }), "utf8");

  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  const archive = createImageArchive({ dailyImagesRoot: imageRoot });
  const optionsCatalog = { async list() { return {
    characters: [
      { id: "pink-bridge", label: "핑크브릿지" },
      { id: "헤일라", label: "헤일라" },
      { id: "리벨라", label: "리벨라" },
    ],
    styles: [
      { id: "gothic", label: "고딕" },
      { id: "watercolor", label: "수채화" },
    ],
  }; } };
  try {
    const catalog = createImageMetadataCatalog({ database, archive, jobRoot, optionsCatalog });
    assert.deepEqual(await catalog.synchronize(), { assets: 1, metadata: 1 });
    const image = (await archive.list()).images[0];
    const record = await catalog.get(image.id);

    assert.equal(record.prompt, "고딕 다과회에서 서로 웃고 있는 세 사람");
    assert.deepEqual(catalog.availableImageIds(), [image.id]);
    assert.deepEqual(record.characterIds, ["pink-bridge", "헤일라", "리벨라"]);
    assert.deepEqual(record.characters, ["핑크브릿지", "헤일라", "리벨라"]);
    assert.equal(record.style, "고딕 + 수채화");
    assert.equal(record.styleId, "gothic + watercolor");
    assert.equal(record.styleMode, "selected");
    assert.equal(record.useImageAnchors, true);
    assert.equal(record.durationMs, 154_000);
    assert.equal(record.retryCount, null);
    const stored = database.prepare("SELECT storage_key FROM image_assets WHERE id = ?").get(image.id);
    assert.equal(stored.storage_key, "2026-08-01/extra-requests/free-play/job-a/result.png");
    assert.equal(stored.storage_key.includes(root), false);
    catalog.deleteImage(image.id);
    assert.deepEqual(catalog.availableImageIds(), []);
    assert.equal(database.prepare("SELECT id FROM image_assets WHERE id = ?").get(image.id), undefined);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("완료된 운영 오테 manifest만 이미지 제작 기록으로 연결한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-daily-manifest-db-"));
  const imageRoot = path.join(root, "daily-v2");
  const jobRoot = path.join(root, "hub-jobs");
  const datedRoot = path.join(imageRoot, "2026-08-01");
  const output = path.join(datedRoot, "05_chapel-text-styled", "01.png");
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(jobRoot, { recursive: true });
  await writeFile(output, "image", "utf8");
  await writeFile(path.join(datedRoot, "manifest.json"), JSON.stringify({
    date: "2026-08-01",
    status: "complete",
    production_eligible: true,
    test_run: false,
    jobs: [{
      id: "11-05_chapel-text-styled-01",
      status: "complete",
      final_output: "05_chapel-text-styled/01.png",
      final_prompt: "성당 다과회\nReference: C:\\private\\anchors\\heila.png\n따뜻한 오후",
      characters: ["헤일라", "리벨라"],
      relationship: { id: "saintess_friends_heila_ribella" },
      style_id: "고딕",
      rendering: "selected style preset",
      requires_reference_inspection: false,
      group: "05_chapel-text-styled",
      attempts: 2,
      attempt_started_at: "2026-08-01T02:00:00.000Z",
      completed_at: "2026-08-01T02:02:34.000Z",
    }],
  }), "utf8");

  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  const archive = createImageArchive({ dailyImagesRoot: imageRoot });
  try {
    const catalog = createImageMetadataCatalog({ database, archive, jobRoot, dailyManifestRoot: imageRoot });
    assert.deepEqual(await catalog.synchronize(), { assets: 1, metadata: 1 });
    const image = (await archive.list()).images[0];
    const record = await catalog.get(image.id);
    assert.equal(record.prompt, "성당 다과회\n[내부 참조 경로 숨김]\n따뜻한 오후");
    assert.equal(record.prompt.includes("C:\\"), false);
    assert.deepEqual(record.characters, ["헤일라", "리벨라"]);
    assert.equal(record.style, "고딕");
    assert.equal(record.relationGroup, "saintess_friends_heila_ribella");
    assert.equal(record.useImageAnchors, false);
    assert.equal(record.durationMs, 154_000);
    assert.equal(record.retryCount, 1);
    assert.equal(record.metadataSource, "daily-manifest");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("아카이브 밖 결과 경로와 완료되지 않은 작업은 색인하지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-image-db-boundary-"));
  const imageRoot = path.join(root, "images");
  const jobRoot = path.join(root, "jobs");
  await mkdir(imageRoot, { recursive: true });
  await mkdir(jobRoot, { recursive: true });
  const outside = path.join(root, "outside.png");
  await writeFile(outside, "image", "utf8");
  await writeFile(path.join(jobRoot, `${"b".repeat(32)}.json`), JSON.stringify({
    id: "b".repeat(32), status: "complete", outputs: [outside], prompt: "외부 결과",
  }), "utf8");
  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  try {
    const catalog = createImageMetadataCatalog({
      database,
      archive: createImageArchive({ dailyImagesRoot: imageRoot }),
      jobRoot,
    });
    assert.deepEqual(await catalog.synchronize(), { assets: 0, metadata: 0 });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM image_assets").get().count, 0);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("직접 업로드 소스를 이미지 자산 DB에 안전하게 색인한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-upload-image-db-"));
  const uploadRoot = path.join(root, "uploads");
  const jobRoot = path.join(root, "jobs");
  await mkdir(path.join(uploadRoot, "2026-08-02"), { recursive: true });
  await mkdir(jobRoot, { recursive: true });
  await writeFile(path.join(uploadRoot, "2026-08-02", "reference.png"), "image", "utf8");
  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  const archive = createImageArchive({ sourceUploadsRoot: uploadRoot });
  try {
    const catalog = createImageMetadataCatalog({ database, archive, jobRoot });
    assert.deepEqual(await catalog.synchronize(), { assets: 1, metadata: 0 });
    const stored = database.prepare("SELECT source, storage_key FROM image_assets").get();
    assert.equal(stored.source, "upload");
    assert.equal(stored.storage_key, "2026-08-02/reference.png");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
