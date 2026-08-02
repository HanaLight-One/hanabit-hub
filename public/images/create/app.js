const MODE_LABELS = Object.freeze({
  new: "새 장면",
  "same-combination": "같은 조합",
  "same-characters": "등장인물 유지",
  "same-style": "같은 화풍",
});
const SAFE_SOURCE_ID = /^[a-f0-9]{64}$/;
const PINK_BRIDGE_ID = "pink-bridge";
const MAX_CUSTOM_CHARACTERS = 6;
const BUILTIN_RENDERING_COUNT = 4;
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
  scene: document.querySelector("#scene-request"),
  characterCount: document.querySelector("#character-count"),
  characterGrid: document.querySelector("#character-grid"),
  characterStatus: document.querySelector("#character-status"),
  characterToggle: document.querySelector("#character-toggle"),
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
  previewCharacters: document.querySelector("#preview-characters"),
  previewStyle: document.querySelector("#preview-style"),
  previewImageAnchors: document.querySelector("#preview-image-anchors"),
  previewSceneDetails: document.querySelector("#preview-scene-details"),
  previewSceneSummary: document.querySelector("#preview-scene-summary"),
  previewScene: document.querySelector("#preview-scene"),
  previewRoute: document.querySelector("#preview-route"),
  previewMessage: document.querySelector("#preview-message"),
  draftButton: document.querySelector("#draft-button"),
  executeButton: document.querySelector("#execute-button"),
  jobsSummary: document.querySelector("#jobs-summary"),
  jobsList: document.querySelector("#jobs-list"),
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
let connectedStyleCount = 0;
let connectedCharacterCount = 0;
let previewPayload = null;
let savedDraftId = null;
let savedExecutionMode = null;
let purposeTouched = false;
let sourceImages = null;

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

function appendStyleOption({ id, label }, { checked = false } = {}) {
  const card = document.createElement("label");
  card.className = "style-card";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "style";
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

function updateCharacterSelection() {
  const selected = [
    ...elements.characterGrid.querySelectorAll('input[name="character"]:checked'),
  ];
  const reachedLimit = selected.length >= MAX_CUSTOM_CHARACTERS;
  for (const input of elements.characterGrid.querySelectorAll(
    'input[name="character"]',
  )) {
    input.disabled = reachedLimit && !input.checked;
  }
  const prefix = connectedCharacterCount
    ? `${connectedCharacterCount}명 · 최대 ${MAX_CUSTOM_CHARACTERS}명 · `
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
    for (const style of styles) appendStyleOption(style);
    for (const character of characters) appendCharacterOption(character);
    connectedStyleCount = styles.length;
    connectedCharacterCount = characters.length;
    elements.styleStatus.textContent = `${styles.length}개 저장 화풍 + 렌더링 ${BUILTIN_RENDERING_COUNT}종 · 자동 선택`;
    elements.characterStatus.textContent = `${characters.length}명 · 최대 ${MAX_CUSTOM_CHARACTERS}명 · 자동 선택`;
  } catch {
    elements.styleStatus.textContent = "화풍 목록을 불러오지 못했어요.";
    elements.characterStatus.textContent = "인물 목록을 불러오지 못했어요.";
  }
}

async function loadSourceContext(preferredMode = requestedMode) {
  if (!source) {
    elements.sourceStatus.textContent = "새 요청";
    elements.sourcePickerOpen.textContent = "소스 선택";
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
        "구조화된 제작 기록이 없어 유지 모드는 아직 사용할 수 없어요.";
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
  } catch {
    elements.sourceStatus.textContent = "연결 실패";
    elements.previewSource.textContent = "불러오지 못함";
    elements.sourceMeta.textContent = "선택한 이미지를 확인할 수 없어요.";
    elements.sourceMessage.textContent = "새 장면 모드로 다시 시작해주세요.";
  }
}

setSourceModesEnabled(false);
loadCreationOptions();
loadSourceContext();

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
    elements.sourcePickerGrid.append(button);
  }
}

async function openSourcePicker() {
  elements.sourcePicker.showModal();
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
    sourceImages = Array.isArray(payload.images)
      ? payload.images.filter((image) => image.hasProductionRecord !== false)
      : [];
    renderSourcePicker();
  } catch {
    elements.sourcePickerStatus.textContent = "이미지 아카이브를 불러오지 못했어요.";
  }
}

elements.sourcePickerOpen.addEventListener("click", openSourcePicker);
elements.sourcePickerClose.addEventListener("click", () => elements.sourcePicker.close());
elements.sourceSearch.addEventListener("input", () => renderSourcePicker(elements.sourceSearch.value));
elements.sourcePickerGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-source-id]");
  if (!button || !SAFE_SOURCE_ID.test(button.dataset.sourceId ?? "")) return;
  button.disabled = true;
  elements.sourcePickerStatus.textContent = "이 이미지의 제작 기록을 확인하는 중이에요.";
  try {
    const recordResponse = await fetch(
      `/api/images/${encodeURIComponent(button.dataset.sourceId)}/production-record`,
      { cache: "no-store" },
    );
    if (!recordResponse.ok) {
      button.dataset.unavailable = "true";
      elements.sourcePickerStatus.textContent =
        "이전 이미지라 이어 만들 제작 기록이 없어요. 다른 이미지를 골라주세요.";
      return;
    }
  } catch {
    elements.sourcePickerStatus.textContent = "제작 기록을 확인하지 못했어요. 잠시 후 다시 골라주세요.";
    button.disabled = false;
    return;
  }
  const currentMode = elements.form.querySelector('input[name="mode"]:checked')?.value;
  const preferredMode = currentMode && currentMode !== "new" ? currentMode : "same-combination";
  source = button.dataset.sourceId;
  const query = new URLSearchParams({ source, mode: preferredMode });
  window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  elements.sourcePicker.close();
  resetDraftAfterSourceChange();
  await loadSourceContext(preferredMode);
});

elements.sourceRemove.addEventListener("click", () => {
  source = null;
  window.history.replaceState(null, "", window.location.pathname);
  elements.sourceContext.hidden = true;
  elements.sourceImage.removeAttribute("src");
  elements.sourceImage.alt = "";
  elements.sourceRecord.replaceChildren();
  elements.sourceStatus.textContent = "새 요청 · 소스 없음";
  elements.sourcePickerOpen.textContent = "소스 선택";
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

elements.styleGrid.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== "style") {
    return;
  }
  const selected = styleLabels.get(event.target.value) ?? "자동 선택";
  const prefix = connectedStyleCount
    ? `${connectedStyleCount}개 저장 화풍 + 렌더링 ${BUILTIN_RENDERING_COUNT}종 · `
    : "";
  elements.styleStatus.textContent = `${prefix}${selected.replace(/^🎲\s*/u, "")}`;
});

elements.scene.addEventListener("input", () => {
  elements.characterCount.textContent = elements.scene.value.length;
});

elements.form.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === "purpose") {
    purposeTouched = true;
  }
  previewPayload = null;
  savedDraftId = null;
  savedExecutionMode = null;
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
  const style = styleLabels.get(data.get("style")) ?? "자동 선택";
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
  const styleValue = data.get("style");
  const purpose = data.get("purpose");
  const styleSelection =
    styleValue === "prompt"
      ? { mode: "prompt", id: null }
      : styleValue === "random"
        ? { mode: "auto", id: null }
        : styleValue.startsWith("render:")
          ? { mode: "rendering", id: styleValue.slice("render:".length) }
          : { mode: "selected", id: styleValue };
  const sourceImageId = data.get("mode") === "new" ? null : source;
  const useImageAnchors = data.has("use-image-anchors");
  const route =
    data.get("mode") === "new" && characterSelection.mode === "none" && ["selected", "prompt", "rendering"].includes(styleSelection.mode)
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
  };

  elements.previewMode.textContent = mode;
  elements.previewPurpose.textContent = PURPOSE_LABELS[purpose] ?? "목적 확인 필요";
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
        ? result.styleMode === "selected"
          ? "선택 화풍과 프롬프트 초안을 저장했어요. 아래 버튼에서 실제 1장 생성을 확인할 수 있어요."
          : "프롬프트 자유 생성 초안을 저장했어요. Python과 무료 API는 실행하지 않았습니다."
        : result.executionMode === "guided-cast"
          ? "선택한 인물 안내 생성 초안을 저장했어요. 아래 버튼에서 실제 1장 생성을 확인할 수 있어요."
          : "안내 생성 초안을 저장했어요. 이 선택 조합의 실제 실행은 아직 연결 전이에요.";
    elements.draftButton.textContent = "격리 초안 저장 완료";
    savedDraftId = result.id;
    savedExecutionMode = result.executionMode;
    elements.executeButton.hidden = false;
    elements.executeButton.disabled = !result.executionMode;
    elements.executeButton.textContent = result.executionMode === "prompt-only"
      ? result.styleMode === "selected"
        ? "⚡ 선택 화풍으로 1장 실제 생성"
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
      elements.executeButton.textContent = "✓ 이미지 1장 생성 완료";
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
    savedExecutionMode === "guided-cast"
      ? "이 프롬프트와 선택한 인물 외형 앵커로 이미지 1장을 실제 생성할까요? 무료 API와 이미지 worker가 실행됩니다."
      : "이 프롬프트로 이미지 1장을 실제 생성할까요? 무료 API와 이미지 worker가 실행됩니다.",
  );
  if (!confirmed) return;

  elements.executeButton.disabled = true;
  elements.executeButton.textContent = "1장 생성 요청 중…";
  try {
    const response = await fetch(
      `/api/images/generation-drafts/${encodeURIComponent(savedDraftId)}/execute`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "generate-one-draft-image" }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "생성을 시작하지 못했습니다.");
    elements.executeButton.textContent = "이미지 1장 생성 중…";
    elements.previewMessage.textContent = "무료 API가 장면을 준비하고 있어요. 이 요청은 한 번만 실행됩니다.";
    loadJobs();
    pollGeneration(result.id);
  } catch (error) {
    elements.previewMessage.textContent = error.message;
    elements.executeButton.textContent = "실행 상태 확인 필요";
  }
});

function renderJobs(payload) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs.slice(0, 10) : [];
  elements.jobsSummary.textContent = payload.attentionCount
    ? `확인 필요 ${payload.attentionCount}건`
    : payload.activeCount
      ? `진행 중 ${payload.activeCount}건`
      : jobs.length
        ? "최근 작업이 모두 종료됐어요."
        : "아직 생성 작업이 없어요.";
  elements.jobsList.replaceChildren();
  for (const job of jobs) {
    const card = document.createElement("article");
    card.className = `job-card ${job.status}`;

    const image = job.images?.[0] ?? null;
    const visual = document.createElement("div");
    visual.className = `job-visual ${image ? "has-image" : "is-placeholder"}`;
    if (image) {
      const preview = document.createElement("img");
      preview.src = image.thumbnailUrl;
      preview.alt = `${image.name} 생성 결과`;
      preview.loading = "lazy";
      visual.append(preview);
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
    if (job.prompt) {
      const prompt = document.createElement("details");
      prompt.className = "job-prompt";
      const summary = document.createElement("summary");
      summary.textContent = `${job.prompt.length.toLocaleString("ko-KR")}자 프롬프트 보기`;
      const text = document.createElement("pre");
      text.textContent = job.prompt;
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

async function loadJobs() {
  try {
    const response = await fetch("/api/images/generation-jobs", { cache: "no-store" });
    if (!response.ok) throw new Error();
    renderJobs(await response.json());
  } catch {
    elements.jobsSummary.textContent = "작업 상태를 불러오지 못했어요.";
  }
}

loadJobs();
setInterval(loadJobs, 10_000);
