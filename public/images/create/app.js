const MODE_LABELS = Object.freeze({
  new: "새 장면",
  "same-combination": "같은 조합",
  "same-characters": "등장인물 유지",
  "same-style": "같은 화풍",
});
const SAFE_SOURCE_ID = /^[A-Za-z0-9_-]{1,512}$/;

const elements = {
  form: document.querySelector("#creation-form"),
  sourceStatus: document.querySelector("#source-status"),
  scene: document.querySelector("#scene-request"),
  characterCount: document.querySelector("#character-count"),
  previewSource: document.querySelector("#preview-source"),
  previewMode: document.querySelector("#preview-mode"),
  previewScene: document.querySelector("#preview-scene"),
  previewMessage: document.querySelector("#preview-message"),
};

const params = new URLSearchParams(window.location.search);
const source = SAFE_SOURCE_ID.test(params.get("source") ?? "")
  ? params.get("source")
  : null;
const requestedMode = params.get("mode");
const sourceModes = document.querySelectorAll("[data-needs-source]");

for (const input of sourceModes) input.disabled = !source;
if (source && requestedMode in MODE_LABELS) {
  const requestedInput = document.querySelector(
    `input[name="mode"][value="${requestedMode}"]`,
  );
  if (requestedInput && !requestedInput.disabled) requestedInput.checked = true;
}

elements.sourceStatus.textContent = source ? "이미지 연결됨" : "새 요청";
elements.previewSource.textContent = source ? "선택한 이미지" : "없음";

elements.scene.addEventListener("input", () => {
  elements.characterCount.textContent = elements.scene.value.length;
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(elements.form);
  const mode = MODE_LABELS[data.get("mode")] ?? MODE_LABELS.new;
  const scene = elements.scene.value.trim();

  elements.previewMode.textContent = mode;
  elements.previewScene.textContent = scene || "장면 요청이 비어 있어요.";
  elements.previewMessage.textContent =
    "미리보기만 갱신했어요. 서버나 생성 대기열로 전송되지 않았습니다.";
});
