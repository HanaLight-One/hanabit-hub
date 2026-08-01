import { spawn } from "node:child_process";
import path from "node:path";

const CACHE_MS = 60_000;
const MAX_STDOUT_BYTES = 128 * 1024;

function defaultExecutable() {
  if (process.platform !== "win32") return "codex";
  return path.join(
    process.env.APPDATA ?? "",
    "npm",
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  );
}

function safeWindow(window) {
  const usedPercent = Number(window?.usedPercent);
  const durationMinutes = Number(window?.windowDurationMins);
  const resetsAtSeconds = Number(window?.resetsAt);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
  return Object.freeze({
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
    resetsAt: Number.isFinite(resetsAtSeconds)
      ? new Date(resetsAtSeconds * 1000).toISOString()
      : null,
  });
}

function publicUsage(result, now) {
  const bucket = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  const primary = safeWindow(bucket?.primary);
  const secondary = safeWindow(bucket?.secondary);
  if (!primary && !secondary) return null;
  return Object.freeze({
    available: true,
    source: "codex-app-server",
    checkedAt: now().toISOString(),
    primary,
    secondary,
  });
}

export function createCodexUsageService({
  executablePath = defaultExecutable(),
  spawnProcess = spawn,
  timeoutMs = 8_000,
  now = () => new Date(),
} = {}) {
  let cached = null;
  let inFlight = null;

  async function fetchUsage() {
    return new Promise((resolve) => {
      let settled = false;
      let stdout = "";
      let initialized = false;
      const child = spawnProcess(executablePath, ["app-server"], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        resolve(value);
      };
      const unavailable = () => finish(Object.freeze({
        available: false,
        source: "codex-app-server",
        checkedAt: now().toISOString(),
      }));
      const timer = setTimeout(unavailable, timeoutMs);
      child.on("error", unavailable);
      child.on("exit", () => unavailable());
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_STDOUT_BYTES) return unavailable();
        let newline;
        while ((newline = stdout.indexOf("\n")) >= 0) {
          const line = stdout.slice(0, newline).trim();
          stdout = stdout.slice(newline + 1);
          if (!line) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 0 && message.result && !initialized) {
            initialized = true;
            child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
            child.stdin.write(`${JSON.stringify({ method: "account/rateLimits/read", id: 1 })}\n`);
          } else if (message.id === 1) {
            finish(publicUsage(message.result, now) ?? Object.freeze({
              available: false,
              source: "codex-app-server",
              checkedAt: now().toISOString(),
            }));
          }
        }
      });
      child.stdin.write(`${JSON.stringify({
        method: "initialize",
        id: 0,
        params: { clientInfo: { name: "hanabit_hub", title: "Hanabit Hub", version: "0.1.0" } },
      })}\n`);
    });
  }

  async function read({ refresh = false } = {}) {
    if (!refresh && cached && now().getTime() - cached.cachedAt < CACHE_MS) return cached.value;
    if (inFlight) return inFlight;
    inFlight = fetchUsage().then((value) => {
      cached = { cachedAt: now().getTime(), value };
      return value;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  return Object.freeze({ read });
}

