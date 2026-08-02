import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { validateJob, safeDcUrl } = require("../scripts/publish-news-to-dc.cjs");

function job() {
  const jobPath = path.resolve("state", "test-news", "job.json");
  return {
    jobPath,
    value: {
      schemaVersion: 1,
      id: "d".repeat(32),
      galleryId: "chatgpt",
      headTextName: "뉴스/소식",
      title: "[공식] 새 소식",
      bodyText: "번역 본문",
      contentHash: "e".repeat(64),
      resultPath: path.join(path.dirname(jobPath), "result.json"),
      media: [],
    },
  };
}

test("DC 뉴스 게시 스크립트는 고정 대상과 이모지 없는 원고만 허용한다", () => {
  const sample = job();
  sample.value.contentHash = createHash("sha256")
    .update(`${sample.value.title}\0${sample.value.bodyText}\0${sample.value.media.length}`, "utf8")
    .digest("hex");
  assert.equal(validateJob(sample.value, sample.jobPath).headTextName, "뉴스/소식");
  assert.throws(() => validateJob({ ...sample.value, title: "바뀐 제목" }, sample.jobPath), /CONTENT_CHANGED/u);
  assert.throws(() => validateJob({ ...sample.value, galleryId: "other" }, sample.jobPath), /INVALID_TARGET/u);
  assert.throws(() => validateJob({ ...sample.value, bodyText: "이모지 🤣" }, sample.jobPath), /UNSUPPORTED_EMOJI/u);
});

test("게시 결과 링크는 DCInside HTTPS 주소만 허용한다", () => {
  assert.equal(safeDcUrl("https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=1")?.startsWith("https://gall.dcinside.com/"), true);
  assert.equal(safeDcUrl("https://example.com/fake"), null);
});
