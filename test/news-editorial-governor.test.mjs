import assert from "node:assert/strict";
import test from "node:test";
import { applyNewsEditorialShadow } from "../src/modules/news/news-editorial-governor.mjs";

function item(id, {
  publishedAt = "2026-08-02T00:00:00Z",
  title = "새 모델 출시 소식",
  body = "새 모델의 기능과 제공 범위를 공개했습니다.",
  evidenceTag = "confirmed",
  importance = "medium",
  confidence = 0.9,
  gate = "eligible",
  gateCode = "confirmed",
  sourceUrl = `https://x.com/example/status/${id}`,
  links = [],
  codexStatus = null,
} = {}) {
  return {
    id: id.padStart(32, "0"),
    source: { publishedAt, url: sourceUrl, profile: { trustLevel: "high" } },
    original: { links, contexts: [] },
    collectedAt: publishedAt,
    workflow: {
      translation: { title, body },
      contextTranslations: [],
      triage: { evidenceTag, importance, confidence },
      codexReview: codexStatus ? { status: codexStatus } : null,
      autoPublishGate: { decision: gate, code: gateCode },
    },
  };
}

test("같은 사건의 여러 게시물은 가장 강한 원고 하나에 합친다", () => {
  const shared = "https://openai.com/news/model-release";
  const items = applyNewsEditorialShadow([
    item("1", { evidenceTag: "official", importance: "high", links: [shared] }),
    item("2", { title: "모델 공개 안내", links: [shared], publishedAt: "2026-08-02T00:02:00Z" }),
  ]);
  assert.equal(items[0].workflow.editorialShadow.decision, "ready");
  assert.equal(items[1].workflow.editorialShadow.decision, "merge");
  assert.equal(items[1].workflow.editorialShadow.representativeId, items[0].id);
  assert.equal(items[0].workflow.editorialShadow.storySize, 2);
});

test("가까운 시각의 독립 뉴스는 점수가 높은 하나만 즉시 후보가 된다", () => {
  const items = applyNewsEditorialShadow([
    item("3", { evidenceTag: "use_case", publishedAt: "2026-08-02T01:00:00Z", title: "개발 활용 사례", body: "한 개발자가 앱을 만들었습니다." }),
    item("4", { evidenceTag: "official", importance: "high", publishedAt: "2026-08-02T01:05:00Z", title: "공식 가격 변경", body: "새로운 가격 정책을 발표했습니다." }),
  ]);
  assert.equal(items[0].workflow.editorialShadow.decision, "hold");
  assert.equal(items[0].workflow.editorialShadow.code, "burst_queue");
  assert.equal(items[1].workflow.editorialShadow.decision, "ready");
});

test("유추는 Codex 검토 전에는 대기하고 비게시 항목은 허브에만 남긴다", () => {
  const items = applyNewsEditorialShadow([
    item("5", { evidenceTag: "inference" }),
    item("6", {
      gate: "blocked",
      gateCode: "not_publishable",
      publishedAt: "2026-08-04T00:00:00Z",
      title: "가벼운 개인 의견",
      body: "오늘 날씨에 관한 짧은 이야기입니다.",
    }),
  ]);
  assert.equal(items[0].workflow.editorialShadow.code, "inference_review");
  assert.equal(items[0].workflow.editorialShadow.decision, "hold");
  assert.equal(items[1].workflow.editorialShadow.decision, "hub_only");
});
