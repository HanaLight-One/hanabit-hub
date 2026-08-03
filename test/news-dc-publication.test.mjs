import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNewsDcPublicationService } from "../src/modules/news/news-dc-publication.mjs";

const ID = "b".repeat(32);

async function fixture({ approved = true, withMedia = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-dc-"));
  const publisherRoot = path.join(root, "publisher");
  const coverRoot = path.join(root, "covers");
  const itemRoot = path.join(root, "news", "pending", ID);
  const scriptPath = path.join(root, "publish.cjs");
  await mkdir(path.join(itemRoot, "media"), { recursive: true });
  await mkdir(publisherRoot, { recursive: true });
  await mkdir(coverRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(publisherRoot, "package.json"), "{}", "utf8"),
    writeFile(path.join(publisherRoot, ".env"), "PUBLISH_DRY_RUN=false", "utf8"),
    writeFile(scriptPath, "test", "utf8"),
    writeFile(path.join(coverRoot, "news.png"), "cover", "utf8"),
    ...(withMedia ? [writeFile(path.join(itemRoot, "media", "01.png"), "image", "utf8")] : []),
  ]);
  await writeFile(path.join(itemRoot, "item.json"), JSON.stringify({
    id: ID,
    source: { type: "x-post", account: "OpenAI", url: "https://x.com/OpenAI/status/123", publishedAt: "2026-08-02T00:00:00Z" },
    original: { links: [], contexts: [] },
    workflow: {
      status: approved ? "approved_for_dc" : "pending_review",
      translation: { title: "새 소식", body: "번역 본문" },
      triage: { decision: "publish", evidenceTag: "official", boardCategory: "news", reason: "공식 소식", advice: "세부 범위는 확인 필요" },
      analysisNotice: "주의: 아래 해설은 GPT-5.4 mini가 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다.",
      dcApproval: approved ? { status: "approved", approvedAt: "2026-08-02T00:01:00Z" } : null,
      dcPublication: null,
    },
    media: withMedia ? [{ file: "media/01.png", contentType: "image/png" }] : [],
  }), "utf8");
  return { root, newsRoot: path.join(root, "news"), publisherRoot, scriptPath, itemRoot, coverRoot };
}

test("미리보기는 실제 게시 없이 안전한 공개 원고만 반환한다", async () => {
  const sample = await fixture({ approved: false });
  try {
    let runs = 0;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      runPublisher: async () => { runs += 1; },
    });
    const preview = await service.preview(ID);
    assert.equal(preview.headText, "뉴스/소식");
    assert.equal(preview.title, "[공식] 새 소식");
    assert.equal(preview.approvalRequired, true);
    assert.equal(preview.publisherReady, true);
    assert.equal(preview.canPublish, true);
    assert.equal(preview.imageCount, 1);
    assert.equal(JSON.stringify(preview).includes(sample.root), false);
    assert.equal(runs, 0);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("원문 이미지가 없으면 말머리 기본 커버를 미리보기와 게시 작업에만 추가한다", async () => {
  const sample = await fixture({ withMedia: false });
  try {
    let publishedMedia;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      async runPublisher({ jobPath }) {
        const job = JSON.parse(await readFile(jobPath, "utf8"));
        publishedMedia = job.media;
        await writeFile(job.resultPath, JSON.stringify({
          status: "posted",
          postId: "123457",
          url: "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=123457",
        }), "utf8");
      },
    });
    const preview = await service.preview(ID);
    assert.deepEqual(preview.fallbackCover, {
      used: true,
      id: "news",
      url: "/api/news/dc-covers/news",
    });
    assert.equal(preview.imageCount, 1);
    await service.publish(ID);
    assert.equal(publishedMedia.length, 1);
    assert.equal(publishedMedia[0].filename, "news.png");
    assert.equal(publishedMedia[0].contentType, "image/png");
    const saved = JSON.parse(await readFile(path.join(sample.itemRoot, "item.json"), "utf8"));
    assert.deepEqual(saved.media, []);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("승인된 원고는 게시자를 한 번만 실행하고 게시 영수증을 저장한다", async () => {
  const sample = await fixture();
  try {
    let runs = 0;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      now: () => new Date("2026-08-02T03:00:00.000Z"),
      async runPublisher({ jobPath }) {
        runs += 1;
        const job = JSON.parse(await readFile(jobPath, "utf8"));
        assert.equal(job.headTextName, "뉴스/소식");
        await writeFile(job.resultPath, JSON.stringify({
          status: "posted",
          postId: "123456",
          url: "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=123456",
        }), "utf8");
      },
    });
    const result = await service.publish(ID);
    const saved = JSON.parse(await readFile(path.join(sample.itemRoot, "item.json"), "utf8"));
    assert.equal(runs, 1);
    assert.equal(result.publication.status, "posted");
    assert.equal(result.publication.postId, "123456");
    assert.equal(saved.workflow.status, "published");
    assert.equal(saved.workflow.dcPublication.contentHash.length, 64);
    await assert.rejects(() => service.publish(ID), { code: "ALREADY_SUBMITTED" });
    assert.equal(runs, 1);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("X 영상 GIF는 embed 미리보기만 교체하고 posted 영수증 뒤 정리한다", async () => {
  const sample = await fixture();
  try {
    const itemPath = path.join(sample.itemRoot, "item.json");
    const item = JSON.parse(await readFile(itemPath, "utf8"));
    item.media[0].kind = "embed-image";
    item.internal = { xVideo: { variantUrl: "https://video.twimg.com/a/video.mp4", durationMs: 3_000 } };
    await writeFile(itemPath, JSON.stringify(item), "utf8");
    let publishedMedia;
    let publishedBody;
    let cleaned = false;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      videoPreviewService: {
        async prepare(_record, { jobRoot }) {
          const target = path.join(jobRoot, "x-video-preview.gif");
          await writeFile(target, "gif", "utf8");
          return { target, filename: "x-video-preview.gif", contentType: "image/gif" };
        },
        async cleanup() { cleaned = true; },
      },
      async runPublisher({ jobPath }) {
        const job = JSON.parse(await readFile(jobPath, "utf8"));
        publishedMedia = job.media;
        publishedBody = job.bodyText;
        await writeFile(job.resultPath, JSON.stringify({
          status: "posted",
          postId: "123459",
          url: "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=123459",
        }), "utf8");
      },
    });
    await service.publish(ID);
    assert.equal(publishedMedia.length, 1);
    assert.equal(publishedMedia[0].filename, "x-video-preview.gif");
    assert.match(publishedBody, /영상 미리보기 안내/u);
    assert.match(publishedBody, /소리 없는 미리보기/u);
    assert.doesNotMatch(publishedBody, /최대 60초/u);
    assert.equal(cleaned, true);
    const saved = JSON.parse(await readFile(itemPath, "utf8"));
    assert.equal(saved.media[0].file, "media/01.png");
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("X 영상 변환 실패 시 기본 커버로 복귀하고 GIF 안내를 넣지 않는다", async () => {
  const sample = await fixture({ withMedia: false });
  try {
    const itemPath = path.join(sample.itemRoot, "item.json");
    const item = JSON.parse(await readFile(itemPath, "utf8"));
    item.internal = { xVideo: { variantUrl: "https://video.twimg.com/a/video.mp4", durationMs: 30_000 } };
    await writeFile(itemPath, JSON.stringify(item), "utf8");
    let job;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      videoPreviewService: { async prepare() { return null; } },
      async runPublisher({ jobPath }) {
        job = JSON.parse(await readFile(jobPath, "utf8"));
        await writeFile(job.resultPath, JSON.stringify({
          status: "posted",
          postId: "123460",
          url: "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=123460",
        }), "utf8");
      },
    });
    await service.publish(ID);
    assert.equal(job.media.length, 1);
    assert.equal(job.media[0].filename, "news.png");
    assert.doesNotMatch(job.bodyText, /영상 미리보기 안내/u);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("자동 게시 시작 뒤 품질 관문을 통과한 새 뉴스만 승인 없이 한 번 게시한다", async () => {
  const sample = await fixture({ approved: false });
  let runs = 0;
  try {
    const itemPath = path.join(sample.itemRoot, "item.json");
    const item = JSON.parse(await readFile(itemPath, "utf8"));
    item.source.publishedAt = "2026-08-02T03:00:30.000Z";
    item.workflow.processedAt = "2026-08-02T03:01:00.000Z";
    item.workflow.translationReview = { status: "local_verified" };
    item.workflow.triage = {
      ...item.workflow.triage,
      confidence: 0.95,
      importance: "high",
      boardCategory: "news",
    };
    await writeFile(itemPath, JSON.stringify(item), "utf8");
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      sourceProfiles: new Map([["openai", {
        trustLevel: "official",
        affiliationConfirmed: true,
      }]]),
      enabled: true,
      autoPublishEnabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      now: () => new Date("2026-08-02T03:00:00.000Z"),
      async runPublisher({ jobPath }) {
        runs += 1;
        const job = JSON.parse(await readFile(jobPath, "utf8"));
        await writeFile(job.resultPath, JSON.stringify({
          status: "posted",
          postId: "123458",
          url: "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=123458",
        }), "utf8");
      },
    });
    await service.initializeAutoPublishing();
    const result = await service.autoPublish(ID);
    const saved = JSON.parse(await readFile(itemPath, "utf8"));
    assert.equal(result.status, "posted");
    assert.equal(result.publication.mode, "automatic");
    assert.equal(saved.workflow.status, "published");
    assert.equal(saved.workflow.dcApproval, null);
    assert.equal(runs, 1);
    assert.equal((await service.autoPublish(ID)).status, "hub_only");
    assert.equal(runs, 1);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("자동 게시 시작 전 뉴스는 소급 게시하지 않는다", async () => {
  const sample = await fixture({ approved: false });
  let runs = 0;
  try {
    const itemPath = path.join(sample.itemRoot, "item.json");
    const item = JSON.parse(await readFile(itemPath, "utf8"));
    item.workflow.processedAt = "2026-08-02T02:59:00.000Z";
    item.workflow.translationReview = { status: "local_verified" };
    item.workflow.triage = {
      ...item.workflow.triage,
      confidence: 0.95,
      importance: "high",
      boardCategory: "news",
    };
    await writeFile(itemPath, JSON.stringify(item), "utf8");
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      autoPublishEnabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
      now: () => new Date("2026-08-02T03:00:00.000Z"),
      async runPublisher() { runs += 1; },
    });
    await service.initializeAutoPublishing();
    const result = await service.autoPublish(ID);
    assert.equal(result.status, "hub_only");
    assert.equal(result.code, "before_activation");
    assert.equal(runs, 0);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("승인 없는 뉴스와 비활성 게시자는 실제 실행을 거부한다", async () => {
  const sample = await fixture({ approved: false });
  try {
    const active = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
    });
    await assert.rejects(() => active.publish(ID), { code: "APPROVAL_REQUIRED" });
    const disabled = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: false,
      coverRoot: sample.coverRoot,
      publisherScriptPath: sample.scriptPath,
    });
    await assert.rejects(() => disabled.publish(ID), { code: "RUNTIME_UNAVAILABLE" });
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});
