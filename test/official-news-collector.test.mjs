import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficialNewsCollector } from "../src/modules/news/official-news-collector.mjs";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";

const source = Object.freeze({
  id: "openai-codex-releases",
  type: "github-releases",
  repository: "openai/codex",
  url: null,
  limit: 10,
  enabled: true,
});

function release(id, tag) {
  return {
    id,
    tag_name: tag,
    name: `Codex ${tag}`,
    body: `Changes for ${tag}`,
    html_url: `https://github.com/openai/codex/releases/tag/${tag}`,
    published_at: "2026-08-03T01:00:00Z",
    draft: false,
    prerelease: false,
  };
}

test("공식 소스는 첫 실행을 기준선으로 삼고 이후 릴리스만 저장한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-official-news-"));
  let payload = [release(10, "v1")];
  const collector = createOfficialNewsCollector({
    stateRoot: root,
    sources: [source],
    now: () => new Date("2026-08-03T02:00:00Z"),
    async fetchImpl(url) {
      assert.equal(url.hostname, "api.github.com");
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  try {
    const baseline = await collector.collectAll();
    assert.equal(baseline.baselined, 1);
    assert.equal(baseline.created, 0);

    payload = [release(11, "v2"), release(10, "v1")];
    const next = await collector.collectAll();
    assert.equal(next.created, 1);
    assert.equal(next.ids.length, 1);
    const saved = await createPendingNewsStore({ root }).read(next.ids[0]);
    assert.equal(saved.source.type, "official-github-release");
    assert.equal(saved.source.repository, "openai/codex");
    assert.match(saved.original.content, /Codex v2/u);

    const repeated = await collector.collectAll();
    assert.equal(repeated.created, 0);
    assert.equal(repeated.ids.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("공식 Markdown 변경 기록도 최초 항목을 게시하지 않고 기준선에 보관한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-official-docs-"));
  const docsSource = {
    id: "openai-api-changelog",
    type: "markdown-changelog",
    repository: null,
    url: "https://developers.openai.com/api/docs/changelog.md",
    limit: 10,
    enabled: true,
  };
  const markdown = "# Changelog\n\n## August, 2026\n\n### Aug 3\n\nReleased [New API](https://developers.openai.com/api/docs/new).\n";
  try {
    const collector = createOfficialNewsCollector({
      stateRoot: root,
      sources: [docsSource],
      now: () => new Date("2026-08-03T03:00:00Z"),
      async fetchImpl() { return new Response(markdown, { status: 200 }); },
    });
    assert.equal((await collector.collectAll()).baselined, 1);
    const checkpoint = JSON.parse(await readFile(path.join(root, "official-sources.json"), "utf8"));
    assert.equal(checkpoint.seenBySource[docsSource.id].length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
