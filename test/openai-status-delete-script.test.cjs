const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  automatedDcCredentials,
  validateJob,
} = require("../scripts/delete-news-dc-post.cjs");

test("상태 글 삭제자는 파딱 전용 계정만 선택한다", () => {
  assert.equal(automatedDcCredentials({ DC_ID: "owner", DC_PW: "owner-pw" }), null);
  assert.deepEqual(automatedDcCredentials({
    DC_ADMIN_BLUE_BADGE_ID: "blue",
    DC_ADMIN_BLUE_BADGE_PW: "blue-pw",
  }), { id: "blue", password: "blue-pw" });
});

test("상태 글 삭제 작업은 chatgpt 글 번호와 고정 결과 경로만 허용한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-delete-job-"));
  const jobPath = path.join(root, "job.json");
  const resultPath = path.join(root, "result.json");
  await mkdir(root, { recursive: true });
  await writeFile(jobPath, "{}", "utf8");
  assert.equal(validateJob({
    schemaVersion: 1,
    galleryId: "chatgpt",
    postId: "120600",
    resultPath,
  }, jobPath).postId, "120600");
  assert.throws(() => validateJob({
    schemaVersion: 1,
    galleryId: "other",
    postId: "120600",
    resultPath,
  }, jobPath), /INVALID_JOB/u);
  assert.throws(() => validateJob({
    schemaVersion: 1,
    galleryId: "chatgpt",
    postId: "120600",
    resultPath: path.join(root, "other.json"),
  }, jobPath), /INVALID_RESULT_PATH/u);
});
