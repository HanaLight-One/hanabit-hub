import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadDiscordMedia } from "../src/modules/news/discord-media.mjs";

test("Discord CDN 이미지를 상대경로 기록으로 보존한다", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-media-"));
  try {
    const records = await downloadDiscordMedia(
      [
        {
          kind: "attachment",
          name: "launch image.png",
          url: "https://cdn.discordapp.com/attachments/a/b/image.png",
        },
      ],
      {
        destination,
        async fetchImpl(url) {
          return new Response(Buffer.from("image-bytes"), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        },
      },
    );

    assert.deepEqual(records, [
      {
        kind: "attachment",
        file: "media/01-launch-image.png",
        contentType: "image/png",
        size: 11,
      },
    ]);
    assert.equal(
      await readFile(path.join(destination, "01-launch-image.png"), "utf8"),
      "image-bytes",
    );
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("Discord 외부 이미지 주소는 내려받지 않는다", async () => {
  await assert.rejects(
    () =>
      downloadDiscordMedia(
        [{ kind: "attachment", name: "x.png", url: "https://example.com/x.png" }],
        { destination: os.tmpdir(), fetchImpl: async () => assert.fail("호출 금지") },
      ),
    /허용된 Discord 이미지 주소/,
  );
});

test("Discord 공식 외부 이미지 프록시는 허용한다", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-proxy-"));
  try {
    const records = await downloadDiscordMedia(
      [
        {
          kind: "embed-image",
          name: "preview",
          url: "https://images-ext-1.discordapp.net/external/example/image.png",
        },
      ],
      {
        destination,
        async fetchImpl() {
          return new Response(Buffer.from("preview"), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        },
      },
    );
    assert.equal(records.length, 1);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
