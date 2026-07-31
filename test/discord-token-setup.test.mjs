import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiscordTokenSetup } from "../src/modules/news/discord-token-setup.mjs";

const TEST_TOKEN = `${"a".repeat(24)}.${"b".repeat(12)}.${"c".repeat(30)}`;

async function withSetup(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-discord-setup-"));
  const envPath = path.join(root, ".env");
  await writeFile(
    envPath,
    "DISCORD_BOT_TOKEN=\nDISCORD_GUILD_ID=123456789012345678\n",
    "utf8",
  );

  try {
    await callback({ setup: createDiscordTokenSetup({ envPath }), envPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Discord 토큰 보관함은 설정 여부만 반환한다", async () => {
  await withSetup(async ({ setup }) => {
    assert.deepEqual(await setup.status(), { configured: false });
  });
});

test("Discord 토큰은 준비된 키에 한 번만 저장한다", async () => {
  await withSetup(async ({ setup, envPath }) => {
    assert.deepEqual(await setup.save(TEST_TOKEN), {
      saved: true,
      configured: true,
    });
    assert.deepEqual(await setup.status(), { configured: true });

    const stored = await readFile(envPath, "utf8");
    assert.equal(stored.includes(`DISCORD_BOT_TOKEN=${TEST_TOKEN}`), true);
    assert.equal(stored.includes("DISCORD_GUILD_ID=123456789012345678"), true);

    await assert.rejects(() => setup.save(TEST_TOKEN), {
      code: "ALREADY_CONFIGURED",
    });
  });
});

test("Discord 토큰 보관함은 공백과 줄바꿈 입력을 거부한다", async () => {
  await withSetup(async ({ setup }) => {
    await assert.rejects(() => setup.save(`${TEST_TOKEN}\nINJECTED=value`), {
      code: "INVALID_TOKEN",
    });
  });
});

test("Discord 토큰 보관함은 절대경로만 허용한다", () => {
  assert.throws(
    () => createDiscordTokenSetup({ envPath: ".env" }),
    /절대경로/,
  );
});
