import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPendingNewsStore } from "../src/modules/news/news-item-store.mjs";

test("뉴스 대기함은 완성된 항목을 한 번만 원자적으로 저장한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-store-"));
  const id = "a".repeat(32);
  try {
    const store = createPendingNewsStore({ root });
    const first = await store.create(
      { schemaVersion: 1, id, workflow: { status: "pending_translation" } },
      {
        async writeMedia(destination) {
          await writeFile(path.join(destination, "01-image.png"), "image", "utf8");
          return [{ file: "media/01-image.png", contentType: "image/png", size: 5 }];
        },
      },
    );
    const second = await store.create({ schemaVersion: 1, id });
    const saved = JSON.parse(
      await readFile(path.join(root, "pending", id, "item.json"), "utf8"),
    );

    assert.deepEqual(first, { created: true, id, mediaCount: 1 });
    assert.deepEqual(second, { created: false, id });
    assert.equal(saved.media[0].file, "media/01-image.png");
    assert.equal(JSON.stringify(saved).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("뉴스 대기함은 상대 상태 루트를 거부한다", () => {
  assert.throws(() => createPendingNewsStore({ root: "state/news" }), /절대경로/);
});
