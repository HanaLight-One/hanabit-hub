import assert from "node:assert/strict";
import test from "node:test";
import { findAllowedXPost, normalizeXWatchMessage } from "../src/modules/news/x-watch-source.mjs";

const channelId = "1532598778865914067";
const allowedHandles = new Set(["thsottiaux", "openai"]);

test("x-watch는 allowlist 계정의 상태 링크만 받아들인다", () => {
  const allowed = findAllowedXPost({ channelId, type: 0, content: "https://x.com/thsottiaux/status/2091234567890123456", embeds: [] }, { channelId, allowedHandles });
  assert.deepEqual(allowed, {
    handle: "thsottiaux",
    statusId: "2091234567890123456",
    url: "https://x.com/thsottiaux/status/2091234567890123456",
  });
  assert.equal(findAllowedXPost({ channelId, content: "https://x.com/not_allowed/status/2091234567890123456" }, { channelId, allowedHandles }), null);
  assert.equal(findAllowedXPost({ channelId: "1530000000000000000", content: allowed.url }, { channelId, allowedHandles }), null);
});

test("공식 oEmbed 원문과 Discord 프록시 이미지를 X 뉴스 계약으로 정규화한다", async () => {
  const result = await normalizeXWatchMessage({
    channelId,
    type: 0,
    content: "https://x.com/thsottiaux/status/2091234567890123456",
    createdTimestamp: Date.parse("2026-08-01T02:00:00Z"),
    embeds: [{ image: { proxyURL: "https://images-ext-1.discordapp.net/external/a/image.jpg" } }],
  }, {
    channelId,
    allowedHandles,
    async fetchImpl(url) {
      assert.equal(url.hostname, "publish.twitter.com");
      return new Response(JSON.stringify({
        author_name: "Tibo",
        author_url: "https://twitter.com/thsottiaux",
        html: "<blockquote><p>Usage limits reset &amp; enjoy!</p></blockquote>",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.record.source.type, "x-post");
  assert.equal(result.record.source.account, "thsottiaux");
  assert.equal(result.record.original.content, "Usage limits reset & enjoy!");
  assert.deepEqual(result.record.original.contexts, []);
  assert.equal(result.mediaCandidates.length, 1);
  assert.equal(JSON.stringify(result.record).includes("publish.twitter.com"), false);
});

test("인용 링크와 함께 제공한 X 링크를 보조 문맥으로 최대 3개 보존한다", async () => {
  const primaryId = "2091234567890123456";
  const quotedId = "2091234567890123457";
  const providedId = "2091234567890123458";
  const responses = new Map([
    [primaryId, {
      author_name: "Tibo",
      author_url: "https://twitter.com/thsottiaux",
      html: `<blockquote><p>One more day <a href="https://t.co/quote">https://t.co/quote</a></p><a href="https://twitter.com/thsottiaux/status/${primaryId}">date</a></blockquote>`,
    }],
    [quotedId, {
      author_name: "OpenAI Developers",
      author_url: "https://twitter.com/OpenAIDevs",
      html: "<blockquote><p>New model available today.</p></blockquote>",
    }],
    [providedId, {
      author_name: "Sam Altman",
      author_url: "https://twitter.com/sama",
      html: "<blockquote><p>Context supplied by the operator.</p></blockquote>",
    }],
  ]);
  const result = await normalizeXWatchMessage({
    channelId,
    type: 0,
    content: `https://x.com/thsottiaux/status/${primaryId}\nhttps://x.com/sama/status/${providedId}`,
  }, {
    channelId,
    allowedHandles,
    async fetchImpl(url, init) {
      if (url.hostname === "t.co") {
        assert.equal(init.redirect, "manual");
        return new Response(null, { status: 302, headers: { location: `https://x.com/OpenAIDevs/status/${quotedId}` } });
      }
      const target = new URL(url.searchParams.get("url"));
      const id = target.pathname.split("/").at(-1);
      return new Response(JSON.stringify(responses.get(id)), { status: 200 });
    },
  });
  assert.deepEqual(result.record.original.contexts.map(({ relation, account, content }) => ({ relation, account, content })), [
    { relation: "provided-link", account: "sama", content: "Context supplied by the operator." },
    { relation: "linked-post", account: "OpenAIDevs", content: "New model available today." },
  ]);
});

test("oEmbed 작성자가 링크 계정과 다르면 저장하지 않는다", async () => {
  await assert.rejects(() => normalizeXWatchMessage({
    channelId,
    content: "https://x.com/thsottiaux/status/2091234567890123456",
  }, {
    channelId,
    allowedHandles,
    async fetchImpl() {
      return new Response(JSON.stringify({ author_url: "https://twitter.com/impostor", html: "<p>fake</p>" }), { status: 200 });
    },
  }), /작성자/);
});

test("작성자 없는 i 상태 링크는 oEmbed가 확인한 실제 계정으로 문맥화한다", async () => {
  const primaryId = "2091234567890123456";
  const parentId = "2091234567890123455";
  const result = await normalizeXWatchMessage({
    channelId,
    type: 0,
    content: `https://x.com/thsottiaux/status/${primaryId}\nhttps://x.com/i/status/${parentId}`,
  }, {
    channelId,
    allowedHandles,
    async fetchImpl(url) {
      const id = new URL(url.searchParams.get("url")).pathname.split("/").at(-1);
      return new Response(JSON.stringify(id === primaryId ? {
        author_name: "Tibo",
        author_url: "https://twitter.com/thsottiaux",
        html: "<blockquote><p>Codex</p></blockquote>",
      } : {
        author_name: "Ryan Els",
        author_url: "https://twitter.com/RyanEls4",
        html: "<blockquote><p>Developing your App is the easy part</p></blockquote>",
      }), { status: 200 });
    },
  });
  assert.deepEqual(result.record.original.contexts.map(({ account, content }) => ({ account, content })), [
    { account: "RyanEls4", content: "Developing your App is the easy part" },
  ]);
});

test("oEmbed 최종 응답이 공식 호스트를 벗어나면 거부한다", async () => {
  await assert.rejects(() => normalizeXWatchMessage({
    channelId,
    content: "https://x.com/thsottiaux/status/2091234567890123456",
  }, {
    channelId,
    allowedHandles,
    async fetchImpl() {
      return { ok: true, url: "https://example.com/oembed", async text() { return "{}"; } };
    },
  }), /허용된 호스트/);
});

test("oEmbed 긴 글이 말줄임표로 끝나면 X API note_tweet 원문으로 보강한다", async () => {
  const statusId = "2091234567890123456";
  const result = await normalizeXWatchMessage({
    channelId,
    type: 0,
    content: `https://x.com/thsottiaux/status/${statusId}`,
  }, {
    channelId,
    allowedHandles,
    xApiBearerToken: "test-bearer-token",
    async fetchImpl(url, init = {}) {
      if (url.hostname === "api.x.com") {
        assert.equal(url.pathname, `/2/tweets/${statusId}`);
        assert.equal(url.searchParams.get("tweet.fields"), "note_tweet");
        assert.equal(init.headers.authorization, "Bearer test-bearer-token");
        return new Response(JSON.stringify({
          data: {
            id: statusId,
            text: "Short text...",
            note_tweet: { text: "This is the complete long-form post with every final paragraph." },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        author_name: "Tibo",
        author_url: "https://twitter.com/thsottiaux",
        html: "<blockquote><p>This is the clipped post...</p></blockquote>",
      }), { status: 200 });
    },
  });
  assert.equal(
    result.record.original.content,
    "This is the complete long-form post with every final paragraph.",
  );
});
