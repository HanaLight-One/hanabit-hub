import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { openHubDatabase } from "../src/modules/database/hub-database.mjs";
import { createDcComposer } from "../src/modules/dc/dc-composer.mjs";
import { createImageArchive } from "../src/modules/images/image-archive.mjs";

async function fixture(context, { publishResult = "posted" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-dc-compose-"));
  const archiveRoot = path.join(root, "archive");
  const publisherRoot = path.join(root, "publisher");
  const scriptPath = path.join(root, "publish.cjs");
  await mkdir(path.join(archiveRoot, "2026-08-02", "extra-requests", "free-play"), { recursive: true });
  await mkdir(publisherRoot, { recursive: true });
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff5599" } }).png().toBuffer();
  await Promise.all([
    writeFile(path.join(archiveRoot, "2026-08-02", "extra-requests", "free-play", "hub.png"), png),
    writeFile(path.join(publisherRoot, "package.json"), "{}", "utf8"),
    writeFile(path.join(publisherRoot, ".env"), "PUBLISH_DRY_RUN=false", "utf8"),
    writeFile(scriptPath, "test", "utf8"),
  ]);
  const database = openHubDatabase({ filePath: path.join(root, "hub.sqlite") });
  context.after(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  const archive = createImageArchive({ dailyImagesRoot: archiveRoot });
  const jobs = [];
  const composer = createDcComposer({
    database, archive, root: path.join(root, "state", "dc-compose"), enabled: true,
    publisherRoot, publisherScriptPath: scriptPath,
    now: () => new Date("2026-08-02T13:00:00.000Z"),
    async runPublisher({ jobPath }) {
      const job = JSON.parse(await readFile(jobPath, "utf8"));
      jobs.push(job);
      await writeFile(job.resultPath, JSON.stringify(publishResult === "posted" ? {
        status: "posted", postId: "123456", url: "https://gall.dcinside.com/mgallery/board/view/?id=chatgpt&no=123456",
      } : { status: "ambiguous-no-retry" }), "utf8");
    },
  });
  return { root, png, archive, composer, jobs };
}

test("GPT 이미지를 별도 보관하고 허브 이미지와 함께 DC 초안에 순서대로 저장한다", async (context) => {
  const { root, png, archive, composer } = await fixture(context);
  const uploaded = await composer.upload({ filename: "GPT 결과.png", contentType: "image/png", buffer: png });
  const hub = (await archive.list()).images[0];
  const draft = await composer.saveDraft({
    headText: "AI창작", title: "두 이미지 테스트", bodyText: "본문입니다.",
    images: [{ sourceType: "upload", sourceId: uploaded.id }, { sourceType: "archive", sourceId: hub.id }],
  });
  assert.equal(draft.images.length, 2);
  assert.deepEqual(draft.images.map((item) => item.sourceType), ["upload", "archive"]);
  assert.equal(JSON.stringify(draft).includes(root), false);
  const preview = await composer.preview(draft.id);
  assert.equal(preview.preflight.ready, true);
  assert.equal(preview.publisherReady, true);
  assert.equal(preview.canPublish, true);
});

test("실제 게시 요청은 격리된 첨부 사본과 영수증을 한 번만 사용한다", async (context) => {
  const { png, archive, composer, jobs } = await fixture(context);
  const uploaded = await composer.upload({ filename: "one.png", contentType: "image/png", buffer: png });
  const hub = (await archive.list()).images[0];
  const draft = await composer.saveDraft({ headText: "AI창작", title: "게시 테스트", bodyText: "안전한 본문", images: [
    { sourceType: "archive", sourceId: hub.id }, { sourceType: "upload", sourceId: uploaded.id },
  ] });
  const result = await composer.publish(draft.id);
  assert.equal(result.publication.status, "posted");
  assert.equal(result.publication.postId, "123456");
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].media.map((item) => item.filename), ["01.png", "02.png"]);
  assert.equal(jobs[0].media.every((item) => path.basename(path.dirname(item.path)) === "media"), true);
  await assert.rejects(() => composer.publish(draft.id), { code: "ALREADY_SUBMITTED" });
  assert.equal(jobs.length, 1);
});

test("그림 이모지와 결합 문자는 미리보기에서 게시 불가로 차단한다", async (context) => {
  const { composer } = await fixture(context);
  const draft = await composer.saveDraft({ headText: "잡담", title: "제목🤣", bodyText: "본문", images: [] });
  const preview = await composer.preview(draft.id);
  assert.equal(preview.preflight.ready, false);
  assert.equal(preview.canPublish, false);
  assert.match(preview.preflight.errors.join(" "), /이모지/u);
});

test("업로드 파일의 선언 형식과 실제 이미지 형식이 다르면 거부한다", async (context) => {
  const { png, composer } = await fixture(context);
  await assert.rejects(() => composer.upload({ filename: "fake.jpg", contentType: "image/jpeg", buffer: png }), { code: "INVALID_MEDIA" });
  await assert.rejects(() => composer.upload({ filename: "bad.png", contentType: "image/png", buffer: Buffer.from("not-image") }), { code: "INVALID_MEDIA" });
});

test("업로드 파일은 초안 사용 중에는 보호하고 선택 해제 후 서버에서 삭제한다", async (context) => {
  const { png, composer } = await fixture(context);
  const uploaded = await composer.upload({ filename: "remove.png", contentType: "image/png", buffer: png });
  const draft = await composer.saveDraft({ headText: "잡담", title: "임시", bodyText: "본문", images: [{ sourceType: "upload", sourceId: uploaded.id }] });
  await assert.rejects(() => composer.deleteUpload(uploaded.id), { code: "UPLOAD_IN_USE" });
  await composer.saveDraft({ ...draft, images: [] });
  assert.deepEqual(await composer.deleteUpload(uploaded.id), { deleted: true });
  assert.deepEqual(await composer.listUploads(), []);
});
