const MODE_LABELS = Object.freeze({
  new: "새 장면",
  "same-combination": "같은 조합",
  "same-characters": "등장인물 유지",
  "same-style": "같은 화풍",
});
const SAFE_SOURCE_ID = /^[a-f0-9]{64}$/;
const PINK_BRIDGE_ID = "pink-bridge";
const CHARACTER_GROUPS = Object.freeze([
  ["chapel", "에테르 대예배당"],
  ["aether-guest", "같은 세계관 · 특별 게스트"],
  ["outside-guest", "세계관 밖 · 특별 게스트"],
  ["guest", "분류 전 특별 게스트"],
]);
const MAX_CUSTOM_CHARACTERS = 6;
const MAX_BATCH_IMAGES = 10;
const MAX_SELECTED_STYLES = 3;
const BUILTIN_RENDERING_COUNT = 4;
const JOB_PAGE_SIZE = 10;
const PURPOSE_LABELS = Object.freeze({
  "theme-followup": "오테 추가",
  "free-play": "자유 추가",
  "legacy-extra": "이전 추가",
});
const STAGE_LABELS = Object.freeze({
  planning: "무료 API 준비 중",
  generating: "이미지 생성 중",
  complete: "완료",
  failed: "실패",
  stalled: "확인 필요",
});

const elements = {
  form: document.querySelector("#creation-form"),
  sourceStatus: document.querySelector("#source-status"),
  sourcePickerOpen: document.querySelector("#source-picker-open"),
  sourcePicker: document.querySelector("#source-picker"),
  sourcePickerClose: document.querySelector("#source-picker-close"),
  sourcePickerStatus: document.querySelector("#source-picker-status"),
  sourcePickerGrid: document.querySelector("#source-picker-grid"),
  sourceSearch: document.querySelector("#source-search"),
  sourceUploadForm: document.querySelector("#source-upload-form"),
  sourceUploadFile: document.querySelector("#source-upload-file"),
  sourceUploadButton: document.querySelector("#source-upload-button"),
  sourceUploadStatus: document.querySelector("#source-upload-status"),
  scene: document.querySelector("#scene-request"),
  characterCount: document.querySelector("#character-count"),
  oracleReroll: document.querySelector("#oracle-reroll"),
  oracleChaos: document.querySelector("#oracle-chaos"),
  oracleChaosValue: document.querySelector("#oracle-chaos-value"),
  oracleIngredients: document.querySelector("#oracle-ingredients"),
  oracleSaveStatus: document.querySelector("#oracle-save-status"),
  oracleNewName: document.querySelector("#oracle-new-name"),
  oracleNewWeight: document.querySelector("#oracle-new-weight"),
  oracleAdd: document.querySelector("#oracle-add"),
  oracleResult: document.querySelector("#oracle-result"),
  characterGrid: document.querySelector("#character-grid"),
  characterStatus: document.querySelector("#character-status"),
  characterToggle: document.querySelector("#character-toggle"),
  batchCount: document.querySelector("#batch-count"),
  batchCountField: document.querySelector("#batch-count-field"),
  useImageAnchors: document.querySelector("#use-image-anchors"),
  styleGrid: document.querySelector("#style-grid"),
  styleStatus: document.querySelector("#style-status"),
  styleToggle: document.querySelector("#style-toggle"),
  sourceContext: document.querySelector("#source-context"),
  sourceRemove: document.querySelector("#source-remove"),
  sourceImage: document.querySelector("#source-image"),
  sourceName: document.querySelector("#source-name"),
  sourceMeta: document.querySelector("#source-meta"),
  sourceRecord: document.querySelector("#source-record"),
  sourceMessage: document.querySelector("#source-message"),
  previewSource: document.querySelector("#preview-source"),
  previewMode: document.querySelector("#preview-mode"),
  previewPurpose: document.querySelector("#preview-purpose"),
  previewBatch: document.querySelector("#preview-batch"),
  previewCharacters: document.querySelector("#preview-characters"),
  previewStyle: document.querySelector("#preview-style"),
  previewImageAnchors: document.querySelector("#preview-image-anchors"),
  previewSceneDetails: document.querySelector("#preview-scene-details"),
  previewSceneSummary: document.querySelector("#preview-scene-summary"),
  previewSceneCopy: document.querySelector("#preview-scene-copy"),
  previewScene: document.querySelector("#preview-scene"),
  previewRoute: document.querySelector("#preview-route"),
  previewMessage: document.querySelector("#preview-message"),
  draftButton: document.querySelector("#draft-button"),
  executeButton: document.querySelector("#execute-button"),
  jobsSummary: document.querySelector("#jobs-summary"),
  jobsList: document.querySelector("#jobs-list"),
  jobsLoadMore: document.querySelector("#jobs-load-more"),
};

const params = new URLSearchParams(window.location.search);
let source = SAFE_SOURCE_ID.test(params.get("source") ?? "")
  ? params.get("source")
  : null;
const requestedMode = params.get("mode");
const sourceModes = document.querySelectorAll("[data-needs-source]");
const styleLabels = new Map([
  ["random", "자동 선택"],
  ["prompt", "프롬프트 화풍 사용"],
  ["render:hyper-realistic", "Hyper-realistic"],
  ["render:hyper-realistic-anime", "Hyper-realistic-anime"],
  ["render:semi-realistic-anime", "Semi-realistic-anime"],
  ["render:2.5d-semi-realistic-anime-reality-forward", "2.5D Semi-realistic-anime · reality-forward"],
]);
const characterLabels = new Map();
let jobDisplayLimit = JOB_PAGE_SIZE;
let jobsLoading = false;
let connectedStyleCount = 0;
let connectedCharacterCount = 0;
let previewPayload = null;
let savedDraftId = null;
let savedExecutionMode = null;
let savedBatchCount = 1;
let purposeTouched = false;
let sourceImages = null;
let oracleSettings = null;
let oracleSaving = false;
let oracleSavePending = false;

async function copyText(value, button) {
  const text = String(value ?? "");
  if (!text) return;
  const original = button.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      if (!copied) throw new Error("copy failed");
    }
    button.textContent = "복사됨";
  } catch {
    button.textContent = "복사 실패";
  }
  setTimeout(() => { button.textContent = original; }, 1_500);
}

function setOracleMessage(message, state = "") {
  elements.oracleResult.textContent = message;
  elements.oracleResult.dataset.state = state;
}

function oraclePayload() {
  return {
    chaos: Number(elements.oracleChaos.value),
    ingredients: oracleSettings.ingredients.map((item) => ({ ...item })),
  };
}

function renderOracleIngredients() {
  elements.oracleIngredients.replaceChildren();
  for (const ingredient of oracleSettings.ingredients) {
    const row = document.createElement("div");
    row.className = "oracle-ingredient";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = ingredient.enabled;
    enabled.setAttribute("aria-label", `${ingredient.name} 활성화`);
    enabled.addEventListener("change", () => {
      ingredient.enabled = enabled.checked;
      saveOracleSettings();
    });

    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 30;
    name.value = ingredient.name;
    name.setAttribute("aria-label", "신탁 재료 이름");
    name.addEventListener("change", () => {
      ingredient.name = name.value.trim();
      saveOracleSettings();
    });

    const weight = document.createElement("input");
    weight.type = "number";
    weight.min = "0";
    weight.max = "100";
    weight.value = ingredient.weight;
    weight.setAttribute("aria-label", `${ingredient.name} 가중치`);
    weight.addEventListener("change", () => {
      ingredient.weight = Math.max(0, Math.min(100, Number(weight.value) || 0));
      weight.value = ingredient.weight;
      saveOracleSettings();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "삭제";
    remove.setAttribute("aria-label", `${ingredient.name} 삭제`);
    remove.addEventListener("click", () => {
      if (oracleSettings.ingredients.length <= 1) {
        setOracleMessage("신탁 재료는 최소 한 개 남겨주세요.", "error");
        return;
      }
      oracleSettings.ingredients = oracleSettings.ingredients.filter((item) => item.id !== ingredient.id);
      renderOracleIngredients();
      saveOracleSettings();
    });
    row.append(enabled, name, weight, remove);
    elements.oracleIngredients.append(row);
  }
}

async function loadOracleSettings() {
  try {
    const response = await fetch("/api/images/prompt-oracle/settings", { cache: "no-store" });
    if (!response.ok) throw new Error("혼돈의 신탁이 아직 준비되지 않았어요.");
    oracleSettings = await response.json();
    elements.oracleChaos.value = oracleSettings.chaos;
    elements.oracleChaosValue.textContent = oracleSettings.chaos;
    elements.oracleSaveStatus.textContent = "저장됨";
    renderOracleIngredients();
  } catch (error) {
    elements.oracleReroll.disabled = true;
    elements.oracleSaveStatus.textContent = "연결 안 됨";
    setOracleMessage(error.message, "error");
  }
}

async function saveOracleSettings() {
  if (!oracleSettings) return;
  if (oracleSaving) {
    oracleSavePending = true;
    return;
  }
  oracleSaving = true;
  oracleSavePending = false;
  elements.oracleSaveStatus.textContent = "저장 중…";
  try {
    const response = await fetch("/api/images/prompt-oracle/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-prompt-oracle-confirmation": "update-prompt-oracle-settings",
      },
      body: JSON.stringify(oraclePayload()),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "신탁 설정을 저장하지 못했어요.");
    if (!oracleSavePending) {
      oracleSettings = result;
      elements.oracleSaveStatus.textContent = "저장됨";
      renderOracleIngredients();
    }
  } catch (error) {
    elements.oracleSaveStatus.textContent = "저장 실패";
    setOracleMessage(error.message, "error");
  } finally {
    oracleSaving = false;
    if (oracleSavePending) saveOracleSettings();
  }
}

async function rerollOracle() {
  if (!oracleSettings) return;
  elements.oracleReroll.disabled = true;
  elements.oracleReroll.textContent = "🎲 신탁 중…";
  setOracleMessage("무료 API가 혼돈의 재료를 장면으로 엮고 있어요…");
  try {
    const response = await fetch("/api/images/prompt-oracle/reroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chaos: Number(elements.oracleChaos.value) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "신탁을 받아오지 못했어요.");
    if (elements.scene.value.trim() && !window.confirm("현재 프롬프트를 새 신탁으로 바꿀까요?")) {
      setOracleMessage(`신탁 보류 · ${result.ingredients.map((item) => item.name).join(" + ")}`);
      return;
    }
    elements.scene.value = result.scene;
    elements.scene.dispatchEvent(new Event("input", { bubbles: true }));
    setOracleMessage(`신탁 완료 · ${result.ingredients.map((item) => item.name).join(" + ")} · 혼돈도 ${result.chaos}%`, "success");
  } catch (error) {
    setOracleMessage(error.message, "error");
  } finally {
    elements.oracleReroll.disabled = false;
    elements.oracleReroll.textContent = "🎲 혼돈의 신탁";
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
}

function selectPurpose(value) {
  const input = elements.form.querySelector(`input[name="purpose"][value="${value}"]`);
  if (input) input.checked = true;
}

function applySourcePurpose(category) {
  if (purposeTouched) return;
  selectPurpose(["daily-theme", "theme-extra"].includes(category) ? "theme-followup" : "free-play");
}

function setSourceModesEnabled(enabled) {
  for (const input of sourceModes) input.disabled = !enabled;
}

function selectRequestedMode(mode = requestedMode) {
  if (!source || !(mode in MODE_LABELS)) return;
  const requestedInput = document.querySelector(
    `input[name="mode"][value="${mode}"]`,
  );
  if (requestedInput && !requestedInput.disabled) requestedInput.checked = true;
}

function appendSourceRecord(rows) {
  elements.sourceRecord.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    elements.sourceRecord.append(term, description);
  }
}

function appendStyleOption({ id, label }, { checked = false, blendable = false } = {}) {
  const card = document.createElement("label");
  card.className = "style-card";
  const input = document.createElement("input");
  input.type = blendable ? "checkbox" : "radio";
  input.name = blendable ? "style" : "style-mode";
  input.value = id;
  input.checked = checked;
  const copy = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = label;
  copy.append(name);
  card.append(input, copy);
  elements.styleGrid.append(card);
  styleLabels.set(id, label);
}

function appendCharacterOption(
  { id, label },
  { mode = false, checked = false } = {},
) {
  const card = document.createElement("label");
  card.className = `character-card${mode ? " character-mode-card" : ""}`;
  const input = document.createElement("input");
  input.type = mode ? "radio" : "checkbox";
  input.name = mode ? "character-mode" : "character";
  input.value = id;
  input.checked = checked;
  const copy = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = id === PINK_BRIDGE_ID ? `🌉 ${label}` : label;
  copy.append(name);
  card.append(input, copy);
  elements.characterGrid.append(card);
  characterLabels.set(id, label);
}

function appendCharacterGroup(label, characters) {
  if (!characters.length) return;
  const heading = document.createElement("h4");
  heading.className = "character-group-heading";
  heading.textContent = `${label} · ${characters.length}명`;
  elements.characterGrid.append(heading);
  for (const character of characters) appendCharacterOption(character);
}

function selectedCharacterSummary() {
  const selected = [
    ...elements.characterGrid.querySelectorAll('input[name="character"]:checked'),
  ];
  if (selected.length > 0) {
    return selected.map((input) => characterLabels.get(input.value)).join(", ");
  }
  const mode = elements.characterGrid.querySelector(
    'input[name="character-mode"]:checked',
  );
  return mode?.value === "none" ? "등장인물 없음" : "자동 선택";
}

function selectedBatchMode() {
  return elements.form.querySelector('input[name="batch-mode"]:checked')?.value ?? "single";
}

function selectedBatch() {
  const mode = selectedBatchMode();
  const selectedCount = elements.characterGrid.querySelectorAll('input[name="character"]:checked').length;
  return {
    mode,
    count: mode === "single"
      ? 1
      : mode === "per-character"
        ? selectedCount
        : Math.max(2, Math.min(MAX_BATCH_IMAGES, Number(elements.batchCount.value) || 10)),
  };
}

function updateBatchSelection() {
  const mode = selectedBatchMode();
  elements.batchCountField.hidden = mode !== "variants";
  if (mode === "variants") {
    const none = inputWithValue("character-mode", "none");
    if (none) none.checked = true;
    for (const input of elements.characterGrid.querySelectorAll('input[name="character"]')) input.checked = false;
  }
  updateCharacterSelection();
}

function updateCharacterSelection() {
  const selected = [
    ...elements.characterGrid.querySelectorAll('input[name="character"]:checked'),
  ];
  const maximum = selectedBatchMode() === "per-character" ? MAX_BATCH_IMAGES : MAX_CUSTOM_CHARACTERS;
  const reachedLimit = selected.length >= maximum;
  for (const input of elements.characterGrid.querySelectorAll(
    'input[name="character"]',
  )) {
    input.disabled = reachedLimit && !input.checked;
  }
  const prefix = connectedCharacterCount
    ? `${connectedCharacterCount}명 · 최대 ${maximum}명 · `
    : "";
  elements.characterStatus.textContent = `${prefix}${selectedCharacterSummary()}`;
}

async function loadCreationOptions() {
  elements.styleGrid.replaceChildren();
  elements.characterGrid.replaceChildren();
  appendStyleOption({ id: "random", label: "🎲 자동 선택" }, { checked: true });
  appendStyleOption({ id: "prompt", label: "✍ 프롬프트 화풍 사용" });
  appendStyleOption({ id: "render:hyper-realistic", label: "Hyper-realistic" });
  appendStyleOption({ id: "render:hyper-realistic-anime", label: "Hyper-realistic-anime" });
  appendStyleOption({ id: "render:semi-realistic-anime", label: "Semi-realistic-anime" });
  appendStyleOption({
    id: "render:2.5d-semi-realistic-anime-reality-forward",
    label: "2.5D Semi-realistic-anime · reality-forward",
  });
  appendCharacterOption(
    { id: "auto", label: "🎲 자동 선택" },
    { mode: true, checked: true },
  );
  appendCharacterOption(
    { id: "none", label: "등장인물 없음" },
    { mode: true },
  );

  try {
    const response = await fetch("/api/images/creation-options");
    if (!response.ok) throw new Error("Creation options request failed");
    const payload = await response.json();
    const styles = Array.isArray(payload.styles) ? payload.styles : [];
    const characters = Array.isArray(payload.characters) ? payload.characters : [];
    for (const style of styles) appendStyleOption(style, { blendable: true });
    for (const [groupId, groupLabel] of CHARACTER_GROUPS) {
      appendCharacterGroup(
        groupLabel,
        characters.filter((character) => (character.group ?? "guest") === groupId),
      );
    }
    connectedStyleCount = styles.length;
    connectedCharacterCount = characters.length;
    elements.styleStatus.textContent = `${styles.length}개 저장 화풍 · 최대 ${MAX_SELECTED_STYLES}개 혼합 + 렌더링 ${BUILTIN_RENDERING_COUNT}종 · 자동 선택`;
    elements.characterStatus.textContent = `${characters.length}명 · 최대 ${MAX_CUSTOM_CHARACTERS}명 · 자동 선택`;
  } catch {
    elements.styleStatus.textContent = "화풍 목록을 불러오지 못했어요.";
    elements.characterStatus.textContent = "인물 목록을 불러오지 못했어요.";
  }
}

function inputWithValue(name, value) {
  return [...elements.form.querySelectorAll(`input[name="${name}"]`)]
    .find((input) => input.value === value) ?? null;
}

function idsFromLabels(labels, labelMap) {
  const byLabel = new Map([...labelMap].map(([id, label]) => [label, id]));
  return (Array.isArray(labels) ? labels : [])
    .map((label) => byLabel.get(label) ?? label)
    .filter(Boolean);
}

function sourceStyleIds(record) {
  const rawIds = typeof record.styleId === "string" ? record.styleId.split(" + ") : [];
  if (rawIds.length && rawIds.every((id) => styleLabels.has(id))) return rawIds;
  const labels = typeof record.style === "string" ? record.style.split(" + ") : [];
  return idsFromLabels(labels, styleLabels).filter((id) => styleLabels.has(id));
}

function applySourceCharacters(record) {
  for (const input of elements.characterGrid.querySelectorAll('input[name="character"]')) {
    input.checked = false;
  }
  for (const input of elements.characterGrid.querySelectorAll('input[name="character-mode"]')) {
    input.checked = false;
  }
  const requestedIds = Array.isArray(record.characterIds) && record.characterIds.length
    ? record.characterIds
    : idsFromLabels(record.characters, characterLabels);
  const applied = requestedIds
    .map((id) => inputWithValue("character", String(id)))
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_CHARACTERS);
  for (const input of applied) input.checked = true;
  if (!applied.length) {
    const fallbackMode = record.characterMode === "none" ? "none" : "auto";
    const fallback = inputWithValue("character-mode", fallbackMode);
    if (fallback) fallback.checked = true;
  }
  updateCharacterSelection();
  return applied.length;
}

function applySourceStyle(record) {
  for (const input of elements.styleGrid.querySelectorAll('input[name="style"]')) input.checked = false;
  for (const input of elements.styleGrid.querySelectorAll('input[name="style-mode"]')) input.checked = false;
  const styleIds = record.styleMode === "selected" || (!record.styleMode && record.style)
    ? sourceStyleIds(record).slice(0, MAX_SELECTED_STYLES)
    : [];
  const applied = styleIds.map((id) => inputWithValue("style", id)).filter(Boolean);
  for (const input of applied) input.checked = true;
  if (!applied.length) {
    const modeValue = record.styleMode === "prompt"
      ? "prompt"
      : record.styleMode === "rendering" && record.styleId
        ? `render:${record.styleId}`
        : "random";
    const fallback = inputWithValue("style-mode", modeValue) ?? inputWithValue("style-mode", "random");
    if (fallback) fallback.checked = true;
  }
  updateStyleSelection();
  return applied.length;
}

function applySourceProductionSelection(record, mode) {
  const keepsCharacters = ["same-combination", "same-characters"].includes(mode);
  const keepsStyle = ["same-combination", "same-style"].includes(mode);
  return {
    characters: keepsCharacters ? applySourceCharacters(record) : 0,
    styles: keepsStyle ? applySourceStyle(record) : 0,
  };
}

async function loadSourceContext(preferredMode = requestedMode) {
  if (!source) {
    elements.sourceStatus.textContent = "새 요청";
    elements.sourcePickerOpen.textContent = "＋ 소스 이미지 선택";
    elements.previewSource.textContent = "없음";
    return;
  }

  elements.sourceContext.hidden = false;
  elements.sourceRecord.replaceChildren();
  elements.sourceMessage.textContent = "제작 기록을 확인하는 중이에요.";
  setSourceModesEnabled(false);
  elements.sourceStatus.textContent = "연결 확인 중";
  elements.sourcePickerOpen.textContent = "소스 변경";
  elements.previewSource.textContent = "확인 중";

  try {
    const imageResponse = await fetch(`/api/images/${encodeURIComponent(source)}`);
    if (!imageResponse.ok) throw new Error("Source image request failed");
    const { image } = await imageResponse.json();
    elements.sourceImage.src = image.thumbnailUrl;
    elements.sourceImage.alt = `${image.name} 미리보기`;
    elements.sourceName.textContent = image.name;
    elements.sourceMeta.textContent = `${image.date ?? "날짜 없음"} · ${image.group}`;
    elements.sourceStatus.textContent = "이미지 연결됨";
    elements.previewSource.textContent = image.name;
    applySourcePurpose(image.category);

    const recordResponse = await fetch(image.productionRecordUrl);
    if (recordResponse.status === 404) {
      elements.sourceMessage.textContent =
        "제작 기록이 없는 직접 참조 이미지예요. 새 장면에서 고른 인물·화풍·프롬프트와 함께 사용해요.";
      const newMode = elements.form.querySelector('input[name="mode"][value="new"]');
      if (newMode) newMode.checked = true;
      return;
    }
    if (!recordResponse.ok) throw new Error("Production record request failed");
    const { record } = await recordResponse.json();
    appendSourceRecord([
      ["등장인물", record.characters.join(", ")],
      ["관계", record.relationGroup],
      ["화풍", record.style],
    ]);
    elements.sourceMessage.textContent = "제작 기록을 안전하게 불러왔어요.";
    setSourceModesEnabled(true);
    selectRequestedMode(preferredMode);
    const applied = applySourceProductionSelection(record, preferredMode);
    if (applied.characters || applied.styles) {
      elements.sourceMessage.textContent = `제작 기록과 선택을 불러왔어요. 인물 ${applied.characters}명 · 화풍 ${applied.styles}개`;
    }
  } catch {
    elements.sourceStatus.textContent = "연결 실패";
    elements.previewSource.textContent = "불러오지 못함";
    elements.sourceMeta.textContent = "선택한 이미지를 확인할 수 없어요.";
    elements.sourceMessage.textContent = "새 장면 모드로 다시 시작해주세요.";
  }
}

setSourceModesEnabled(false);
async function initializeCreationPage() {
  await loadCreationOptions();
  await loadSourceContext();
}
initializeCreationPage();

function resetDraftAfterSourceChange() {
  previewPayload = null;
  savedDraftId = null;
  savedExecutionMode = null;
  elements.draftButton.disabled = true;
  elements.draftButton.textContent = "격리 초안 저장";
  elements.executeButton.hidden = true;
  elements.executeButton.disabled = false;
}

function renderSourcePicker(query = "") {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  const matches = (sourceImages ?? []).filter((image) => {
    const haystack = `${image.name} ${image.date ?? ""} ${image.group ?? ""} ${image.category ?? ""}`.toLocaleLowerCase("ko-KR");
    return !normalized || haystack.includes(normalized);
  }).slice(0, 80);
  elements.sourcePickerGrid.replaceChildren();
  elements.sourcePickerStatus.textContent = normalized
    ? `${matches.length}개 검색 결과`
    : `최근 이미지 ${matches.length}개`;
  for (const image of matches) {
    const card = document.createElement("article");
    card.className = "source-option-card";
    const button = document.createElement("button");
    button.className = "source-option";
    button.type = "button";
    button.dataset.sourceId = image.id;
    const preview = document.createElement("img");
    preview.src = image.thumbnailUrl;
    preview.alt = "";
    preview.loading = "lazy";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = image.name;
    const meta = document.createElement("small");
    meta.textContent = `${image.date ?? "날짜 없음"} · ${image.category ?? image.group}`;
    copy.append(name, meta);
    button.append(preview, copy);
    card.append(button);
    if (image.category === "source-upload") {
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "source-option-trash";
      trash.dataset.trashSourceId = image.id;
      trash.textContent = "휴지통";
      trash.setAttribute("aria-label", `${image.name} 휴지통으로 이동`);
      card.append(trash);
    }
    elements.sourcePickerGrid.append(card);
  }
}

async function openSourcePicker() {
  try {
    if (typeof elements.sourcePicker.showModal === "function") {
      if (!elements.sourcePicker.open) elements.sourcePicker.showModal();
    } else {
      elements.sourcePicker.setAttribute("open", "");
      elements.sourcePicker.dataset.fallbackOpen = "true";
    }
  } catch {
    elements.sourcePicker.setAttribute("open", "");
    elements.sourcePicker.dataset.fallbackOpen = "true";
  }
  elements.sourceSearch.value = "";
  elements.sourceSearch.focus();
  if (sourceImages) {
    renderSourcePicker();
    return;
  }
  elements.sourcePickerStatus.textContent = "이미지 아카이브를 불러오는 중이에요.";
  try {
    const response = await fetch("/api/images", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    sourceImages = Array.isArray(payload.images) ? payload.images : [];
    renderSourcePicker();
  } catch {
    elements.sourcePickerStatus.textContent = "이미지 아카이브를 불러오지 못했어요.";
  }
}

function closeSourcePicker() {
  delete elements.sourcePicker.dataset.fallbackOpen;
  if (typeof elements.sourcePicker.close === "function" && elements.sourcePicker.open) {
    elements.sourcePicker.close();
  } else {
    elements.sourcePicker.removeAttribute("open");
  }
}

async function selectSourceImage(image, button = null) {
  if (!image || !SAFE_SOURCE_ID.test(image.id ?? "")) return;
  if (button) button.disabled = true;

  let hasProductionRecord = image.hasProductionRecord !== false;
  if (hasProductionRecord) {
    try {
      const recordResponse = await fetch(
        `/api/images/${encodeURIComponent(image.id)}/production-record`,
        { cache: "no-store" },
      );
      if (recordResponse.status === 404) {
        hasProductionRecord = false;
        image.hasProductionRecord = false;
      } else if (!recordResponse.ok) {
        throw new Error("Production record request failed");
      }
    } catch {
      elements.sourcePickerStatus.textContent = "제작 기록을 확인하지 못했어요. 잠시 뒤 다시 골라주세요.";
      if (button) button.disabled = false;
      return;
    }
  }

  const currentMode = elements.form.querySelector('input[name="mode"]:checked')?.value;
  const preferredMode = hasProductionRecord
    ? currentMode && currentMode !== "new" ? currentMode : "same-combination"
    : "new";
  source = image.id;
  const query = new URLSearchParams({ source, mode: preferredMode });
  window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  closeSourcePicker();
  resetDraftAfterSourceChange();
  await loadSourceContext(preferredMode);
}

elements.sourcePickerOpen.addEventListener("click", openSourcePicker);
elements.sourcePickerClose.addEventListener("click", closeSourcePicker);
elements.sourceSearch.addEventListener("input", () => renderSourcePicker(elements.sourceSearch.value));
elements.sourcePickerGrid.addEventListener("click", async (event) => {
  const trashButton = event.target.closest("button[data-trash-source-id]");
  if (trashButton) {
    const image = sourceImages?.find((item) => item.id === trashButton.dataset.trashSourceId);
    await moveUploadedSourceToTrash(image, trashButton);
    return;
  }
  const button = event.target.closest("button[data-source-id]");
  if (!button || !SAFE_SOURCE_ID.test(button.dataset.sourceId ?? "")) return;
  const image = sourceImages?.find((item) => item.id === button.dataset.sourceId);
  await selectSourceImage(image, button);
});

async function uploadSourceFile(file) {
  elements.sourceUploadButton.disabled = true;
  elements.sourceUploadStatus.textContent = "소스 보관함에 안전하게 저장하는 중이에요.";
  try {
    const response = await fetch("/api/images/source-uploads", {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-source-upload-confirmation": "upload-generation-source",
        "x-source-file-name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.image) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || "이미지를 업로드하지 못했어요.");
    }
    payload.image.hasProductionRecord = false;
    sourceImages = [payload.image, ...(sourceImages ?? []).filter((item) => item.id !== payload.image.id)];
    elements.sourceUploadForm.reset();
    elements.sourceUploadStatus.textContent = "업로드 완료! 새 장면의 소스로 연결할게요.";
    await selectSourceImage(payload.image);
  } catch (error) {
    elements.sourceUploadStatus.textContent = error.message || "이미지를 업로드하지 못했어요.";
  } finally {
    elements.sourceUploadButton.disabled = false;
  }
}

async function moveUploadedSourceToTrash(image, button) {
  if (!image || image.category !== "source-upload") return;
  if (!confirm(`'${image.name}' 업로드 이미지를 휴지통으로 옮길까요?\n휴지통에서 복원하거나 영구 삭제할 수 있어요.`)) return;
  button.disabled = true;
  elements.sourcePickerStatus.textContent = "업로드 이미지를 휴지통으로 옮기는 중이에요.";
  try {
    const response = await fetch(`/api/images/${encodeURIComponent(image.id)}/trash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "move-image-to-trash" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "휴지통으로 옮기지 못했어요.");
    sourceImages = (sourceImages ?? []).filter((item) => item.id !== image.id);
    if (source === image.id) elements.sourceRemove.click();
    renderSourcePicker(elements.sourceSearch.value);
    elements.sourcePickerStatus.textContent = "휴지통으로 이동했어요.";
  } catch (error) {
    button.disabled = false;
    elements.sourcePickerStatus.textContent = error.message || "휴지통으로 옮기지 못했어요.";
  }
}

elements.sourceUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = elements.sourceUploadFile.files?.[0];
  if (!file) {
    elements.sourceUploadStatus.textContent = "업로드할 이미지를 먼저 골라주세요.";
    return;
  }
  await uploadSourceFile(file);
});

elements.sourcePicker.addEventListener("paste", async (event) => {
  const item = [...(event.clipboardData?.items ?? [])].find((candidate) =>
    candidate.kind === "file" && candidate.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (!file) return;
  event.preventDefault();
  elements.sourceUploadStatus.textContent = "클립보드 이미지를 발견했어요!";
  await uploadSourceFile(file);
});

elements.sourceRemove.addEventListener("click", () => {
  source = null;
  window.history.replaceState(null, "", window.location.pathname);
  elements.sourceContext.hidden = true;
  elements.sourceImage.removeAttribute("src");
  elements.sourceImage.alt = "";
  elements.sourceRecord.replaceChildren();
  elements.sourceStatus.textContent = "새 요청 · 소스 없음";
  elements.sourcePickerOpen.textContent = "＋ 소스 이미지 선택";
  elements.previewSource.textContent = "없음";
  setSourceModesEnabled(false);
  const newMode = elements.form.querySelector('input[name="mode"][value="new"]');
  if (newMode) newMode.checked = true;
  resetDraftAfterSourceChange();
});

elements.styleToggle.addEventListener("click", () => {
  const willOpen = elements.styleGrid.hidden;
  elements.styleGrid.hidden = !willOpen;
  elements.styleToggle.setAttribute("aria-expanded", String(willOpen));
  elements.styleToggle.textContent = willOpen ? "접기" : "펼치기";
});

elements.characterToggle.addEventListener("click", () => {
  const willOpen = elements.characterGrid.hidden;
  elements.characterGrid.hidden = !willOpen;
  elements.characterToggle.setAttribute("aria-expanded", String(willOpen));
  elements.characterToggle.textContent = willOpen ? "접기" : "펼치기";
});

elements.characterGrid.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;

  if (event.target.name === "character-mode") {
    for (const input of elements.characterGrid.querySelectorAll(
      'input[name="character"]',
    )) {
      input.checked = false;
    }
  } else if (event.target.name === "character") {
    for (const input of elements.characterGrid.querySelectorAll(
      'input[name="character-mode"]',
    )) {
      input.checked = false;
    }
    if (
      !elements.characterGrid.querySelector('input[name="character"]:checked')
    ) {
      elements.characterGrid.querySelector(
        'input[name="character-mode"][value="auto"]',
      ).checked = true;
    }
  }
  updateCharacterSelection();
});

function selectedStyleInputs() {
  return [...elements.styleGrid.querySelectorAll('input[name="style"]:checked')];
}

function updateStyleSelection() {
  const selectedStyles = selectedStyleInputs();
  const reachedLimit = selectedStyles.length >= MAX_SELECTED_STYLES;
  for (const input of elements.styleGrid.querySelectorAll('input[name="style"]')) {
    input.disabled = reachedLimit && !input.checked;
  }
  const selectedMode = elements.styleGrid.querySelector('input[name="style-mode"]:checked');
  const selected = selectedStyles.length
    ? `혼합 ${selectedStyles.length}개 · ${selectedStyles.map((input) => styleLabels.get(input.value)).join(" + ")}`
    : styleLabels.get(selectedMode?.value) ?? "자동 선택";
  const prefix = connectedStyleCount
    ? `${connectedStyleCount}개 저장 화풍 · 최대 ${MAX_SELECTED_STYLES}개 혼합 + 렌더링 ${BUILTIN_RENDERING_COUNT}종 · `
    : "";
  elements.styleStatus.textContent = `${prefix}${selected.replace(/^🎲\s*/u, "")}`;
}

elements.styleGrid.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.name === "style-mode") {
    for (const input of elements.styleGrid.querySelectorAll('input[name="style"]')) input.checked = false;
  } else if (event.target.name === "style") {
    for (const input of elements.styleGrid.querySelectorAll('input[name="style-mode"]')) input.checked = false;
    if (!selectedStyleInputs().length) {
      elements.styleGrid.querySelector('input[name="style-mode"][value="random"]').checked = true;
    }
  } else {
    return;
  }
  updateStyleSelection();
});

elements.scene.addEventListener("input", () => {
  elements.characterCount.textContent = elements.scene.value.length;
});

elements.oracleChaos.addEventListener("input", () => {
  elements.oracleChaosValue.textContent = elements.oracleChaos.value;
});
elements.oracleChaos.addEventListener("change", () => {
  if (!oracleSettings) return;
  oracleSettings.chaos = Number(elements.oracleChaos.value);
  saveOracleSettings();
});
elements.oracleAdd.addEventListener("click", () => {
  if (!oracleSettings) return;
  const name = elements.oracleNewName.value.trim();
  if (!name) {
    setOracleMessage("추가할 신탁 재료 이름을 적어주세요.", "error");
    return;
  }
  if (oracleSettings.ingredients.length >= (oracleSettings.limits?.ingredients ?? 40)) {
    setOracleMessage("신탁 재료가 가득 찼어요.", "error");
    return;
  }
  oracleSettings.ingredients.push({
    id: `custom-${Date.now().toString(36)}`,
    name,
    weight: Math.max(0, Math.min(100, Number(elements.oracleNewWeight.value) || 0)),
    enabled: true,
  });
  elements.oracleNewName.value = "";
  renderOracleIngredients();
  saveOracleSettings();
});
elements.oracleNewName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.oracleAdd.click();
  }
});
elements.oracleReroll.addEventListener("click", rerollOracle);

elements.form.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === "purpose") {
    purposeTouched = true;
  }
  if (event.target instanceof HTMLInputElement && event.target.name === "batch-mode") {
    updateBatchSelection();
  }
  previewPayload = null;
  savedDraftId = null;
  savedExecutionMode = null;
  savedBatchCount = 1;
  elements.draftButton.disabled = true;
  elements.draftButton.textContent = "격리 초안 저장";
  elements.executeButton.hidden = true;
  elements.executeButton.disabled = false;
  elements.executeButton.textContent = "⚡ 프롬프트로 1장 실제 생성";
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.form);
  const mode = MODE_LABELS[data.get("mode")] ?? MODE_LABELS.new;
  const characterSummary = selectedCharacterSummary();
  const selectedStyles = selectedStyleInputs();
  const styleModeValue = data.get("style-mode");
  const style = selectedStyles.length
    ? selectedStyles.map((input) => styleLabels.get(input.value)).join(" + ")
    : styleLabels.get(styleModeValue) ?? "자동 선택";
  const scene = elements.scene.value.trim();
  const selectedCharacters = [
    ...elements.characterGrid.querySelectorAll('input[name="character"]:checked'),
  ].map((input) => input.value);
  const characterModeInput = elements.characterGrid.querySelector(
    'input[name="character-mode"]:checked',
  );
  const characterSelection = selectedCharacters.length
    ? { mode: "custom", ids: selectedCharacters }
    : { mode: characterModeInput?.value === "none" ? "none" : "auto", ids: [] };
  const styleValue = styleModeValue;
  const purpose = data.get("purpose");
  const styleSelection =
    selectedStyles.length
      ? { mode: "selected", id: selectedStyles[0].value, ids: selectedStyles.map((input) => input.value) }
      : styleValue === "prompt"
      ? { mode: "prompt", id: null }
      : styleValue === "random"
        ? { mode: "auto", id: null }
        : styleValue.startsWith("render:")
          ? { mode: "rendering", id: styleValue.slice("render:".length) }
          : { mode: "selected", id: styleValue };
  const sourceImageId = source;
  const useImageAnchors = data.has("use-image-anchors");
  const batch = selectedBatch();
  if (batch.mode === "per-character" && batch.count < 2) {
    window.alert("인물별 배치는 인물을 2명 이상 선택해주세요.");
    return;
  }
  if (batch.mode === "variants" && characterSelection.mode !== "none") {
    window.alert("인물 없는 변주 배치는 등장인물 없음을 선택해주세요.");
    return;
  }
  const route =
    characterSelection.mode === "none" && ["auto", "selected", "prompt", "rendering"].includes(styleSelection.mode)
      ? "prompt-only"
      : "guided";

  previewPayload = {
    prompt: scene,
    purpose,
    mode: data.get("mode"),
    sourceImageId,
    characters: characterSelection,
    style: styleSelection,
    useImageAnchors,
    batch,
  };

  elements.previewMode.textContent = mode;
  elements.previewPurpose.textContent = PURPOSE_LABELS[purpose] ?? "목적 확인 필요";
  elements.previewBatch.textContent = batch.mode === "single"
    ? "함께 한 장"
    : batch.mode === "per-character"
      ? `인물별 ${batch.count}장`
      : `인물 없는 변주 ${batch.count}장`;
  elements.previewCharacters.textContent = characterSummary;
  elements.previewStyle.textContent = style;
  elements.previewImageAnchors.textContent = useImageAnchors
    ? "사용 · 선택 화풍 우선"
    : "사용 안 함 · 텍스트 외형 앵커만";
  elements.previewScene.textContent = scene || "장면 요청이 비어 있어요.";
  elements.previewSceneSummary.textContent = scene
    ? `${scene.length.toLocaleString("ko-KR")}자 프롬프트 펼치기`
    : "빈 프롬프트 펼치기";
  elements.previewSceneDetails.open = false;
  elements.previewSceneCopy.disabled = !scene;
  elements.previewRoute.textContent =
    route === "prompt-only"
      ? styleSelection.mode === "selected"
        ? "프롬프트 자유 생성 · 선택 화풍만 적용"
        : "프롬프트 자유 생성 · 인물 자산 매칭 없음"
      : "선택 자산을 보존하는 안내 생성";
  elements.previewMessage.textContent = "미리보기를 확인했어요. 격리 초안으로 저장할 수 있습니다.";
  elements.draftButton.disabled = !scene;
});

elements.draftButton.addEventListener("click", async () => {
  if (!previewPayload) return;
  elements.draftButton.disabled = true;
  elements.draftButton.textContent = "초안 저장 중…";
  try {
    const response = await fetch("/api/images/generation-drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(previewPayload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "초안을 저장하지 못했습니다.");
    elements.previewMessage.textContent =
      result.route === "prompt-only"
        ? ["auto", "selected"].includes(result.styleMode)
          ? "화풍 선택과 프롬프트 초안을 저장했어요. 자동 선택은 실행 시 확정되어 제작 기록에 남아요."
          : "프롬프트 자유 생성 초안을 저장했어요. Python과 무료 API는 실행하지 않았습니다."
        : result.executionMode === "guided-cast"
          ? "선택한 인물 안내 생성 초안을 저장했어요. 아래 버튼에서 실제 1장 생성을 확인할 수 있어요."
          : "안내 생성 초안을 저장했어요. 이 선택 조합의 실제 실행은 아직 연결 전이에요.";
    elements.draftButton.textContent = "격리 초안 저장 완료";
    savedDraftId = result.id;
    savedExecutionMode = result.executionMode;
    savedBatchCount = result.batch?.count ?? 1;
    elements.executeButton.hidden = false;
    elements.executeButton.disabled = !result.executionMode;
    elements.executeButton.textContent = savedBatchCount > 1
      ? `⚡ 독립 이미지 ${savedBatchCount}장 실제 생성`
      : result.executionMode === "prompt-only"
      ? ["auto", "selected"].includes(result.styleMode)
        ? result.styleMode === "auto"
          ? "⚡ 자동 화풍으로 1장 실제 생성"
          : "⚡ 선택 화풍으로 1장 실제 생성"
        : "⚡ 프롬프트로 1장 실제 생성"
      : result.executionMode === "guided-cast"
        ? "⚡ 선택 인물로 1장 실제 생성"
        : "선택 자산 실제 생성 · 연결 준비 중";
  } catch (error) {
    elements.previewMessage.textContent = error.message;
    elements.draftButton.disabled = false;
    elements.draftButton.textContent = "격리 초안 다시 저장";
  }
});

elements.previewSceneDetails.addEventListener("toggle", () => {
  const length = elements.previewScene.textContent.length;
  elements.previewSceneSummary.textContent = elements.previewSceneDetails.open
    ? `${length.toLocaleString("ko-KR")}자 프롬프트 접기`
    : `${length.toLocaleString("ko-KR")}자 프롬프트 펼치기`;
});

elements.previewSceneCopy.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  copyText(elements.previewScene.textContent, elements.previewSceneCopy);
});

async function pollGeneration(id) {
  try {
    const response = await fetch(`/api/images/generation-jobs/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    elements.previewMessage.textContent = result.message;
    loadJobs();
    if (result.status === "complete") {
      elements.executeButton.textContent = `✓ 이미지 ${result.count ?? savedBatchCount}장 생성 완료`;
      return;
    }
    if (result.status === "failed") {
      elements.executeButton.textContent = "생성 실패 · 상태 확인 필요";
      return;
    }
    if (result.status === "attention") {
      elements.executeButton.textContent = "생성 지연 · 상태 확인 필요";
      return;
    }
    setTimeout(() => pollGeneration(id), 5_000);
  } catch {
    elements.previewMessage.textContent = "생성 상태를 잠시 확인하지 못했어요. 다시 불러와 확인해주세요.";
  }
}

elements.executeButton.addEventListener("click", async () => {
  if (!savedDraftId || !savedExecutionMode) return;
  const confirmed = window.confirm(
    savedBatchCount > 1
      ? `같은 프롬프트와 조건으로 독립 이미지 ${savedBatchCount}장을 실제 생성할까요? 각 장은 별도 API 호출이며 콜라주로 합치지 않습니다.`
      : savedExecutionMode === "guided-cast"
      ? "이 프롬프트와 선택한 인물 외형 앵커로 이미지 1장을 실제 생성할까요? 무료 API와 이미지 worker가 실행됩니다."
      : "이 프롬프트로 이미지 1장을 실제 생성할까요? 무료 API와 이미지 worker가 실행됩니다.",
  );
  if (!confirmed) return;

  elements.executeButton.disabled = true;
  elements.executeButton.textContent = `${savedBatchCount}장 생성 요청 중…`;
  try {
    const response = await fetch(
      `/api/images/generation-drafts/${encodeURIComponent(savedDraftId)}/execute`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: savedBatchCount > 1
            ? "generate-draft-image-batch"
            : "generate-one-draft-image",
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "생성을 시작하지 못했습니다.");
    elements.executeButton.textContent = `이미지 ${savedBatchCount}장 생성 중…`;
    elements.previewMessage.textContent = "무료 API가 장면을 준비하고 있어요. 이 요청은 한 번만 실행됩니다.";
    loadJobs();
    pollGeneration(result.id);
  } catch (error) {
    elements.previewMessage.textContent = error.message;
    elements.executeButton.textContent = "실행 상태 확인 필요";
  }
});

function renderJobs(payload) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  elements.jobsSummary.textContent = payload.attentionCount
    ? `확인 필요 ${payload.attentionCount}건`
    : payload.activeCount
      ? `진행 중 ${payload.activeCount}건`
      : jobs.length
        ? `${jobs.length.toLocaleString("ko-KR")}건 표시 · ${payload.hasMore ? "이전 작업이 더 있어요." : "모두 불러왔어요."}`
        : "아직 생성 작업이 없어요.";
  elements.jobsLoadMore.hidden = !payload.hasMore;
  elements.jobsLoadMore.disabled = false;
  elements.jobsLoadMore.textContent = "이전 작업 더 불러오기";
  elements.jobsList.replaceChildren();
  for (const job of jobs) {
    const card = document.createElement("article");
    card.className = `job-card ${job.status}`;

    const images = Array.isArray(job.images) ? job.images : [];
    const image = images[0] ?? null;
    const visual = document.createElement("div");
    visual.className = `job-visual ${image ? "has-image" : "is-placeholder"}`;
    if (image) {
      visual.classList.toggle("is-batch", images.length > 1);
      for (const [index, resultImage] of images.entries()) {
        const item = document.createElement("div");
        item.className = "job-image-item";
        const link = document.createElement("a");
        link.href = resultImage.contentUrl;
        link.target = "_blank";
        const preview = document.createElement("img");
        preview.src = resultImage.thumbnailUrl;
        preview.alt = `${index + 1}번째 생성 결과`;
        preview.loading = "lazy";
        link.append(preview);
        item.append(link);
        if (job.regeneratable) {
          const regenerate = document.createElement("button");
          regenerate.type = "button";
          regenerate.className = "job-regenerate";
          regenerate.textContent = "↻ 그대로 재생성";
          regenerate.addEventListener("click", () => regenerateJob(job, resultImage.slot ?? index + 1, regenerate));
          item.append(regenerate);
        }
        visual.append(item);
      }
    } else {
      const pulse = document.createElement("span");
      pulse.className = "job-pulse";
      const placeholder = document.createElement("strong");
      placeholder.textContent = job.status === "processing" ? "빛을 모으는 중" : STAGE_LABELS[job.stage] ?? "결과 확인 중";
      visual.append(pulse, placeholder);
    }

    const body = document.createElement("div");
    body.className = "job-body";
    const top = document.createElement("div");
    top.className = "job-top";
    const purpose = document.createElement("span");
    purpose.className = "job-purpose";
    purpose.textContent = PURPOSE_LABELS[job.purpose] ?? "추가 생성";
    const stage = document.createElement("span");
    stage.className = "job-stage";
    stage.textContent = STAGE_LABELS[job.stage] ?? "상태 확인";
    top.append(purpose, stage);

    const facts = document.createElement("p");
    facts.className = "job-facts";
    const characterLabel = job.characters?.length
      ? job.characters.join(", ")
      : job.characterMode === "none" ? "등장인물 없음" : "등장인물 자동";
    const styleLabel = job.style
      ?? (job.styleMode === "none" ? "화풍 없음" : job.styleMode === "prompt" ? "프롬프트 화풍" : "화풍 자동");
    facts.textContent = `${characterLabel} · ${styleLabel}`;

    const message = document.createElement("p");
    message.className = "job-message";
    message.textContent = job.message;
    const meta = document.createElement("small");
    meta.className = "job-meta";
    meta.textContent = `${job.progress.completed}/${job.progress.total} · ${formatDuration(job.durationMs)} · ${formatDateTime(job.startedAt)}`;

    body.append(top, facts, message, meta);
    if (job.regeneratable && !images.length) {
      const failedActions = document.createElement("div");
      failedActions.className = "job-failed-actions";
      const slots = job.failedSlots?.length ? job.failedSlots : [1];
      for (const slot of slots) {
        const regenerate = document.createElement("button");
        regenerate.type = "button";
        regenerate.className = "job-regenerate";
        regenerate.textContent = slots.length > 1 ? `↻ ${slot}번 그대로 재생성` : "↻ 그대로 재생성";
        regenerate.addEventListener("click", () => regenerateJob(job, slot, regenerate));
        failedActions.append(regenerate);
      }
      body.append(failedActions);
    }
    if (job.prompt) {
      const prompt = document.createElement("details");
      prompt.className = "job-prompt";
      const summary = document.createElement("summary");
      const summaryText = document.createElement("span");
      summaryText.textContent = `${job.prompt.length.toLocaleString("ko-KR")}자 프롬프트 보기`;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "prompt-copy";
      copy.textContent = "복사";
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyText(job.prompt, copy);
      });
      const text = document.createElement("pre");
      text.textContent = job.prompt;
      summary.append(summaryText, copy);
      prompt.append(summary, text);
      body.append(prompt);
    }

    if (image) {
      const actions = document.createElement("nav");
      actions.className = "job-actions";
      const links = [
        ["결과 크게 보기", image.contentUrl],
        ["같은 조합으로", `/images/create?source=${encodeURIComponent(image.id)}&mode=same-combination`],
        ["인물만 유지", `/images/create?source=${encodeURIComponent(image.id)}&mode=same-characters`],
        ["화풍만 유지", `/images/create?source=${encodeURIComponent(image.id)}&mode=same-style`],
      ];
      for (const [label, href] of links) {
        const link = document.createElement("a");
        link.href = href;
        link.textContent = label;
        if (label === "결과 크게 보기") link.target = "_blank";
        actions.append(link);
      }
      body.append(actions);
    }
    card.append(visual, body);
    elements.jobsList.append(card);
  }
}

async function regenerateJob(job, slot, button) {
  const confirmed = window.confirm(
    "기존 이미지를 레퍼런스로 사용하지 않고, 저장된 프롬프트·인물·화풍 설정 그대로 새 이미지 1장을 생성할까요?",
  );
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = "재생성 요청 중…";
  try {
    const response = await fetch(
      `/api/images/generation-jobs/${encodeURIComponent(job.id)}/regenerate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "regenerate-same-settings", slot }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "재생성을 시작하지 못했습니다.");
    button.textContent = "✓ 새 작업 시작됨";
    loadJobs();
    pollGeneration(result.id);
  } catch (error) {
    button.disabled = false;
    button.textContent = "↻ 그대로 재생성";
    window.alert(error.message);
  }
}

async function loadJobs({ loadMore = false } = {}) {
  if (jobsLoading) return;
  jobsLoading = true;
  const previousLimit = jobDisplayLimit;
  if (loadMore) jobDisplayLimit += JOB_PAGE_SIZE;
  if (loadMore) {
    elements.jobsLoadMore.disabled = true;
    elements.jobsLoadMore.textContent = "이전 작업 불러오는 중…";
  }
  try {
    const response = await fetch(
      `/api/images/generation-jobs?limit=${encodeURIComponent(jobDisplayLimit)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error();
    renderJobs(await response.json());
  } catch {
    jobDisplayLimit = previousLimit;
    elements.jobsSummary.textContent = "작업 상태를 불러오지 못했어요.";
    elements.jobsLoadMore.disabled = false;
    elements.jobsLoadMore.textContent = "다시 불러오기";
  } finally {
    jobsLoading = false;
  }
}

elements.jobsLoadMore.addEventListener("click", () => loadJobs({ loadMore: true }));
loadOracleSettings();
loadJobs();
setInterval(loadJobs, 10_000);
