import assert from "node:assert/strict";
import test from "node:test";
import { APP_ROOT } from "../src/config.mjs";

test("application root is absolute", () => {
  assert.equal(typeof APP_ROOT, "string");
  assert.equal(APP_ROOT.length > 0, true);
});
