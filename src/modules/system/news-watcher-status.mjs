import { stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STALE_AFTER_MS = 20 * 60 * 1000;

export function createNewsWatcherStatus({
  signalPath,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = () => new Date(),
} = {}) {
  if (!path.isAbsolute(signalPath ?? "")) {
    return Object.freeze({
      async read() {
        return { ready: false, state: "unavailable", lastSeenAt: null };
      },
    });
  }

  return Object.freeze({
    async read() {
      try {
        const info = await stat(signalPath);
        if (!info.isFile()) {
          return { ready: false, state: "unavailable", lastSeenAt: null };
        }

        const ageMs = Math.max(0, now().getTime() - info.mtime.getTime());
        const ready = ageMs <= staleAfterMs;
        return {
          ready,
          state: ready ? "connected" : "stale",
          lastSeenAt: info.mtime.toISOString(),
        };
      } catch {
        return { ready: false, state: "unavailable", lastSeenAt: null };
      }
    },
  });
}
