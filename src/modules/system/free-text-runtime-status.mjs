import { stat } from "node:fs/promises";
import path from "node:path";

async function isFile(filePath) {
  if (!path.isAbsolute(filePath ?? "")) return false;

  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function createFreeTextRuntimeStatus({
  appRoot,
  runnerPath,
  pythonExecutablePath,
  keyStorePath,
} = {}) {
  const trackedRunnerPath = path.join(
    appRoot ?? "",
    "tools",
    "openai-free",
    "invoke-free-text.ps1",
  );

  return Object.freeze({
    async read() {
      const [runnerReady, pythonReady, keyStoreReady] = await Promise.all([
        isFile(runnerPath),
        isFile(pythonExecutablePath),
        isFile(keyStorePath),
      ]);
      const trackedSource =
        runnerReady &&
        path.resolve(runnerPath) === path.resolve(trackedRunnerPath);

      return Object.freeze({
        ready: runnerReady && pythonReady && keyStoreReady,
        mode: trackedSource
          ? "tracked-source-external-runtime"
          : "external-or-unconfigured",
        components: Object.freeze({
          runner: Object.freeze({ ready: runnerReady, tracked: trackedSource }),
          python: Object.freeze({ ready: pythonReady }),
          keyStore: Object.freeze({ ready: keyStoreReady }),
        }),
      });
    },
  });
}
