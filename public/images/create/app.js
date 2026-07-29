const MODE_LABELS = Object.freeze({
  new: "새 장면",
  "same-combination": "같은 조합",
  "same-characters": "등장인물 유지",
  "same-style": "같은 화풍",
});
const SAFE_SOURCE_ID = /^[a-f0-9]{64}$/;

const elements = {
  form: document.querySelector("#creation-form"),
  sourceStatus: document.querySelector("#source-status"),
  scene: document.querySelector("#scene-request"),
  characterCount: document.querySelector("#character-count"),
  characterGrid: document.querySelector("#character-grid"),
  characterStatus: document.querySelector("#character-status"),
  characterToggle: document.querySelector("#character-toggle"),
  styleGrid: document.querySelector("#style-grid"),
  styleStatus: document.querySelector("#style-status"),
  styleToggle: document.querySelector("#style-toggle"),
  sourceContext: document.querySelector("#source-context"),
  sourceImage: document.querySelector("#source-image"),
  sourceName: document.querySelector("#source-name"),
  sourceMeta: document.querySelector("#source-meta"),
  sourceRecord: document.querySelector("#source-record"),
  sourceMessage: document.querySelector("#source-message"),
  previewSource: document.querySelector("#preview-source"),
  previewMode: document.querySelector("#preview-mode"),
  previewCharacters: document.querySelector("#preview-characters"),
  previewStyle: document.querySelector("#preview-style"),
  previewScene: document.querySelector("#preview-scene"),
  previewMessage: document.querySelector("#preview-message"),
};

const params = new URLSearchParams(window.location.search);
const source = SAFE_SOURCE_ID.test(params.get("source") ?? "")
  ? params.get("source")
  : null;
const requestedMode = params.get("mode");
const sourceModes = document.querySelectorAll("[data-needs-source]");
const styleLabels = new Map([
  ["random", "자동 선택"],
  ["none", "화풍 없음"],
]);
const characterLabels = new Map();
let connectedStyleCount = 0;
let connectedCharacterCount = 0;

function setSourceModesEnabled(enabled) {
  for (const input of sourceModes) input.disabled = !enabled;
}

function selectRequestedMode() {
  if (!source || !(requestedMode in MODE_LABELS)) return;
  const requestedInput = document.querySelector(
    `input[name="mode"][value="${requestedMode}"]`,
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
  name.textContent = label;
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
  const reachedLimit = selected.length >= 3;
  for (const input of elements.characterGrid.querySelectorAll(
    'input[name="character"]',
  )) {
    input.disabled = reachedLimit && !input.checked;
  }
  const prefix = connectedCharacterCount
    ? `${connectedCharacterCount}명 · `
    : "";
  elements.characterStatus.textContent = `${prefix}${selectedCharacterSummary()}`;
}

async function loadCreationOptions() {
  elements.styleGrid.replaceChildren();
  elements.characterGrid.replaceChildren();
  appendStyleOption({ id: "random", label: "🎲 자동 선택" }, { checked: true });
  appendStyleOption({ id: "none", label: "화풍 없음" });
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
    elements.styleStatus.textContent = `${styles.length}개 화풍 · 자동 선택`;
    elements.characterStatus.textContent = `${characters.length}명 · 자동 선택`;
  } catch {
    elements.styleStatus.textContent = "화풍 목록을 불러오지 못했어요.";
    elements.characterStatus.textContent = "인물 목록을 불러오지 못했어요.";
  }
}

async function loadSourceContext() {
  if (!source) {
    elements.sourceStatus.textContent = "새 요청";
    elements.previewSource.textContent = "없음";
    return;
  }

  elements.sourceContext.hidden = false;
  elements.sourceStatus.textContent = "연결 확인 중";
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
    selectRequestedMode();
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
  const prefix = connectedStyleCount ? `${connectedStyleCount}개 화풍 · ` : "";
  elements.styleStatus.textContent = `${prefix}${selected.replace(/^🎲\s*/u, "")}`;
});

elements.scene.addEventListener("input", () => {
  elements.characterCount.textContent = elements.scene.value.length;
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.form);
  const mode = MODE_LABELS[data.get("mode")] ?? MODE_LABELS.new;
  const characters = selectedCharacterSummary();
  const style = styleLabels.get(data.get("style")) ?? "자동 선택";
  const scene = elements.scene.value.trim();

  elements.previewMode.textContent = mode;
  elements.previewCharacters.textContent = characters;
  elements.previewStyle.textContent = style;
  elements.previewScene.textContent = scene || "장면 요청이 비어 있어요.";
  elements.previewMessage.textContent =
    "미리보기만 갱신했어요. 서버나 생성 대기열로 전송되지 않았습니다.";
});
