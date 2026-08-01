import assert from "node:assert/strict";
import test from "node:test";
import { loadXStreamConfig } from "../src/modules/news/x-stream-config.mjs";

test("X 스트림은 기본 비활성 상태에서 토큰을 요구하지 않는다", () => {
  assert.deepEqual(loadXStreamConfig({ env: {} }), { enabled: false, bearerToken: "" });
});

test("X 스트림 활성화에는 비밀 토큰이 필요하다", () => {
  assert.throws(() => loadXStreamConfig({ env: { X_STREAM_ENABLED: "true" } }), /X_BEARER_TOKEN/);
  const token = "x".repeat(80);
  assert.deepEqual(loadXStreamConfig({ env: { X_STREAM_ENABLED: "true", X_BEARER_TOKEN: token } }), {
    enabled: true,
    bearerToken: token,
  });
});

