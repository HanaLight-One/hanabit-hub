const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function automatedDcCredentials(env = process.env) {
  const id = env.DC_ADMIN_BLUE_BADGE_ID?.trim();
  const password = env.DC_ADMIN_BLUE_BADGE_PW;
  return id && password ? Object.freeze({ id, password }) : null;
}

function writeResult(target, value) {
  const resolved = path.resolve(target);
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, resolved);
}

function validateJob(value, jobPath) {
  if (value?.schemaVersion !== 1 || value.galleryId !== "chatgpt" || !/^\d{4,}$/u.test(String(value.postId ?? ""))) {
    throw new Error("INVALID_JOB");
  }
  const expectedResult = path.join(path.dirname(jobPath), "result.json");
  if (path.resolve(value.resultPath ?? "") !== expectedResult) throw new Error("INVALID_RESULT_PATH");
  return value;
}

function classifyDeleteError(error) {
  const message = String(error?.message ?? "");
  if (message === "CSRF 토큰을 찾을 수 없습니다.") {
    return { status: "failed-preflight", reason: "CSRF_TOKEN_MISSING" };
  }
  if (message === "삭제용 키(con_key)를 얻지 못했습니다.") {
    return { status: "failed-preflight", reason: "DELETE_KEY_MISSING" };
  }
  return { status: "ambiguous-no-retry", reason: "DELETE_REQUEST_UNCERTAIN" };
}

function classifyDeleteResult(result) {
  if (result?.success === true) return { status: "deleted", reason: "CONFIRMED" };
  if (String(result?.message ?? "").toLowerCase() === "captcha") {
    return { status: "failed-preflight", reason: "CAPTCHA_REQUIRED" };
  }
  return { status: "ambiguous-no-retry", reason: "DELETE_NOT_CONFIRMED" };
}

async function verifyPostVisibility({ galleryId, postId, userAgent, fetchImpl = fetch }) {
  const target = new URL(`https://m.dcinside.com/board/${encodeURIComponent(galleryId)}/${encodeURIComponent(postId)}`);
  target.searchParams.set("hanabit_delete_verify", Date.now().toString());
  let response;
  try {
    response = await fetchImpl(target.href, {
      headers: {
        "user-agent": userAgent || "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Mobile Safari/537.36",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return "unknown";
  }
  if (response.status === 404 || response.status === 410) return "absent";
  if (!response.ok) return "unknown";
  const html = String(await response.text()).slice(0, 500_000);
  const escapedPostId = String(postId).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const exactPostInput = new RegExp(
    `<input[^>]+(?:id|name)=["']no["'][^>]+value=["']${escapedPostId}["']|` +
    `<input[^>]+value=["']${escapedPostId}["'][^>]+(?:id|name)=["']no["']`,
    "iu",
  );
  if (exactPostInput.test(html)) return "present";
  if (/삭제된 게시물|존재하지 않는 게시물|게시물이 존재하지|해당 게시물은 존재하지/iu.test(html)) {
    return "absent";
  }
  return "unknown";
}

async function deleteNewsPost({ jobPath, publisherRoot }) {
  if (process.env.PUBLISH_DRY_RUN !== "false") throw new Error("DRY_RUN_ENABLED");
  const job = validateJob(JSON.parse(fs.readFileSync(jobPath, "utf8")), jobPath);
  if (!path.isAbsolute(publisherRoot) || !fs.statSync(publisherRoot).isDirectory()) {
    throw new Error("PUBLISHER_UNAVAILABLE");
  }
  const credentials = automatedDcCredentials();
  if (!credentials) throw new Error("CREDENTIALS_UNAVAILABLE");
  const publisherRequire = createRequire(path.join(publisherRoot, "package.json"));
  const dc = publisherRequire("@gurumnyang/dcinside.js");
  const userAgent = process.env.DC_USER_AGENT?.trim() || undefined;
  const login = await dc.mobileLogin({
    code: credentials.id,
    password: credentials.password,
    keepLoggedIn: process.env.DC_KEEP_LOGGED_IN !== "false",
    userAgent,
  });
  if (!login.success || !login.jar) throw new Error("LOGIN_FAILED");

  writeResult(job.resultPath, {
    status: "submitting",
    postId: String(job.postId),
    submittedAt: new Date().toISOString(),
  });
  let outcome;
  try {
    const result = await dc.deleteMobilePost({
      galleryId: job.galleryId,
      postId: String(job.postId),
      jar: login.jar,
      userAgent,
    });
    outcome = classifyDeleteResult(result);
  } catch (error) {
    outcome = classifyDeleteError(error);
  }
  const visibility = await verifyPostVisibility({
    galleryId: job.galleryId,
    postId: String(job.postId),
    userAgent,
  });
  if (visibility === "absent") {
    outcome = { status: "deleted", reason: "PUBLIC_ABSENCE_CONFIRMED" };
  } else if (visibility === "present") {
    outcome = { status: "failed-preflight", reason: "POST_STILL_VISIBLE" };
  }
  writeResult(job.resultPath, {
    ...outcome,
    postId: String(job.postId),
    submittedAt: new Date().toISOString(),
  });
}

async function main() {
  const jobInput = argumentValue("--job");
  const publisherRootInput = argumentValue("--publisher-root");
  if (!jobInput || !publisherRootInput) return void (process.exitCode = 1);
  const jobPath = path.resolve(jobInput);
  const publisherRoot = path.resolve(publisherRootInput);
  const resultPath = path.join(path.dirname(jobPath), "result.json");
  try {
    await deleteNewsPost({ jobPath, publisherRoot });
  } catch {
    writeResult(resultPath, { status: "failed-preflight", submittedAt: new Date().toISOString() });
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  automatedDcCredentials,
  classifyDeleteError,
  classifyDeleteResult,
  validateJob,
  verifyPostVisibility,
};
