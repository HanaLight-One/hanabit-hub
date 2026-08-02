import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFreeTextRuntimeStatus } from "../src/modules/system/free-text-runtime-status.mjs";
import { createServer } from "../src/server.mjs";

test("무료 텍스트 실행기 상태는 준비 여부만 반환하고 경로는 숨긴다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-free-runtime-"));
  try {
    const runnerPath = path.join(root, "tools", "openai-free", "invoke-free-text.ps1");
    const pythonExecutablePath = path.join(root, "runtime", "python.exe");
    const keyStorePath = path.join(root, "runtime", "key.dpapi");
    await mkdir(path.dirname(runnerPath), { recursive: true });
    await mkdir(path.dirname(pythonExecutablePath), { recursive: true });
    await Promise.all([
      writeFile(runnerPath, "runner", "utf8"),
      writeFile(pythonExecutablePath, "python", "utf8"),
      writeFile(keyStorePath, "key", "utf8"),
    ]);

    const status = await createFreeTextRuntimeStatus({
      appRoot: root,
      runnerPath,
      pythonExecutablePath,
      keyStorePath,
    }).read();

    assert.deepEqual(status, {
      ready: true,
      mode: "tracked-source-external-runtime",
      components: {
        runner: { ready: true, tracked: true },
        python: { ready: true },
        keyStore: { ready: true },
      },
    });
    assert.equal(JSON.stringify(status).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("무료 텍스트 실행기 상태 API는 읽기 전용 안전 계약만 제공한다", async () => {
  const payload = {
    ready: false,
    mode: "external-or-unconfigured",
    components: {
      runner: { ready: false, tracked: false },
      python: { ready: true },
      keyStore: { ready: true },
    },
  };
  const server = createServer({
    systemFreeTextRuntime: { async read() { return payload; } },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/system/free-text-runtime`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
    assert.equal(
      (await fetch(`${baseUrl}/api/system/free-text-runtime`, { method: "POST" })).status,
      405,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("홈은 무료 뉴스 분석기 상태를 안전 API에서 읽는다", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const html = await import("node:fs/promises").then(({ readFile }) =>
    readFile(path.join(root, "public", "index.html"), "utf8"),
  );
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(path.join(root, "public", "app.js"), "utf8"),
  );
  assert.equal(html.includes('id="free-text-runtime-status"'), true);
  assert.equal(source.includes('/api/system/free-text-runtime'), true);
  assert.equal(source.includes("runnerPath"), false);
  assert.equal(source.includes("keyStorePath"), false);
});
