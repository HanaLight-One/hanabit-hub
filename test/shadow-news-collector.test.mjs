import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createShadowNewsCollector, loadShadowNewsSources } from "../src/modules/news/shadow-news-collector.mjs";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";

const source = Object.freeze({
  id: "ars-technica-ai",
  label: "Ars Technica · AI",
  type: "rss",
  url: "https://arstechnica.com/ai/feed/",
  allowedArticleHosts: Object.freeze(["arstechnica.com"]),
  limit: 25,
  enabled: true,
});

function feed(items) {
  return `<?xml version="1.0"?><rss><channel>${items.map((item) => `
    <item>
      <guid>${item.id}</guid>
      <title><![CDATA[${item.title}]]></title>
      <link>https://arstechnica.com/ai/${item.id}/</link>
      <description><![CDATA[<p>${item.description}</p>]]></description>
      <pubDate>Sun, 03 Aug 2026 03:00:00 GMT</pubDate>
    </item>`).join("")}</channel></rss>`;
}

test("외신 레이더는 첫 RSS를 기준선으로 삼고 새 항목만 그림자로 저장한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-shadow-news-"));
  let xml = feed([{ id: "first", title: "First story", description: "Existing story" }]);
  const collector = createShadowNewsCollector({
    stateRoot: root,
    sources: [source],
    now: () => new Date("2026-08-03T04:00:00Z"),
    async fetchImpl(url) {
      assert.equal(url, source.url);
      return new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } });
    },
  });
  try {
    const baseline = await collector.collectAll();
    assert.equal(baseline.baselined, 1);
    assert.equal(baseline.created, 0);

    xml = feed([
      { id: "second", title: "Second &amp; safer", description: "<b>New</b> practical change" },
      { id: "first", title: "First story", description: "Existing story" },
    ]);
    const next = await collector.collectAll();
    assert.equal(next.created, 1);
    const saved = await createPendingNewsStore({ root }).read(next.ids[0]);
    assert.equal(saved.source.type, "media-rss-shadow");
    assert.equal(saved.workflow.status, "shadow_radar");
    assert.equal(saved.workflow.translation, null);
    assert.equal(saved.workflow.dcPublication, null);
    assert.match(saved.original.content, /Second & safer/u);
    assert.doesNotMatch(saved.original.content, /<b>/u);

    assert.equal((await collector.collectAll()).created, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("외신 레이더 미리보기는 상태 파일과 뉴스 항목을 쓰지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-shadow-preview-"));
  try {
    const collector = createShadowNewsCollector({
      stateRoot: root,
      sources: [source],
      async fetchImpl() { return new Response(feed([{ id: "dry", title: "Dry", description: "Run" }]), { status: 200 }); },
    });
    const summary = await collector.collectAll({ dryRun: true });
    assert.equal(summary.baselined, 1);
    await assert.rejects(readFile(path.join(root, "shadow-sources.json"), "utf8"), { code: "ENOENT" });
    assert.deepEqual(await createPendingNewsStore({ root }).list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("외신 레이더 설정은 승인된 피드와 기사 호스트만 허용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-shadow-config-"));
  const target = path.join(root, "sources.json");
  try {
    await writeFile(target, JSON.stringify({
      schemaVersion: 1,
      intervalMinutes: 20,
      sources: [{ ...source, url: "https://example.com/feed.xml" }],
    }), "utf8");
    await assert.rejects(loadShadowNewsSources(target), /허용 범위/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
