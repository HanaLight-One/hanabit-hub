import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDiscordAnnouncement } from "../src/modules/news/discord-announcement.mjs";

const channelId = "1532598696586383360";

test("Discord 공지를 번역 대기 뉴스 계약으로 정규화한다", () => {
  const result = normalizeDiscordAnnouncement(
    {
      id: "1533000000000000000",
      content: "New model: https://openai.com/news/example",
      url: "https://discord.com/channels/1/2/3",
      createdTimestamp: Date.parse("2026-07-31T00:00:00Z"),
      embeds: [
        {
          title: "Launch",
          description: "Details",
          url: "https://openai.com/index/example",
          fields: [{ name: "Availability", value: "Today" }],
          image: { proxyURL: "https://media.discordapp.net/example.png" },
        },
      ],
      attachments: [
        {
          name: "launch.png",
          contentType: "image/png",
          size: 123,
          url: "https://cdn.discordapp.com/attachments/a/b/launch.png",
        },
      ],
    },
    { channelId },
  );

  assert.match(result.id, /^[a-f0-9]{32}$/);
  assert.equal(result.record.workflow.status, "pending_translation");
  assert.equal(result.record.original.language, "en");
  assert.equal(result.record.original.embeds[0].fields[0].value, "Today");
  assert.deepEqual(result.record.original.links, [
    "https://openai.com/news/example",
    "https://openai.com/index/example",
  ]);
  assert.equal(result.mediaCandidates.length, 2);
});

test("비어 있는 Discord 시스템 메시지는 수집하지 않는다", () => {
  assert.equal(
    normalizeDiscordAnnouncement(
      { id: "1533000000000000000", content: "", embeds: [], attachments: [] },
      { channelId },
    ),
    null,
  );
});
