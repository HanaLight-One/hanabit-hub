import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFortuneArchive } from "../src/modules/fortune/fortune-archive.mjs";

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-fortune-"));
  const outputRoot = path.join(root, "output");
  const publisherStateRoot = path.join(root, "state");
  const date = "2026-07-31";
  await mkdir(path.join(outputRoot, date), { recursive:true });
  await mkdir(publisherStateRoot, { recursive:true });
  await writeFile(path.join(outputRoot, date, "fortune.txt"), "오늘의 운세 본문", "utf8");
  await writeFile(path.join(outputRoot, date, "source_data.json"), "SECRET", "utf8");
  await writeFile(path.join(publisherStateRoot, `fortune-run-${date}.json`), JSON.stringify({ status:"posted", message:"SECRET", updatedAt:"2026-07-31T06:00:00Z" }), "utf8");
  await writeFile(path.join(publisherStateRoot, `fortune-${date}.json`), JSON.stringify({ status:"posted", redirectUrl:"https://gall.dcinside.com/example", contentHash:"SECRET", postId:"SECRET", submittedAt:"2026-07-31T06:01:00Z" }), "utf8");
  try { await callback({ outputRoot, publisherStateRoot, date }); }
  finally { await rm(root, { recursive:true, force:true }); }
}

test("운세 아카이브는 본문과 안전한 게시 상태만 반환한다", async () => {
  await fixture(async ({ outputRoot, publisherStateRoot, date }) => {
    const archive = createFortuneArchive({ outputRoot, publisherStateRoot });
    const result = await archive.get(date);
    const serialized = JSON.stringify(result);
    assert.equal(result.text, "오늘의 운세 본문");
    assert.equal(result.publication.status, "posted");
    assert.equal(result.publication.url, "https://gall.dcinside.com/example");
    assert.equal(serialized.includes("SECRET"), false);
    assert.deepEqual(await archive.dates(), [date]);
  });
});

test("운세 아카이브는 잘못된 날짜와 상대경로를 거부한다", async () => {
  assert.throws(() => createFortuneArchive({ outputRoot:"output", publisherStateRoot:"state" }), /절대경로/);
  await fixture(async ({ outputRoot, publisherStateRoot }) => {
    await assert.rejects(() => createFortuneArchive({ outputRoot, publisherStateRoot }).get("2026-02-30"), /날짜/);
  });
});

test("모호한 게시 영수증은 완료 상태와 외부 링크보다 우선한다", async () => {
  await fixture(async ({ outputRoot, publisherStateRoot, date }) => {
    await writeFile(
      path.join(publisherStateRoot, `fortune-${date}.json`),
      JSON.stringify({
        status: "ambiguous-no-retry",
        redirectUrl: "https://example.com/not-allowed",
        submittedAt: "2026-07-31T06:01:00Z",
      }),
      "utf8",
    );
    const result = await createFortuneArchive({ outputRoot, publisherStateRoot }).get(date);
    assert.deepEqual(result.publication, {
      status: "attention",
      updatedAt: "2026-07-31T06:01:00Z",
      url: null,
    });
  });
});
