import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("뉴스 감시기는 무료 API의 외부 Python과 키 저장소 설정을 함께 전달한다", async () => {
  const source = await readFile(
    new URL("../scripts/watch-discord-announcements.mjs", import.meta.url),
    "utf8",
  );
  const processorCall = source.match(/createNewsProcessor\(\{[\s\S]*?\}\);/u)?.[0] ?? "";

  assert.match(source, /generationConfig\?\.freeTextPythonExecutablePath/u);
  assert.match(source, /generationConfig\?\.freeTextKeyStorePath/u);
  assert.match(processorCall, /pythonExecutablePath/u);
  assert.match(processorCall, /keyStorePath/u);
});
