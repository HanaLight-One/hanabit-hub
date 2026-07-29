import assert from "node:assert/strict";
import test from "node:test";
import { createCodexControl } from "../src/modules/system/codex-control.mjs";

test("비활성 Codex 제어는 상태만 안전하게 반환한다", async () => {
  const control = createCodexControl({ enabled: false });
  assert.deepEqual(await control.status(), {
    available: false,
    running: false,
    action: null,
  });
  await assert.rejects(() => control.restart(), { code: "ACTION_DISABLED" });
});

test("Codex 재기동은 고정 도우미만 한 번 실행한다", async () => {
  const launches = [];
  const control = createCodexControl({
    enabled: true,
    scriptPath: "fixed-script.ps1",
    inspectRunning: async () => true,
    launch: (request) => launches.push(request),
    clock: () => 1_000,
  });

  assert.deepEqual(await control.status(), {
    available: true,
    running: true,
    action: "restart-codex",
  });
  assert.deepEqual(await control.restart(), {
    accepted: true,
    action: "restart-codex",
  });
  assert.deepEqual(launches, [{ scriptPath: "fixed-script.ps1" }]);
  await assert.rejects(() => control.restart(), { code: "COOLDOWN" });
});
