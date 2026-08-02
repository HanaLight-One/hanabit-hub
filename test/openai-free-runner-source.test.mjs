import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

test("공용 무료 텍스트 실행기 정본은 키 없이 구조화 출력 계약을 보존한다", async () => {
  const [wrapper, runner, ignore] = await Promise.all([
    readFile(path.join(ROOT, "tools", "openai-free", "invoke-free-text.ps1"), "utf8"),
    readFile(path.join(ROOT, "tools", "openai-free", "invoke-free-text.py"), "utf8"),
    readFile(path.join(ROOT, "tools", "openai-free", ".gitignore"), "utf8"),
  ]);

  assert.match(wrapper, /\[string\]\$JsonSchemaFile/);
  assert.match(wrapper, /--json-schema-file/);
  assert.match(runner, /"type": "json_schema"/);
  assert.match(runner, /"strict": True/);
  assert.match(runner, /client\.responses\.create/);
  assert.doesNotMatch(wrapper + runner, /sk-[A-Za-z0-9_-]{16,}/);
  assert.match(ignore, /^runtime\/$/m);
});

test("정본 동기화는 고정 allowlist와 명시적 확인 문구만 허용한다", async () => {
  const script = await readFile(path.join(ROOT, "scripts", "sync-openai-free-runner.ps1"), "utf8");
  assert.match(script, /ValidateSet\("sync-openai-free-runner"\)/);
  assert.match(script, /\$allowedFiles = @\(/);
  assert.doesNotMatch(script, /runtime\\|openai-api-key\.dpapi|\.env/);
});
