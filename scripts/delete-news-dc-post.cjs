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
  let result;
  try {
    result = await dc.deleteMobilePost({
      galleryId: job.galleryId,
      postId: String(job.postId),
      jar: login.jar,
      userAgent,
    });
  } catch {
    writeResult(job.resultPath, {
      status: "ambiguous-no-retry",
      postId: String(job.postId),
      submittedAt: new Date().toISOString(),
    });
    return;
  }
  writeResult(job.resultPath, {
    status: result?.success === true ? "deleted" : "ambiguous-no-retry",
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

module.exports = { automatedDcCredentials, validateJob };

