import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const POWERSHELL = path.join(
  String(process.env.SystemRoot ?? ""),
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const MAX_INGREDIENTS = 40;
const MAX_POSE_DIRECTION_LENGTH = 1_200;
const POSE_INTENSITIES = Object.freeze({
  stable: Object.freeze([
    "eye_level_medium", "clean_halfbody", "clean_fullbody", "balanced_two_shot",
    "readable_group", "environmental_wide", "seated_medium",
  ]),
  mild_dynamic: Object.freeze([
    "slight_high_angle", "slight_low_angle", "over_shoulder", "top_down",
    "prop_near_face", "foreground_prop", "hand_near_camera", "mild_wide_angle",
    "asymmetric_two_shot", "layered_group", "contextual_closeup",
  ]),
  strong_dynamic: Object.freeze([
    "playful_fisheye", "dramatic_low_angle", "dramatic_top_down",
    "reaching_toward_camera", "extreme_foreground_prop", "strong_foreshortening",
    "thematic_face_closeup",
  ]),
});

function presetIngredient(id, name, weight) {
  return Object.freeze({ id, name, weight, enabled: true });
}

function oraclePreset(id, name, defaultChaos, direction, ingredients) {
  return Object.freeze({
    id,
    name,
    defaultChaos,
    direction,
    defaultIngredients: Object.freeze(ingredients.map((item) => presetIngredient(...item))),
  });
}

const ORACLE_PRESETS = Object.freeze([
  oraclePreset("random", "완전 무작위", 68, "Follow the selected ingredients without an extra mood preset.", [
    ["random-wrong-place", "의외의 장소", 62], ["random-strange-pair", "낯선 조합", 68],
    ["random-emotion-turn", "감정의 반전", 52], ["random-light", "극적인 빛", 45],
    ["random-small-event", "작은 사건", 58], ["random-surreal", "초현실", 48],
  ]),
  oraclePreset("happy-peace", "행복한 평화", 22, "Create a peaceful, safe scene filled with small visible happiness and relaxed interactions.", [
    ["peace-relief", "포근한 안도", 82], ["peace-kindness", "다정한 교감", 78],
    ["peace-sunlight", "부드러운 햇살", 72], ["peace-small-joy", "소소한 행복", 88],
    ["peace-daily", "안전한 일상", 76], ["peace-color", "온화한 색감", 52],
  ]),
  oraclePreset("warm-sunlight", "따스한 햇살 아래 어느 날", 25, "Center warm sunlight, soft shadows, and an ordinary moment that feels gently cherished.", [
    ["sun-afternoon", "늦은 오후 햇살", 92], ["sun-shadow", "길게 드리운 그림자", 62],
    ["sun-breeze", "산들바람", 46], ["sun-ordinary", "평범한 하루", 78],
    ["sun-cherished", "소중한 순간", 72], ["sun-warmth", "따뜻한 온기", 82],
  ]),
  oraclePreset("sentimental-season", "센치한 계절감", 38, "Make the current season emotionally tangible through air, color, texture, and quiet nostalgia.", [
    ["season-air", "계절의 공기", 88], ["season-faded", "빛바랜 색", 64],
    ["season-wind", "바람에 흔들림", 68], ["season-longing", "조용한 그리움", 74],
    ["season-trace", "오래된 흔적", 52], ["season-passing", "지나가는 순간", 70],
  ]),
  oraclePreset("rainy-day", "비가 오는 어느 날", 34, "Build the scene around rain, wet reflections, shelter, and a memorable action shaped by the weather.", [
    ["rain-fall", "선명한 빗줄기", 92], ["rain-reflection", "젖은 반사광", 82],
    ["rain-shelter", "작은 피난처", 70], ["rain-umbrella", "우산", 58],
    ["rain-puddle", "물웅덩이", 66], ["rain-action", "비 속의 행동", 74],
  ]),
  oraclePreset("snowy-day", "눈이 오는 어느 날", 34, "Build the scene around falling snow, cold air, accumulated texture, and a warm or striking focal action.", [
    ["snow-fall", "함박눈", 92], ["snow-pile", "소복이 쌓인 눈", 82],
    ["snow-breath", "차가운 숨", 68], ["snow-light", "따뜻한 불빛", 78],
    ["snow-footprint", "이어지는 발자국", 62], ["snow-action", "눈 속의 행동", 72],
  ]),
  oraclePreset("seasonal-downpour", "계절이 비처럼 쏟아져", 66, "Turn recognizable signs of a season into an impossible downpour while keeping the scene visually coherent.", [
    ["downpour-season", "계절의 상징", 88], ["downpour-objects", "쏟아지는 사물", 92],
    ["downpour-weather", "비현실적인 날씨", 80], ["downpour-motion", "휘날리는 움직임", 76],
    ["downpour-reaction", "놀란 일상", 66], ["downpour-focus", "선명한 중심 사건", 72],
  ]),
  oraclePreset("dream-chaos", "몽환적 혼돈", 78, "Use dream logic, fluid scale, strange transitions, and beautiful contradictions that still form one drawable scene.", [
    ["dream-logic", "꿈의 논리", 94], ["dream-scale", "뒤틀린 크기", 78],
    ["dream-boundary", "흐르는 경계", 84], ["dream-contradiction", "아름다운 모순", 86],
    ["dream-connection", "낯선 연결", 90], ["dream-light", "몽환적인 빛", 74],
  ]),
  oraclePreset("daily-collapse", "일상 붕괴", 84, "Begin with an ordinary daily place, then let its familiar rules visibly fail in one surprising but coherent event.", [
    ["collapse-place", "익숙한 장소", 82], ["collapse-rule", "무너진 일상 규칙", 96],
    ["collapse-chain", "연쇄 반응", 80], ["collapse-people", "당황한 사람들", 68],
    ["collapse-physics", "물리 법칙의 오류", 88], ["collapse-focus", "선명한 중심 사건", 76],
  ]),
  oraclePreset("cute-disaster", "귀여운 재난", 76, "Create a harmless, non-graphic disaster caused by cute beings or objects; make the scale dramatic but nobody is injured.", [
    ["cute-cause", "귀여운 원인", 96], ["cute-chaos", "거대한 소동", 88],
    ["cute-safe", "다치지 않는 재난", 100], ["cute-response", "진지한 대응", 70],
    ["cute-props", "쏟아지는 소품", 74], ["cute-energy", "밝은 에너지", 68],
  ]),
  oraclePreset("cosmic-omen", "우주적 불길함", 88, "Introduce a vast cosmic omen and quiet unease without graphic horror, while preserving a strong readable composition.", [
    ["cosmic-body", "거대한 천체", 94], ["cosmic-sky", "불가능한 하늘", 92],
    ["cosmic-unease", "고요한 불안", 86], ["cosmic-daily", "미세한 일상", 58],
    ["cosmic-shadow", "낯선 그림자", 78], ["cosmic-scale", "압도적인 규모", 90],
  ]),
  oraclePreset("why-is-it-there", "그게 왜 거기 있어", 92, "Place one unmistakably impossible and contextually wrong thing at the center, and let the rest of the scene react seriously to it.", [
    ["wrong-object", "엉뚱한 물체", 100], ["wrong-place", "너무 평범한 장소", 82],
    ["wrong-reaction", "진지한 반응", 92], ["wrong-arrival", "설명되지 않는 등장", 96],
    ["wrong-scale", "크기 불균형", 78], ["wrong-focus", "단 하나의 중심", 88],
  ]),
]);
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
    presets: ORACLE_PRESETS.map(({ id, name, defaultChaos, defaultIngredients }) => ({
      id,
      name,
      defaultChaos,
      defaultIngredients: defaultIngredients.map((item) => ({ ...item })),
    })),
    limits: { ingredients: MAX_INGREDIENTS },
  };
}

function findPreset(value) {
  const id = String(value ?? "random").trim();
  const preset = ORACLE_PRESETS.find((item) => item.id === id);
  if (!preset) throw oracleError("INVALID_PRESET", "알 수 없는 혼돈 프리셋이에요.");
  return preset;
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

function poseResponseSchema(intensity, preset) {
  return {
    type: "object",
    properties: {
      intensity: { type: "string", enum: [intensity] },
      preset: { type: "string", enum: [preset] },
      direction: { type: "string", minLength: 20, maxLength: MAX_POSE_DIRECTION_LENGTH },
    },
    required: ["intensity", "preset", "direction"],
    additionalProperties: false,
  };
}

function normalizePoseRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw oracleError("INVALID_POSE_REQUEST", "구도 추천 요청을 확인해주세요.");
  }
  const scene = String(value.scene ?? "").trim();
  if (scene.length < 3 || scene.length > 12_000) {
    throw oracleError("INVALID_POSE_REQUEST", "장면 요청을 3자 이상 입력해주세요.");
  }
  const requestedIntensity = String(value.intensity ?? "auto");
  if (!["auto", ...Object.keys(POSE_INTENSITIES)].includes(requestedIntensity)) {
    throw oracleError("INVALID_POSE_REQUEST", "구도 강도를 확인해주세요.");
  }
  const characterMode = String(value.characterMode ?? "auto");
  if (!["auto", "none", "custom"].includes(characterMode)) {
    throw oracleError("INVALID_POSE_REQUEST", "등장인물 선택을 확인해주세요.");
  }
  const characters = Array.isArray(value.characters)
    ? value.characters.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (characters.length > 10 || characters.some((item) => item.length > 80)) {
    throw oracleError("INVALID_POSE_REQUEST", "등장인물 목록을 확인해주세요.");
  }
  if ((characterMode === "custom") !== (characters.length > 0)) {
    throw oracleError("INVALID_POSE_REQUEST", "등장인물 선택과 이름 목록이 맞지 않아요.");
  }
  const batchMode = String(value.batchMode ?? "single");
  if (!["single", "per-character", "variants"].includes(batchMode)) {
    throw oracleError("INVALID_POSE_REQUEST", "출력 묶음을 확인해주세요.");
  }
  const recentDirections = Array.isArray(value.recentDirections)
    ? value.recentDirections.slice(0, 3).map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (recentDirections.some((item) => item.length > MAX_POSE_DIRECTION_LENGTH)) {
    throw oracleError("INVALID_POSE_REQUEST", "최근 구도 문장이 너무 길어요.");
  }
  const style = String(value.style ?? "").trim();
  if (style.length > 300) throw oracleError("INVALID_POSE_REQUEST", "화풍 설명이 너무 길어요.");
  return Object.freeze({
    scene,
    requestedIntensity,
    characterMode,
    characters: Object.freeze(characters),
    batchMode,
    style,
    sourceImage: value.sourceImage === true,
    recentDirections: Object.freeze(recentDirections),
  });
}

function choosePoseIntensity(request, random) {
  if (request.requestedIntensity !== "auto") return request.requestedIntensity;
  const effectiveCount = request.batchMode === "per-character"
    ? 1
    : request.characterMode === "custom"
      ? request.characters.length
      : request.characterMode === "none" ? 0 : null;
  const roll = random();
  let selected = roll < 0.55 ? "stable" : roll < 0.85 ? "mild_dynamic" : "strong_dynamic";
  if ((effectiveCount ?? 1) >= 3 && selected === "strong_dynamic") selected = "mild_dynamic";
  return selected;
}

function choosePosePreset(intensity, random) {
  const presets = POSE_INTENSITIES[intensity];
  return presets[Math.min(presets.length - 1, Math.floor(random() * presets.length))];
}

function buildPosePrompt(request, intensity, preset) {
  const effectiveCast = request.batchMode === "per-character"
    ? "Each output is a one-character image even if several character names are selected."
    : request.characterMode === "custom"
      ? `Exact requested cast (${request.characters.length}): ${request.characters.join(", ")}`
      : request.characterMode === "none"
        ? "No characters are requested. Do not invent a person or creature."
        : "Characters are selected later. Suggest a flexible composition for one to three characters without inventing names.";
  return [
    "You are the composition and pose advisor for a vertical 3:4 image studio.",
    "Return one editable Korean direction as JSON. Do not generate an image and do not rewrite the scene prompt.",
    "Describe camera angle, framing, body pose or object placement, depth, and the visual focus in one compact paragraph.",
    "Keep the result concrete and drawable. Avoid generic praise, emotional commentary, and multiple alternatives.",
    `Requested intensity: ${request.requestedIntensity}. Chosen safe intensity: ${intensity}. Suggested preset: ${preset}.`,
    effectiveCast,
    request.characterMode === "custom" && request.batchMode !== "per-character"
      ? "Preserve the exact requested character count. Every requested character must appear clearly and distinctly; never omit, merge, replace, or reduce them to one representative character."
      : "",
    request.characterMode === "custom" && request.characters.length >= 3 && request.batchMode !== "per-character"
      ? "Use readable spacing and layered depth. Avoid extreme close-ups, fisheye distortion, or poses that hide members of the group."
      : "",
    "If the scene requests a speech bubble or visible text, reserve clean negative space for it.",
    request.sourceImage
      ? "A source image is attached for reference. Do not force-copy its pose or camera angle; recommend a fresh composition that still respects the user's scene."
      : "No source image is attached.",
    `Style context: ${request.style || "automatic or unspecified"}`,
    `Scene prompt: ${request.scene}`,
    request.recentDirections.length
      ? `Avoid repeating these recent directions: ${request.recentDirections.join(" | ")}`
      : "No recent pose directions to avoid.",
    "Write 1 to 3 Korean sentences, 40 to 350 Korean characters. The direction must work as an instruction appended to an image prompt.",
  ].filter(Boolean).join("\n");
}

function buildPrompt({ chaos, ingredients, preset }) {
  return [
    "You are the scene oracle for an image creation studio.",
    "Write one surprising Korean scene prompt. Return JSON matching the schema.",
    "Invent a concrete visual event, location, action, atmosphere, and one memorable detail.",
    "The result must stand alone and must not mention this instruction, weights, dice, or an oracle.",
    "Do not choose or describe named characters, identity anchors, art styles, rendering techniques, image ratios, or model settings.",
    "Do not ask questions. Do not make a collage, split screen, text poster, or multiple alternative prompts.",
    `Chaos level: ${chaos}/100. Higher means stranger associations, while the final scene must still be drawable and internally coherent.`,
    `Mood preset: ${preset.name}. Direction: ${preset.direction}`,
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
      const savedSettings = await readSettings();
      const chaos = value.chaos === undefined
        ? savedSettings.chaos
        : boundedInteger(value.chaos, 0, 100, "혼돈도");
      const settings = value.ingredients === undefined
        ? savedSettings
        : normalizeSettings({ chaos, ingredients: value.ingredients });
      const preset = findPreset(value.preset);
      const selected = selectOracleIngredients({ ...settings, chaos }, random);
      const promptPath = path.join(workRoot, "prompt.txt");
      const schemaPath = path.join(workRoot, "response-schema.json");
      const outputPath = path.join(workRoot, "output.json");
      await mkdir(workRoot, { recursive: true });
      await Promise.all([
        writeFile(promptPath, `${buildPrompt({ chaos, ingredients: selected, preset })}\n`, "utf8"),
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
        preset: Object.freeze({ id: preset.id, name: preset.name }),
        ingredients: Object.freeze(selected.map(({ id, name, weight }) => ({ id, name, weight }))),
      });
    } finally {
      busy = false;
      await rm(workRoot, { recursive: true, force: true });
    }
  }

  async function suggestPose(value = {}) {
    if (busy) throw oracleError("BUSY", "다른 무료 API 작업을 준비하고 있어요.");
    busy = true;
    const workRoot = path.join(runtimeRoot, randomUUID());
    try {
      if (!(await stat(runnerPath)).isFile()) throw oracleError("NOT_READY", "무료 API 실행기가 준비되지 않았어요.");
      const request = normalizePoseRequest(value);
      const intensity = choosePoseIntensity(request, random);
      const preset = choosePosePreset(intensity, random);
      const promptPath = path.join(workRoot, "prompt.txt");
      const schemaPath = path.join(workRoot, "response-schema.json");
      const outputPath = path.join(workRoot, "output.json");
      await mkdir(workRoot, { recursive: true });
      await Promise.all([
        writeFile(promptPath, `${buildPosePrompt(request, intensity, preset)}\n`, "utf8"),
        writeFile(schemaPath, `${JSON.stringify(poseResponseSchema(intensity, preset), null, 2)}\n`, "utf8"),
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
      const direction = String(output?.direction ?? "").trim();
      if (
        output?.intensity !== intensity ||
        output?.preset !== preset ||
        direction.length < 20 || direction.length > MAX_POSE_DIRECTION_LENGTH
      ) {
        throw oracleError("INVALID_RESPONSE", "무료 API 구도 문장 형식이 올바르지 않아요.");
      }
      return Object.freeze({ intensity, preset, direction });
    } finally {
      busy = false;
      await rm(workRoot, { recursive: true, force: true });
    }
  }

  return Object.freeze({
    async readSettings() { return publicSettings(await readSettings()); },
    updateSettings,
    reroll,
    suggestPose,
  });
}
