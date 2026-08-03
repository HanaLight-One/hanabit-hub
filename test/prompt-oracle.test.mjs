import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPromptOracle, selectOracleIngredients } from "../src/modules/images/prompt-oracle.mjs";

test("혼돈의 신탁은 활성 가중 재료만 골라 최대 다섯 개로 제한한다", () => {
  const settings = {
    chaos: 90,
    ingredients: [
      { id: "a", name: "빛", weight: 100, enabled: true },
      { id: "b", name: "어둠", weight: 100, enabled: false },
      { id: "c", name: "환상", weight: 100, enabled: true },
      { id: "d", name: "일상", weight: 100, enabled: true },
      { id: "e", name: "축제", weight: 100, enabled: true },
      { id: "f", name: "비밀", weight: 100, enabled: true },
      { id: "g", name: "비", weight: 100, enabled: true },
    ],
  };
  const selected = selectOracleIngredients(settings, () => 0.1);
  assert.equal(selected.length, 5);
  assert.equal(selected.some((item) => item.id === "b"), false);
});

test("혼돈 설정을 state에 저장하고 무료 API 결과만 안전하게 반환한다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanabit-oracle-"));
  const runnerPath = path.join(root, "runner.ps1");
  await writeFile(runnerPath, "# mock", "utf8");
  const oracle = createPromptOracle({
    settingsPath: path.join(root, "state", "settings.json"),
    runtimeRoot: path.join(root, "runtime"),
    runnerPath,
    random: () => 0.1,
    async runProcess(_command, args) {
      const outputPath = args[args.indexOf("-Output") + 1];
      const promptPath = args[args.indexOf("-PromptFile") + 1];
      const prompt = await readFile(promptPath, "utf8");
      assert.match(prompt, /Selected ingredients:/u);
      assert.match(prompt, /빛/u);
      assert.match(prompt, /판타지/u);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify({
        scene: "달빛을 보관하는 수상 도서관에서 유리 물고기들이 반납되지 않은 꿈을 책갈피처럼 정리한다.",
      }), "utf8");
    },
  });

  const saved = await oracle.updateSettings({
    chaos: 82,
    ingredients: [
      { id: "light", name: "빛", weight: 100, enabled: true },
      { id: "fantasy", name: "판타지", weight: 100, enabled: true },
    ],
  });
  assert.equal(saved.chaos, 82);
  const result = await oracle.reroll({ chaos: 91 });
  assert.equal(result.chaos, 91);
  assert.deepEqual(result.ingredients.map((item) => item.name).sort(), ["빛", "판타지"].sort());
  assert.match(result.scene, /수상 도서관/u);
  assert.equal("runnerPath" in result, false);
});
