import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  validateJob,
  safeDcUrl,
  safeBodyLink,
  textToHtml,
  withoutDcWatermarkField,
} = require("../scripts/publish-news-to-dc.cjs");

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

test("DC 뉴스 게시 스크립트는 허용된 말머리와 이모지 없는 원고만 허용한다", () => {
  const sample = job();
  sample.value.contentHash = createHash("sha256")
    .update(`${sample.value.title}\0${sample.value.bodyText}\0${sample.value.media.length}`, "utf8")
    .digest("hex");
  assert.equal(validateJob(sample.value, sample.jobPath).headTextName, "뉴스/소식");
  assert.equal(validateJob({ ...sample.value, headTextName: "💡 정보" }, sample.jobPath).headTextName, "💡 정보");
  assert.throws(() => validateJob({ ...sample.value, title: "바뀐 제목" }, sample.jobPath), /CONTENT_CHANGED/u);
  assert.throws(() => validateJob({ ...sample.value, galleryId: "other" }, sample.jobPath), /INVALID_TARGET/u);
  assert.throws(() => validateJob({ ...sample.value, headTextName: "공지" }, sample.jobPath), /INVALID_TARGET/u);
  assert.throws(() => validateJob({ ...sample.value, bodyText: "이모지 🤣" }, sample.jobPath), /UNSUPPORTED_EMOJI/u);
});

test("게시 결과 링크는 DCInside HTTPS 주소만 허용한다", () => {
  assert.equal(safeDcUrl("https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=1")?.startsWith("https://gall.dcinside.com/"), true);
  assert.equal(
    safeDcUrl("https://m.dcinside.com/board/chatgpt/119992"),
    "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=119992",
  );
  assert.equal(safeDcUrl("https://example.com/fake"), null);
});

test("이미지 워터마크 필드는 빈 값 대신 제출 폼에서 완전히 제외한다", async () => {
  class FakeFormData {
    constructor() {
      this.entries = [];
    }

    append(name, value) {
      this.entries.push([name, value]);
      return this;
    }
  }

  const originalAppend = FakeFormData.prototype.append;
  const form = await withoutDcWatermarkField(FakeFormData, async () => {
    const value = new FakeFormData();
    value.append("id", "chatgpt");
    value.append("add_watermark", "");
    value.append("memo", "본문");
    return value;
  });

  assert.deepEqual(form.entries, [["id", "chatgpt"], ["memo", "본문"]]);
  assert.equal(FakeFormData.prototype.append, originalAppend);
  await assert.rejects(
    withoutDcWatermarkField(FakeFormData, async () => { throw new Error("중단"); }),
    /중단/u,
  );
  assert.equal(FakeFormData.prototype.append, originalAppend);
});

test("원고의 안전한 단독 URL 줄만 클릭 가능한 링크로 변환한다", () => {
  const xUrl = "https://x.com/gdb/status/2083773552793465087";
  const html = textToHtml(`원문 링크\n\n${xUrl}`);
  assert.match(html, new RegExp(`<p><a href="${xUrl}"`, "u"));
  assert.doesNotMatch(html, /<p style=[^>]*><a href=/u);
  assert.equal(safeBodyLink(xUrl), xUrl);
  assert.equal(safeBodyLink("https://openai.com/sk/blocked"), null);
  assert.doesNotMatch(textToHtml("문장 안 https://x.com/gdb/status/1"), /<a /u);
  assert.doesNotMatch(textToHtml("https://example.com/not-allowed"), /<a /u);
});

test("DC 본문은 고정 섹션에만 크기와 하이라이트 서식을 적용한다", () => {
  const html = textToHtml([
    "게시자: Greg Brockman · OpenAI",
    "",
    "본문 번역",
    "번역 내용 <script>alert(1)</script>",
    "",
    "왜 중요한가",
    "핵심 설명",
    "",
    "아직 확인되지 않은 점",
    "확인 범위",
    "",
    "주의: AI가 정리한 해설입니다.",
  ].join("\n"));
  assert.match(html, /font-size:20px/u);
  assert.match(html, /background-color:#fff4d6/u);
  assert.match(html, /font-size:12px/u);
  assert.doesNotMatch(html, /<hr/u);
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
});

test("원문 링크 카드는 게시자와 번역보다 먼저 배치한다", () => {
  const html = textToHtml([
    "원문 링크",
    "https://x.com/gdb/status/2083773552793465087",
    "",
    "게시자: Greg Brockman · OpenAI",
    "",
    "본문 번역",
    "번역 내용",
  ].join("\n"));
  assert.equal(
    html.indexOf("https://x.com/gdb/status") < html.indexOf("게시자: Greg Brockman"),
    true,
  );
  assert.equal(
    html.indexOf("게시자: Greg Brockman") < html.indexOf("본문 번역"),
    true,
  );
});

test("게시자는 저장소의 정확한 네 기본 커버 경로만 허용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-news-publisher-cover-"));
  const id = "d".repeat(32);
  const jobPath = path.join(root, "state", "news", "dc-publication-jobs", id, "job.json");
  const coverPath = path.join(root, "assets", "news", "dc-covers", "news.png");
  const invalidPath = path.join(root, "news.png");
  await mkdir(path.dirname(jobPath), { recursive: true });
  await mkdir(path.dirname(coverPath), { recursive: true });
  await Promise.all([
    writeFile(coverPath, "cover", "utf8"),
    writeFile(invalidPath, "cover", "utf8"),
  ]);
  try {
    const sample = job().value;
    sample.id = id;
    sample.resultPath = path.join(path.dirname(jobPath), "result.json");
    sample.media = [{ path: coverPath, filename: "news.png", contentType: "image/png" }];
    sample.contentHash = createHash("sha256")
      .update(`${sample.title}\0${sample.bodyText}\0${sample.media.length}`, "utf8")
      .digest("hex");
    assert.equal(validateJob(sample, jobPath).media[0].filename, "news.png");
    assert.throws(() => validateJob({ ...sample, headTextName: "잡담" }, jobPath), /INVALID_MEDIA/u);
    assert.throws(
      () => validateJob({ ...sample, media: [{ ...sample.media[0], path: invalidPath }] }, jobPath),
      /INVALID_MEDIA/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
