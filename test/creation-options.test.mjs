import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCreationOptionsCatalog } from "../src/modules/images/creation-options.mjs";

test("자산 색인에서 안전한 화풍 이름만 제공한다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-options-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const assetIndexPath = path.join(root, "asset-index.json");
  await writeFile(
    assetIndexPath,
    JSON.stringify({
      styles: [
        {
          id: "고딕",
          filename: "[화풍] 고딕.txt",
          path: path.join(root, "secret-style.txt"),
          content: "internal prompt content",
        },
        {
          id: "말랑",
          filename: "[화풍] 말랑.txt",
          path: path.join(root, "another-style.txt"),
          content: "another internal prompt",
        },
      ],
      characters: {
        헤일라: {
          name: "헤일라",
          anchor_text: "internal identity prompt",
          image_anchor_path: path.join(root, "heila.png"),
        },
        리벨라: {
          name: "리벨라",
          anchor_text: "another internal identity prompt",
          image_anchor_path: path.join(root, "rivella.png"),
        },
      },
      pink_bridge: {
        prompt_path: path.join(root, "pink-bridge.txt"),
        appearance_prompt: "internal pink bridge identity",
      },
    }),
  );
  const catalog = createCreationOptionsCatalog({ assetIndexPath });

  const result = await catalog.list();
  const serialized = JSON.stringify(result);

  assert.deepEqual(result.styles, [
    { id: "고딕", label: "고딕" },
    { id: "말랑", label: "말랑" },
  ]);
  assert.deepEqual(result.characters[0], {
    id: "pink-bridge",
    label: "핑크브릿지",
  });
  assert.deepEqual(
    result.characters.slice(1),
    [
      { id: "리벨라", label: "리벨라" },
      { id: "헤일라", label: "헤일라" },
    ],
  );
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes("filename"), false);
  assert.equal(serialized.includes("content"), false);
  assert.equal(serialized.includes("anchor_text"), false);
  assert.equal(serialized.includes("appearance_prompt"), false);
  assert.equal(serialized.includes("internal pink bridge identity"), false);
});

test("상대 자산 색인 경로를 거부한다", () => {
  assert.throws(
    () => createCreationOptionsCatalog({ assetIndexPath: "asset-index.json" }),
    /절대경로/,
  );
});
