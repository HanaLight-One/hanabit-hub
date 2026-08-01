import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const pages = [
  "public/index.html",
  "public/images/index.html",
  "public/images/create/index.html",
  "public/images/styles/index.html",
  "public/fortune/index.html",
  "public/news/index.html",
  "public/notifications/index.html",
  "public/setup/discord/index.html",
];

test("모든 허브 화면은 공용 Codex 잔량 표시를 불러온다", async () => {
  for (const relative of pages) {
    const html = await readFile(path.join(root, relative), "utf8");
    assert.equal(html.includes('/codex-usage-indicator.css'), true, relative);
    assert.equal(html.includes('/codex-usage-indicator.js'), true, relative);
  }
});

test("공용 잔량 표시는 헤더 상태등 앞에 붙고 일시 실패를 재시도한다", async () => {
  const source = await readFile(path.join(root, "public/codex-usage-indicator.js"), "utf8");
  assert.equal(source.includes('header.insertBefore(indicator, connection)'), true);
  assert.equal(source.includes('window.setTimeout(loadUsage, 5_000)'), true);
  assert.equal(source.includes('window.setInterval(loadUsage, 60_000)'), true);
  assert.equal(source.includes('localStorage'), false);
});

