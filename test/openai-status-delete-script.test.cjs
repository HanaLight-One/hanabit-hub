const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  automatedDcCredentials,
  classifyDeleteError,
  classifyDeleteResult,
  mobileDeleteHeaders,
  validateJob,
  verifyPostVisibility,
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

test("삭제 실패는 비밀 응답 대신 안전한 원인 코드로만 분류한다", () => {
  assert.deepEqual(classifyDeleteResult({ success: false, message: "captcha" }), {
    status: "failed-preflight",
    reason: "CAPTCHA_REQUIRED",
  });
  assert.deepEqual(classifyDeleteError(new Error("CSRF 토큰을 찾을 수 없습니다.")), {
    status: "failed-preflight",
    reason: "CSRF_TOKEN_MISSING",
  });
  assert.deepEqual(classifyDeleteError(new Error("network details")), {
    status: "ambiguous-no-retry",
    reason: "DELETE_REQUEST_UNCERTAIN",
  });
});

test("삭제 뒤 공개 페이지에서 정확한 글 번호의 존재 여부를 다시 확인한다", async () => {
  const present = await verifyPostVisibility({
    galleryId: "chatgpt",
    postId: "120854",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() { return '<input id="no" name="no" type="hidden" value="120854">'; },
    }),
  });
  const absent = await verifyPostVisibility({
    galleryId: "chatgpt",
    postId: "120854",
    fetchImpl: async () => ({ ok: false, status: 404, async text() { return ""; } }),
  });
  const unknown = await verifyPostVisibility({
    galleryId: "chatgpt",
    postId: "120854",
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return "점검 페이지"; } }),
  });
  assert.equal(present, "present");
  assert.equal(absent, "absent");
  assert.equal(unknown, "unknown");
});

test("모바일 삭제 요청은 실제 브라우저와 같은 Origin을 포함한다", () => {
  const headers = mobileDeleteHeaders({ AJAX_HEADERS: { "x-requested-with": "XMLHttpRequest" }, WRITE_BASE_URL: "https://m.dcinside.com" }, "csrf", "https://m.dcinside.com/board/chatgpt/120854");
  assert.equal(headers.Origin, "https://m.dcinside.com");
  assert.equal(headers.Referer, "https://m.dcinside.com/board/chatgpt/120854");
  assert.equal(headers["x-csrf-token"], "csrf");
});

test("모바일 공개 조회가 차단되면 데스크톱 조회의 404로 부재를 확정한다", async () => {
  let calls = 0;
  const result = await verifyPostVisibility({
    galleryId: "chatgpt",
    postId: "120854",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 403, async text() { return ""; } }
        : { ok: false, status: 404, async text() { return ""; } };
    },
  });
  assert.equal(result, "absent");
  assert.equal(calls, 2);
});
