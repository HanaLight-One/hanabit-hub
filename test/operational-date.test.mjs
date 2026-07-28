import assert from "node:assert/strict";
import test from "node:test";
import { operationalDate } from "../src/modules/images/operational-date.mjs";

test("서울 시간 02시 전에는 전날 운영일을 유지한다", () => {
  assert.equal(operationalDate(new Date("2026-07-28T16:59:59Z")), "2026-07-28");
});

test("서울 시간 02시부터 새 운영일을 사용한다", () => {
  assert.equal(operationalDate(new Date("2026-07-28T17:00:00Z")), "2026-07-29");
});

test("월 경계에서도 02시 기준을 적용한다", () => {
  assert.equal(operationalDate(new Date("2026-07-31T16:30:00Z")), "2026-07-31");
  assert.equal(operationalDate(new Date("2026-07-31T17:00:00Z")), "2026-08-01");
});
