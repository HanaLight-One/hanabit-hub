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
