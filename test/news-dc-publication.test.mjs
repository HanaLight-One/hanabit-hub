import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNewsDcPublicationService } from "../src/modules/news/news-dc-publication.mjs";

const ID = "b".repeat(32);

async function fixture({ approved = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-dc-"));
  const publisherRoot = path.join(root, "publisher");
  const itemRoot = path.join(root, "news", "pending", ID);
  const scriptPath = path.join(root, "publish.cjs");
  await mkdir(path.join(itemRoot, "media"), { recursive: true });
  await mkdir(publisherRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(publisherRoot, "package.json"), "{}", "utf8"),
    writeFile(path.join(publisherRoot, ".env"), "PUBLISH_DRY_RUN=false", "utf8"),
    writeFile(scriptPath, "test", "utf8"),
    writeFile(path.join(itemRoot, "media", "01.png"), "image", "utf8"),
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
    media: [{ file: "media/01.png", contentType: "image/png" }],
  }), "utf8");
  return { root, newsRoot: path.join(root, "news"), publisherRoot, scriptPath, itemRoot };
}

test("미리보기는 실제 게시 없이 안전한 공개 원고만 반환한다", async () => {
  const sample = await fixture({ approved: false });
  try {
    let runs = 0;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
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

test("승인된 원고는 게시자를 한 번만 실행하고 게시 영수증을 저장한다", async () => {
  const sample = await fixture();
  try {
    let runs = 0;
    const service = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
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

test("승인 없는 뉴스와 비활성 게시자는 실제 실행을 거부한다", async () => {
  const sample = await fixture({ approved: false });
  try {
    const active = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: true,
      publisherRoot: sample.publisherRoot,
      publisherScriptPath: sample.scriptPath,
    });
    await assert.rejects(() => active.publish(ID), { code: "APPROVAL_REQUIRED" });
    const disabled = createNewsDcPublicationService({
      root: sample.newsRoot,
      enabled: false,
      publisherScriptPath: sample.scriptPath,
    });
    await assert.rejects(() => disabled.publish(ID), { code: "RUNTIME_UNAVAILABLE" });
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});
