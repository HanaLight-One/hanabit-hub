import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ACTION_ID = "restart-codex";
const DEFAULT_COOLDOWN_MS = 60_000;

function createControlError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function isCodexRunning() {
  if (process.platform !== "win32") return false;

  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(
        "tasklist.exe",
        ["/FI", "IMAGENAME eq codex.exe", "/FO", "CSV", "/NH"],
        { windowsHide: true, timeout: 5_000 },
        (error, output) => (error ? reject(error) : resolve(output)),
      );
    });
    return /"codex\.exe"/i.test(stdout);
  } catch {
    return false;
  }
}

function launchRestartHelper({ scriptPath }) {
  if (process.platform !== "win32") {
    throw createControlError("UNSUPPORTED_PLATFORM", "Windows에서만 사용할 수 있습니다.");
  }

  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
}

export function createCodexControl({
  enabled = false,
  scriptPath,
  auditRoot,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  clock = () => Date.now(),
  inspectRunning = isCodexRunning,
  launch = launchRestartHelper,
} = {}) {
  let lastRequestedAt = 0;

  async function record(event) {
    if (!auditRoot) return;
    await mkdir(auditRoot, { recursive: true });
    await appendFile(
      path.join(auditRoot, "system-control.ndjson"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }

  return Object.freeze({
    async status() {
      return {
        available: enabled,
        running: enabled ? await inspectRunning() : false,
        action: enabled ? ACTION_ID : null,
      };
    },

    async restart() {
      if (!enabled) {
        throw createControlError("ACTION_DISABLED", "허용되지 않은 작업입니다.");
      }

      const now = clock();
      const retryAfterMs =
        lastRequestedAt > 0 ? lastRequestedAt + cooldownMs - now : 0;
      if (retryAfterMs > 0) {
        throw createControlError("COOLDOWN", "재기동 요청이 이미 전달되었습니다.");
      }

      lastRequestedAt = now;
      await record({
        event: "codex-restart-requested",
        at: new Date(now).toISOString(),
      });

      try {
        launch({ scriptPath });
      } catch (error) {
        lastRequestedAt = 0;
        await record({
          event: "codex-restart-launch-failed",
          at: new Date(clock()).toISOString(),
        });
        throw error;
      }

      return { accepted: true, action: ACTION_ID };
    },
  });
}

export { ACTION_ID };
