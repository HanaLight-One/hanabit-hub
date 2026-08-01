import assert from "node:assert/strict";
import test from "node:test";
import { APP_ROOT, validateConfig } from "../src/config.mjs";

test("application root is absolute", () => {
  assert.equal(typeof APP_ROOT, "string");
  assert.equal(APP_ROOT.length > 0, true);
});

test("Image Studio 활성화 시 제작 기록 절대경로를 요구한다", () => {
  assert.throws(
    () =>
      validateConfig({
        host: "127.0.0.1",
        port: 8790,
        integrations: {
          imageStudio: {
            enabled: true,
            productionRecordsRoot: "",
          },
        },
        operations: {
          timezone: "Asia/Seoul",
          dayStartsAtHour: 2,
        },
        allowedActions: [],
      }),
    /productionRecordsRoot 절대경로/,
  );
});

test("운세 연동은 출력과 게시 상태 절대경로만 허용한다", () => {
  const base = {
    host: "127.0.0.1",
    port: 8790,
    operations: {
      timezone: "Asia/Seoul",
      dayStartsAtHour: 2,
    },
    allowedActions: [],
  };
  assert.throws(
    () =>
      validateConfig({
        ...base,
        integrations: {
          fortune: { enabled: true, outputRoot: "output", publisherStateRoot: "C:\\state" },
        },
      }),
    /outputRoot 절대경로/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...base,
        integrations: {
          fortune: { enabled: true, outputRoot: "C:\\output", publisherStateRoot: "state" },
        },
      }),
    /publisherStateRoot 절대경로/,
  );
});

test("서버 제어 allowlist는 알려진 작업만 허용한다", () => {
  assert.throws(
    () =>
      validateConfig({
        host: "127.0.0.1",
        port: 8790,
        integrations: {
          imageStudio: { enabled: false },
        },
        operations: {
          timezone: "Asia/Seoul",
          dayStartsAtHour: 2,
        },
        allowedActions: ["run-any-command"],
      }),
    /알 수 없는 작업/,
  );
});

test("Codex 뉴스 검토는 고정 실행 경로와 제한된 일일 상한만 허용한다", () => {
  const base = {
    host: "127.0.0.1",
    port: 8790,
    operations: { timezone: "Asia/Seoul", dayStartsAtHour: 2 },
    allowedActions: [],
  };
  assert.throws(() => validateConfig({
    ...base,
    integrations: { news: { codexReview: { enabled: true, executablePath: "codex.ps1", dailyLimit: 4 } } },
  }), /executablePath 절대경로/);
  assert.throws(() => validateConfig({
    ...base,
    integrations: { news: { codexReview: { enabled: true, executablePath: "C:\\codex.ps1", dailyLimit: 99 } } },
  }), /일일 상한/);
});
