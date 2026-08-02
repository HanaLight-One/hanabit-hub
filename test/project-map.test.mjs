import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { APP_ROOT } from "../src/config.mjs";

test("프로젝트 지도는 현재 백엔드 모듈과 React 진입점을 빠짐없이 가리킨다", async () => {
  const map = await readFile(path.join(APP_ROOT, "PROJECT_MAP.md"), "utf8");
  const backendModules = (await readdir(path.join(APP_ROOT, "src", "modules"), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const reactModules = (await readdir(path.join(APP_ROOT, "frontend"), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const moduleName of backendModules) {
    assert.match(map, new RegExp(`src/modules/${moduleName}/`, "u"));
  }
  for (const moduleName of reactModules) {
    assert.match(map, new RegExp(`frontend/${moduleName}/main\\.jsx`, "u"));
  }
  assert.match(map, /state\/hanabit-hub\.sqlite.*직접 업로드 출처\(v5\).*DC 편집실 상태/u);
  assert.doesNotMatch(map, /[A-Z]:\\Users\\/u);
});
