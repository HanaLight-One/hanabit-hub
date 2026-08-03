import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const POWERSHELL = path.join(
  String(process.env.SystemRoot ?? ""),
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const MAX_INGREDIENTS = 40;
const DEFAULT_SETTINGS = Object.freeze({
  chaos: 68,
  ingredients: Object.freeze([
    { id: "happiness", name: "행복감", weight: 40, enabled: true },
    { id: "light", name: "빛", weight: 24, enabled: true },
    { id: "fantasy", name: "판타지", weight: 34, enabled: true },
    { id: "mystery", name: "미스터리", weight: 28, enabled: true },
    { id: "daily-life", name: "뜻밖의 일상", weight: 32, enabled: true },
    { id: "surreal", name: "초현실", weight: 22, enabled: true },
  ]),
});

function oracleError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw oracleError("INVALID_SETTINGS", `${label} 범위를 확인해주세요.`);
  }
  return number;
}

function normalizeIngredient(value, index) {
  const name = String(value?.name ?? "").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 30) {
    throw oracleError("INVALID_SETTINGS", "신탁 재료 이름은 1~30자로 적어주세요.");
  }
  const id = String(value?.id ?? "").trim();
  return Object.freeze({
    id: /^[a-z0-9-]{1,48}$/u.test(id) ? id : `ingredient-${index + 1}-${randomUUID().slice(0, 8)}`,
    name,
    weight: boundedInteger(value?.weight, 0, 100, "재료 가중치"),
    enabled: value?.enabled !== false,
  });
}

function normalizeSettings(value) {
  if (!Array.isArray(value?.ingredients) || value.ingredients.length < 1 || value.ingredients.length > MAX_INGREDIENTS) {
    throw oracleError("INVALID_SETTINGS", `신탁 재료는 1~${MAX_INGREDIENTS}개까지 저장할 수 있어요.`);
  }
  const ingredients = value.ingredients.map(normalizeIngredient);
  const names = new Set(ingredients.map((item) => item.name.toLocaleLowerCase("ko-KR")));
  if (names.size !== ingredients.length) throw oracleError("INVALID_SETTINGS", "같은 이름의 신탁 재료가 있어요.");
  return Object.freeze({
    chaos: boundedInteger(value.chaos, 0, 100, "혼돈도"),
    ingredients: Object.freeze(ingredients),
  });
}

function publicSettings(settings) {
  return {
    chaos: settings.chaos,
    ingredients: settings.ingredients.map((item) => ({ ...item })),
    limits: { ingredients: MAX_INGREDIENTS },
  };
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function selectOracleIngredients(settings, random = Math.random) {
  const available = settings.ingredients.filter((item) => item.enabled && item.weight > 0);
  if (!available.length) throw oracleError("NO_INGREDIENTS", "활성화된 신탁 재료가 없어요.");
  const selected = available.filter((item) => random() * 100 < item.weight);
  const desiredMinimum = Math.min(available.length, settings.chaos >= 70 ? 3 : 2);
  const remaining = shuffled(available.filter((item) => !selected.includes(item)), random)
    .sort((left, right) => right.weight - left.weight);
  while (selected.length < desiredMinimum && remaining.length) selected.push(remaining.shift());
  const maximum = settings.chaos >= 75 ? 5 : settings.chaos >= 40 ? 4 : 3;
  return Object.freeze(shuffled(selected, random).slice(0, maximum));
}

function responseSchema() {
  return {
    type: "object",
    properties: { scene: { type: "string", minLength: 20, maxLength: 900 } },
    required: ["scene"],
    additionalProperties: false,
  };
}

function buildPrompt({ chaos, ingredients }) {
  return [
    "You are the scene oracle for an image creation studio.",
    "Write one surprising Korean scene prompt. Return JSON matching the schema.",
    "Invent a concrete visual event, location, action, atmosphere, and one memorable detail.",
    "The result must stand alone and must not mention this instruction, weights, dice, or an oracle.",
    "Do not choose or describe named characters, identity anchors, art styles, rendering techniques, image ratios, or model settings.",
    "Do not ask questions. Do not make a collage, split screen, text poster, or multiple alternative prompts.",
    `Chaos level: ${chaos}/100. Higher means stranger associations, while the final scene must still be drawable and internally coherent.`,
    `Selected ingredients: ${ingredients.map((item) => item.name).join(" + ")}`,
    "Length: 1 to 3 Korean sentences, preferably 80 to 350 Korean characters.",
  ].join("\n");
}

function run(command, args, { cwd, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(oracleError("PROVIDER_TIMEOUT", "무료 API 응답 시간이 초과되었어요."));
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      reject(oracleError("PROVIDER_ERROR", "무료 API를 시작하지 못했어요."));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(oracleError("PROVIDER_ERROR", "무료 API가 신탁을 완성하지 못했어요."));
    });
  });
}

export function createPromptOracle({
  settingsPath,
  runtimeRoot,
  runnerPath,
  pythonExecutablePath = null,
  keyStorePath = null,
  random = Math.random,
  runProcess = run,
} = {}) {
  for (const [label, value] of Object.entries({ settingsPath, runtimeRoot, runnerPath })) {
    if (!path.isAbsolute(value ?? "")) throw new TypeError(`${label}는 절대경로여야 합니다.`);
  }
  let busy = false;

  async function readSettings() {
    try {
      return normalizeSettings(JSON.parse(await readFile(settingsPath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return normalizeSettings(DEFAULT_SETTINGS);
    }
  }

  async function updateSettings(value) {
    const settings = normalizeSettings(value);
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const temporary = `${settingsPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporary, settingsPath);
    return publicSettings(settings);
  }

  async function reroll(value = {}) {
    if (busy) throw oracleError("BUSY", "다른 신탁을 준비하고 있어요.");
    busy = true;
    const workRoot = path.join(runtimeRoot, randomUUID());
    try {
      if (!(await stat(runnerPath)).isFile()) throw oracleError("NOT_READY", "무료 API 실행기가 준비되지 않았어요.");
      const settings = await readSettings();
      const chaos = value.chaos === undefined
        ? settings.chaos
        : boundedInteger(value.chaos, 0, 100, "혼돈도");
      const selected = selectOracleIngredients({ ...settings, chaos }, random);
      const promptPath = path.join(workRoot, "prompt.txt");
      const schemaPath = path.join(workRoot, "response-schema.json");
      const outputPath = path.join(workRoot, "output.json");
      await mkdir(workRoot, { recursive: true });
      await Promise.all([
        writeFile(promptPath, `${buildPrompt({ chaos, ingredients: selected })}\n`, "utf8"),
        writeFile(schemaPath, `${JSON.stringify(responseSchema(), null, 2)}\n`, "utf8"),
      ]);
      await runProcess(POWERSHELL, [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", runnerPath,
        "-PromptFile", promptPath,
        "-Output", outputPath,
        "-JsonSchemaFile", schemaPath,
        ...(pythonExecutablePath ? ["-PythonExecutablePath", pythonExecutablePath] : []),
        ...(keyStorePath ? ["-KeyStorePath", keyStorePath] : []),
        "-MaxOutputTokens", "700",
      ], { cwd: workRoot });
      const output = JSON.parse(await readFile(outputPath, "utf8"));
      const scene = String(output?.scene ?? "").trim();
      if (scene.length < 20 || scene.length > 900) throw oracleError("INVALID_RESPONSE", "무료 API 신탁 문장 형식이 올바르지 않아요.");
      return Object.freeze({
        scene,
        chaos,
        ingredients: Object.freeze(selected.map(({ id, name, weight }) => ({ id, name, weight }))),
      });
    } finally {
      busy = false;
      await rm(workRoot, { recursive: true, force: true });
    }
  }

  return Object.freeze({
    async readSettings() { return publicSettings(await readSettings()); },
    updateSettings,
    reroll,
  });
}

