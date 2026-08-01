import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadXSourceAllowlist, loadXSourceRoster } from "../src/modules/news/x-watch-source.mjs";

async function withRoster(payload, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-x-roster-"));
  const target = path.join(root, "sources.json");
  try {
    await writeFile(target, JSON.stringify(payload), "utf8");
    return await callback(target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const source = {
  handle: "OpenAI",
  displayName: "OpenAI",
  sourceKind: "official",
  affiliation: "OpenAI",
  affiliationStatus: "confirmed",
  roles: ["official-publisher"],
  topics: ["models", "products"],
  trustLevel: "official",
  verifiedAt: "2026-08-01",
  enabled: true,
};

test("X 인물 명부는 소속·분야·신뢰등급·마지막 확인일을 보존한다", async () => {
  await withRoster({ schemaVersion: 1, sources: [source] }, async (target) => {
    const roster = await loadXSourceRoster(target);
    assert.deepEqual(roster.sources[0], source);
    assert.deepEqual(await loadXSourceAllowlist(target), new Set(["openai"]));
  });
});

test("후보는 활성화할 수 있지만 소속 종료 계정은 자동 감시하지 않는다", async () => {
  const candidate = {
    ...source,
    handle: "TIBOLA",
    displayName: "Tibola",
    sourceKind: "candidate",
    affiliationStatus: "review_required",
    roles: ["codex-product"],
    trustLevel: "candidate",
    verifiedAt: null,
  };
  await withRoster({ schemaVersion: 1, sources: [source, candidate] }, async (target) => {
    assert.deepEqual(await loadXSourceAllowlist(target), new Set(["openai", "tibola"]));
  });
  await assert.rejects(
    withRoster({ schemaVersion: 1, sources: [{ ...source, affiliationStatus: "former" }] },
      (target) => loadXSourceRoster(target)),
    /소속 종료/,
  );
});

test("중복 계정과 불완전한 인물 명부는 거부한다", async () => {
  await assert.rejects(
    withRoster({ schemaVersion: 1, sources: [source, { ...source, handle: "openai" }] },
      (target) => loadXSourceRoster(target)),
    /중복/,
  );
  await assert.rejects(
    withRoster({ schemaVersion: 1, sources: [{ ...source, topics: [] }] },
      (target) => loadXSourceRoster(target)),
    /분야/,
  );
});
