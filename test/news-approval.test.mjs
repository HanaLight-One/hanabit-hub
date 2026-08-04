import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNewsApprovalService } from "../src/modules/news/news-approval.mjs";

async function fixture(workflow) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-approval-"));
  const id = "a".repeat(32);
  const itemRoot = path.join(root, "pending", id);
  await mkdir(itemRoot, { recursive: true });
  await writeFile(path.join(itemRoot, "item.json"), JSON.stringify({ id, workflow }), "utf8");
  return { root, id, itemRoot };
}

test("DC 승인은 검토 후보에 게시 실행 없는 승인 영수증만 남긴다", async () => {
  const sample = await fixture({
    status: "pending_review",
    triage: { decision: "publish", confidence: 0.9, reason: "공식 소식" },
    dcPublication: null,
  });
  try {
    const service = createNewsApprovalService({
      root: sample.root,
      now: () => new Date("2026-08-01T12:34:56.000Z"),
    });
    const first = await service.approveForDc(sample.id);
    const second = await service.approveForDc(sample.id);
    const saved = JSON.parse(await readFile(path.join(sample.itemRoot, "item.json"), "utf8"));

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(saved.workflow.status, "approved_for_dc");
    assert.deepEqual(saved.workflow.translationReview, {
      status: "human_verified",
      reviewer: "owner",
      reviewedAt: "2026-08-01T12:34:56.000Z",
    });
    assert.match(saved.workflow.analysisNotice, /원문 번역이 아니며/);
    assert.deepEqual(saved.workflow.dcApproval, {
      schemaVersion: 1,
      status: "approved",
      approvedAt: "2026-08-01T12:34:56.000Z",
      target: "dcinside",
    });
    assert.equal(saved.workflow.dcPublication, null);
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("failed preflight reuses the existing DC approval", async () => {
  const sample = await fixture({
    status: "approved_for_dc",
    triage: { decision: "publish", confidence: 0.9, reason: "official release" },
    dcApproval: {
      schemaVersion: 1,
      status: "approved",
      approvedAt: "2026-08-04T10:31:00.000Z",
      target: "dcinside",
    },
    dcPublication: {
      schemaVersion: 1,
      status: "failed-preflight",
      mode: "manual",
      submittedAt: "2026-08-04T10:32:00.000Z",
    },
  });
  try {
    const service = createNewsApprovalService({ root: sample.root });
    const result = await service.approveForDc(sample.id);
    const saved = JSON.parse(await readFile(path.join(sample.itemRoot, "item.json"), "utf8"));

    assert.equal(result.changed, false);
    assert.equal(saved.workflow.dcPublication.status, "failed-preflight");
    assert.equal(saved.workflow.dcApproval.status, "approved");
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});

test("번역 전 또는 보류 판정 뉴스는 DC 승인을 거부한다", async () => {
  const sample = await fixture({
    status: "pending_review",
    triage: { decision: "skip", confidence: 0.8, reason: "일상 글" },
  });
  try {
    const service = createNewsApprovalService({ root: sample.root });
    await assert.rejects(() => service.approveForDc(sample.id), { code: "NOT_REVIEWABLE" });
  } finally {
    await rm(sample.root, { recursive: true, force: true });
  }
});
