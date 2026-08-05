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

test("공식 GitHub 릴리스는 제품명을 제목에 붙이고 Markdown을 평문으로 정리한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-official-title-"));
  const sdkSource = { ...source, id: "openai-agents-js-releases", repository: "openai/openai-agents-js" };
  let payload = [release(20, "7.3.0")];
  const collector = createOfficialNewsCollector({
    stateRoot: root,
    sources: [sdkSource],
    now: () => new Date("2026-08-03T02:00:00Z"),
    async fetchImpl() { return new Response(JSON.stringify(payload), { status: 200 }); },
  });
  try {
    await collector.collectAll();
    payload = [{ ...release(21, "7.4.0"), name: "7.4.0", body: "### Features\n\n* **agents:** add a new session API" }, ...payload];
    const result = await collector.collectAll();
    const saved = await createPendingNewsStore({ root }).read(result.ids[0]);
    assert.match(saved.original.content, /^OpenAI Agents SDK JavaScript 7\.4\.0/mu);
    assert.match(saved.original.content, /Features\n\n• agents: add a new session API/u);
    assert.doesNotMatch(saved.original.content, /###|\*\*/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("의존성과 빌드 설정만 바뀐 공식 릴리스는 대기함에 만들지 않는다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-official-maintenance-"));
  let payload = [release(30, "7.3.0")];
  const collector = createOfficialNewsCollector({
    stateRoot: root,
    sources: [source],
    now: () => new Date("2026-08-03T02:00:00Z"),
    async fetchImpl() { return new Response(JSON.stringify(payload), { status: 200 }); },
  });
  try {
    await collector.collectAll();
    payload = [{
      ...release(31, "7.4.0"),
      name: "7.4.0",
      body: "### Build System\n\n* **deps-dev:** bump @smithy/hash-node from 4.3.5 to 4.4.15\n* release workflow moved to upstream release-please",
    }, ...payload];
    const result = await collector.collectAll();
    assert.equal(result.created, 0);
    assert.equal(result.filtered, 1);
    assert.deepEqual(result.ids, []);
    const repeated = await collector.collectAll();
    assert.equal(repeated.filtered, 0);
    assert.equal(repeated.created, 0);
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

test("공식 변경 기록의 OpenAI Vercel 프리뷰 링크는 공개 문서 주소로 저장한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-official-preview-link-"));
  const docsSource = {
    id: "openai-api-changelog",
    type: "markdown-changelog",
    repository: null,
    url: "https://developers.openai.com/api/docs/changelog.md",
    limit: 10,
    enabled: true,
  };
  let markdown = "# Changelog\n\n## August, 2026\n\n### Aug 4\n\nExisting update.\n";
  const collector = createOfficialNewsCollector({
    stateRoot: root,
    sources: [docsSource],
    now: () => new Date("2026-08-06T00:00:00Z"),
    async fetchImpl() { return new Response(markdown, { status: 200 }); },
  });
  try {
    await collector.collectAll();
    markdown = [
      "# Changelog",
      "",
      "## August, 2026",
      "",
      "### Aug 5",
      "",
      "See [pricing details](https://developers-site-git-agent-add-fast-openai.vercel.app/api/docs/pricing?latest-pricing=fast).",
      "",
      "### Aug 4",
      "",
      "Existing update.",
    ].join("\n");
    const result = await collector.collectAll();
    const saved = await createPendingNewsStore({ root }).read(result.ids[0]);
    assert.deepEqual(saved.original.links, [
      "https://developers.openai.com/api/docs/pricing?latest-pricing=fast",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
