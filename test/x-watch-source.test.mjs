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
  assert.equal(result.mediaCandidates.length, 1);
  assert.equal(JSON.stringify(result.record).includes("publish.twitter.com"), false);
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
