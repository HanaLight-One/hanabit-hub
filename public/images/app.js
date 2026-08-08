const elements = {
  status: document.querySelector("#archive-status"),
  message: document.querySelector("#archive-message"),
  grid: document.querySelector("#image-grid"),
  imageCount: document.querySelector("#image-count"),
  dateCount: document.querySelector("#date-count"),
  dateFilter: document.querySelector("#date-filter"),
  categoryTabs: document.querySelector("#category-tabs"),
  archiveRefresh: document.querySelector("#archive-refresh"),
  generationStatus: document.querySelector("#generation-status"),
  themeLabel: document.querySelector("#theme-label"),
  themeTitle: document.querySelector("#theme-title"),
  themeDate: document.querySelector("#theme-date"),
  themeText: document.querySelector("#theme-text"),
  panel: document.querySelector("#detail-panel"),
  backdrop: document.querySelector("#panel-backdrop"),
  close: document.querySelector("#panel-close"),
  detailRefresh: document.querySelector("#detail-refresh"),
  detailTitle: document.querySelector("#detail-title"),
  detailImage: document.querySelector("#detail-image"),
  basicRecord: document.querySelector("#basic-record"),
  recordMessage: document.querySelector("#record-message"),
  productionRecord: document.querySelector("#production-record"),
  promptRecord: document.querySelector("#prompt-record"),
  promptSummary: document.querySelector("#prompt-summary"),
  promptCopy: document.querySelector("#prompt-copy"),
  promptText: document.querySelector("#prompt-text"),
  createLink: document.querySelector("#create-link"),
  reuseLink: document.querySelector("#reuse-link"),
  originalLink: document.querySelector("#original-link"),
  downloadLink: document.querySelector("#download-link"),
  trashButton: document.querySelector("#trash-button"),
};

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

const state = {
  images: [],
  selectedDate: "all",
  selectedCategory: "all",
  currentOperationalDate: null,
  selectedImageId: null,
  lastFocused: null,
  themeRequest: 0,
  previousActiveCount: null,
  productionRecords: new Map(),
};

const CATEGORY_LABELS = Object.freeze({
  "daily-theme": "오늘의 테마",
  "theme-extra": "오테 추가",
  "free-extra": "자유 추가",
  "legacy-extra": "이전 추가",
  "source-upload": "직접 업로드",
});
const STAGE_LABELS = Object.freeze({
  planning: "무료 API 준비 중",
  generating: "이미지 생성 중",
  complete: "최근 생성 완료",
  failed: "최근 생성 실패",
  stalled: "생성 확인 필요",
});
const DELETABLE_CATEGORIES = new Set(["theme-extra", "free-extra", "legacy-extra", "source-upload"]);

async function moveToTrash(image) {
  if (!DELETABLE_CATEGORIES.has(image.category)) return;
  if (!confirm(`'${image.name}' 이미지를 휴지통으로 옮길까요?\n휴지통에서는 복원하거나 영구 삭제할 수 있어요.`)) return;
  const response = await fetch(`/api/images/${encodeURIComponent(image.id)}/trash`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "move-image-to-trash" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(payload.error ?? "이미지를 휴지통으로 옮기지 못했어요.");
    return;
  }
  state.images = state.images.filter((candidate) => candidate.id !== image.id);
  state.productionRecords.delete(image.id);
  closePanel();
  renderFilters();
  renderGrid();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function appendDefinitionList(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value ?? "—";
    target.append(term, description);
  }
}

function visibleImages() {
  const dateImages = state.selectedDate === "all"
    ? state.images
    : state.images.filter((image) => (image.date ?? "undated") === state.selectedDate);
  return state.selectedCategory === "all"
    ? dateImages
    : dateImages.filter((image) => image.category === state.selectedCategory);
}

function renderCategoryTabs() {
  const dateImages = state.selectedDate === "all"
    ? state.images
    : state.images.filter((image) => (image.date ?? "undated") === state.selectedDate);
  for (const button of elements.categoryTabs.querySelectorAll("button[data-category]")) {
    const category = button.dataset.category;
    const count = category === "all"
      ? dateImages.length
      : dateImages.filter((image) => image.category === category).length;
    button.classList.toggle("active", category === state.selectedCategory);
    button.setAttribute("aria-pressed", String(category === state.selectedCategory));
    button.querySelector("span").textContent = count.toLocaleString("ko-KR");
  }
}

function renderGrid() {
  const images = visibleImages();
  renderCategoryTabs();
  elements.grid.replaceChildren();
  elements.message.hidden = images.length > 0;
  if (images.length === 0) {
    if (state.images.length === 0) {
      elements.message.textContent = "아직 연결된 이미지가 없어요.";
    } else if (state.selectedDate === state.currentOperationalDate) {
      elements.message.textContent =
        "오늘의 테마는 정상 연결되어 있지만, 오늘 이미지는 아직 저장소에 없어요.";
    } else {
      elements.message.textContent = "선택한 날짜와 종류에 이미지가 없어요.";
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const image of images) {
    const card = document.createElement("article");
    card.className = "image-card";
    const main = document.createElement("button");
    main.className = "image-card-main";
    main.type = "button";
    main.setAttribute("aria-label", `${image.name} 제작 기록 열기`);

    const preview = document.createElement("img");
    preview.src = image.thumbnailUrl;
    preview.alt = "";
    preview.loading = "lazy";

    const copy = document.createElement("span");
    copy.className = "card-copy";
    const name = document.createElement("strong");
    name.textContent = image.name;
    const meta = document.createElement("span");
    meta.textContent = `${image.date ?? "날짜 없음"} · ${CATEGORY_LABELS[image.category] ?? image.group}`;
    const originalName = document.createElement("span");
    originalName.className = "original-name";
    originalName.textContent = `원본 파일 · ${image.name}`;
    copy.append(name, meta, originalName);
    main.append(preview, copy);

    const record = document.createElement("div");
    record.className = "card-record";
    record.textContent = "제작 기록을 불러오는 중";

    const actions = document.createElement("nav");
    actions.className = "card-actions";
    for (const [label, query] of [
      ["편집", `template=${encodeURIComponent(image.id)}&mode=same-combination`],
      ["인물 유지", `template=${encodeURIComponent(image.id)}&mode=same-characters`],
      ["화풍 유지", `template=${encodeURIComponent(image.id)}&mode=same-style`],
      ["이미지 재사용", `source=${encodeURIComponent(image.id)}&mode=new`],
    ]) {
      const link = document.createElement("a");
      link.href = `/images/create?${query}`;
      link.textContent = label;
      actions.append(link);
    }
    if (DELETABLE_CATEGORIES.has(image.category)) {
      actions.classList.add("has-trash");
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "card-trash-action";
      trash.textContent = "휴지통";
      trash.addEventListener("click", () => moveToTrash(image));
      actions.append(trash);
    }
    card.append(main, record, actions);
    main.addEventListener("click", () => openPanel(image, main));
    hydrateImageCard(image, record, name, main);
    fragment.append(card);
  }
  elements.grid.append(fragment);
}

function compactCharacters(record) {
  const characters = record.characters ?? [];
  if (!characters.length) return null;
  if (characters.length <= 3) return characters.join(" + ");
  return `${characters.slice(0, 3).join(" + ")} 외 ${characters.length - 3}명`;
}

function displayTitle(record) {
  const characters = compactCharacters(record);
  const style = record.style
    ?? (record.styleMode === "prompt" ? "프롬프트 화풍" : record.styleMode === "rendering" ? "고정 렌더링" : null);
  if (characters && style) return `${characters} · ${style}`;
  return characters ?? style ?? null;
}

async function hydrateImageCard(image, target, title, main) {
  let record = state.productionRecords.get(image.id);
  if (record === undefined) {
    try {
      const response = await fetch(image.productionRecordUrl, { cache: "no-store" });
      record = response.ok ? (await response.json()).record : null;
    } catch {
      record = null;
    }
    state.productionRecords.set(image.id, record);
  }
  if (!target.isConnected) return;
  if (!record) {
    target.textContent = "이전 이미지 · 상세 기록 없음";
    return;
  }
  const humanTitle = displayTitle(record);
  if (humanTitle) {
    title.textContent = humanTitle;
    main.setAttribute("aria-label", `${humanTitle} 제작 기록 열기`);
  }
  const characters = record.characters?.length
    ? record.characters.join(", ")
    : record.characterMode === "none" ? "등장인물 없음" : "등장인물 자동";
  const style = record.style
    ?? (record.styleMode === "none" ? "화풍 없음" : record.styleMode === "prompt" ? "프롬프트 화풍" : "화풍 자동");
  target.replaceChildren();
  const facts = document.createElement("strong");
  facts.textContent = `${characters} · ${style}`;
  target.append(facts);
  if (record.prompt) {
    const prompt = document.createElement("p");
    prompt.textContent = record.prompt;
    target.append(prompt);
  }
}

function renderFilters() {
  const dateSet = new Set(
    state.images
      .map((image) => image.date)
      .filter(Boolean),
  );
  if (state.currentOperationalDate) dateSet.add(state.currentOperationalDate);
  const dates = [...dateSet]
    .filter((date) => date !== state.currentOperationalDate)
    .sort()
    .reverse();
  if (state.currentOperationalDate) dates.unshift(state.currentOperationalDate);
  const hasUndated = state.images.some((image) => !image.date);

  elements.dateFilter.replaceChildren(new Option("모든 날짜", "all"));
  for (const date of dates) {
    const label =
      date === state.currentOperationalDate ? `${date} · 오늘` : date;
    elements.dateFilter.add(new Option(label, date));
  }
  if (hasUndated) elements.dateFilter.add(new Option("날짜 없음", "undated"));
  elements.dateFilter.value = state.selectedDate;
  elements.imageCount.textContent = state.images.length.toLocaleString("ko-KR");
  elements.dateCount.textContent = (dates.length + Number(hasUndated)).toLocaleString(
    "ko-KR",
  );
}

async function loadTheme() {
  const requestId = ++state.themeRequest;
  const isToday = state.selectedDate === "all";
  const selectedDate = isToday ? null : state.selectedDate;
  elements.themeLabel.textContent = isToday ? "TODAY'S THEME" : "THEME ARCHIVE";
  elements.themeTitle.textContent = isToday ? "오늘의 테마" : "그날의 테마";
  elements.themeDate.textContent = selectedDate ?? "운영일 확인 중";
  elements.themeText.textContent = "테마 기록을 확인하는 중이에요.";

  if (selectedDate === "undated") {
    elements.themeDate.textContent = "날짜 없음";
    elements.themeText.textContent = "날짜가 없는 이미지에는 테마 기록을 연결할 수 없어요.";
    return;
  }

  try {
    const query = selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : "";
    const response = await fetch(`/api/themes${query}`);
    if (!response.ok) throw new Error("Theme request failed");
    const payload = await response.json();
    if (requestId !== state.themeRequest) return;

    if (isToday && state.currentOperationalDate !== payload.date) {
      state.currentOperationalDate = payload.date;
      renderFilters();
    }
    elements.themeDate.textContent = payload.date;
    elements.themeText.textContent = payload.available
      ? payload.theme.theme
      : "이 날짜의 테마 기록은 아직 없어요.";
  } catch {
    if (requestId !== state.themeRequest) return;
    elements.themeDate.textContent = selectedDate ?? "—";
    elements.themeText.textContent = "테마 기록을 불러오지 못했어요.";
  }
}

async function loadProductionRecord(image) {
  const requestedImageId = image.id;
  elements.productionRecord.replaceChildren();
  elements.promptRecord.hidden = true;
  elements.promptRecord.open = false;
  elements.promptText.textContent = "";
  elements.recordMessage.hidden = false;
  elements.recordMessage.textContent = "제작 기록을 확인하는 중이에요.";

  try {
    const response = await fetch(image.productionRecordUrl, { cache: "no-store" });
    if (state.selectedImageId !== requestedImageId) return;
    if (response.status === 404) {
      elements.recordMessage.textContent =
        "이 이미지는 이전 기록이라 구조화된 제작 기록이 아직 없어요.";
      return;
    }
    if (!response.ok) throw new Error("Production record request failed");
    const { record } = await response.json();
    elements.recordMessage.hidden = true;
    const characterLabels = record.characters.length
      ? record.characters.join(", ")
      : record.characterMode === "none"
        ? "선택 안 함"
        : record.characterMode === "auto"
          ? "자동 선택 · 세부 기록 없음"
          : "기록 없음";
    const styleLabel = record.style
      ?? (record.styleMode === "none"
        ? "화풍 없음"
        : record.styleMode === "prompt"
          ? "프롬프트 화풍 사용"
          : record.styleMode === "auto"
            ? "자동 선택 · 세부 기록 없음"
            : "기록 없음");
    const imageAnchors = record.useImageAnchors == null
      ? "기록 없음"
      : record.useImageAnchors ? "사용" : "사용 안 함";
    appendDefinitionList(elements.productionRecord, [
      ["등장인물", characterLabels],
      ["관계 그룹", record.relationGroup],
      ["화풍", styleLabel],
      ["이미지 앵커", imageAnchors],
      ["생성 목적", record.purpose],
      ["생성 시각", formatDateTime(record.createdAt)],
      ["소요 시간", record.durationMs == null ? null : formatDuration(record.durationMs)],
      ["재시도", record.retryCount == null ? null : `${record.retryCount}회`],
    ]);
    if (record.prompt) {
      elements.promptRecord.hidden = false;
      elements.promptSummary.textContent = `${record.prompt.length.toLocaleString("ko-KR")}자 프롬프트 펼치기`;
      elements.promptText.textContent = record.prompt;
    }
  } catch {
    if (state.selectedImageId !== requestedImageId) return;
    elements.recordMessage.textContent = "제작 기록을 불러오지 못했어요.";
  }
}

elements.promptRecord.addEventListener("toggle", () => {
  if (elements.promptRecord.hidden) return;
  const length = elements.promptText.textContent.length.toLocaleString("ko-KR");
  elements.promptSummary.textContent = elements.promptRecord.open
    ? `${length}자 프롬프트 접기`
    : `${length}자 프롬프트 펼치기`;
});

elements.promptCopy.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  copyText(elements.promptText.textContent, elements.promptCopy);
});

function renderPanelImage(image, { refreshPreview = false } = {}) {
  elements.detailTitle.textContent = image.name;
  const separator = image.thumbnailUrl.includes("?") ? "&" : "?";
  elements.detailImage.src = refreshPreview
    ? `${image.thumbnailUrl}${separator}refresh=${Date.now()}`
    : image.thumbnailUrl;
  elements.detailImage.alt = `${image.name} 미리보기`;
  elements.createLink.href =
    `/images/create?template=${encodeURIComponent(image.id)}&mode=same-combination`;
  elements.reuseLink.href =
    `/images/create?source=${encodeURIComponent(image.id)}&mode=new`;
  elements.originalLink.href = image.contentUrl;
  elements.downloadLink.href = image.downloadUrl;
  elements.trashButton.hidden = !DELETABLE_CATEGORIES.has(image.category);
  appendDefinitionList(elements.basicRecord, [
    ["날짜", image.date ?? "날짜 없음"],
    ["앨범", image.album],
    ["그룹", image.group],
    ["파일 크기", formatBytes(image.size)],
    ["수정 시각", formatDateTime(image.modifiedAt)],
  ]);
}

function openPanel(image, trigger) {
  state.selectedImageId = image.id;
  state.lastFocused = trigger;
  renderPanelImage(image);
  elements.backdrop.hidden = false;
  elements.panel.classList.add("open");
  elements.panel.setAttribute("aria-hidden", "false");
  elements.panel.inert = false;
  document.body.style.overflow = "hidden";
  elements.close.focus();
  loadProductionRecord(image);
}

function closePanel() {
  state.selectedImageId = null;
  elements.panel.classList.remove("open");
  elements.panel.setAttribute("aria-hidden", "true");
  elements.panel.inert = true;
  elements.backdrop.hidden = true;
  document.body.style.overflow = "";
  state.lastFocused?.focus();
}

elements.dateFilter.addEventListener("change", () => {
  state.selectedDate = elements.dateFilter.value;
  renderGrid();
  loadTheme();
});
elements.categoryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  state.selectedCategory = button.dataset.category;
  renderGrid();
});
elements.close.addEventListener("click", closePanel);
elements.backdrop.addEventListener("click", closePanel);
elements.trashButton.addEventListener("click", () => {
  const image = state.images.find((candidate) => candidate.id === state.selectedImageId);
  if (image) moveToTrash(image);
});

async function refreshArchiveImages() {
  if (elements.archiveRefresh.disabled) return;
  const original = elements.archiveRefresh.textContent;
  elements.archiveRefresh.disabled = true;
  elements.archiveRefresh.textContent = "↻ 불러오는 중…";
  state.productionRecords.clear();
  const loaded = await loadImages();
  elements.archiveRefresh.textContent = loaded ? "✓ 새로고침 완료" : "새로고침 실패";
  setTimeout(() => {
    elements.archiveRefresh.textContent = original;
    elements.archiveRefresh.disabled = false;
  }, 900);
}

async function refreshSelectedImage() {
  if (elements.detailRefresh.disabled || !state.selectedImageId) return;
  const requestedImageId = state.selectedImageId;
  const original = elements.detailRefresh.textContent;
  elements.detailRefresh.disabled = true;
  elements.detailRefresh.textContent = "불러오는 중…";
  try {
    const response = await fetch(`/api/images/${encodeURIComponent(requestedImageId)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Image detail request failed");
    const payload = await response.json();
    if (state.selectedImageId !== requestedImageId) return;
    const image = {
      ...payload.image,
      category: payload.image.category
        ?? (payload.image.group === "extra-requests" ? "legacy-extra" : "daily-theme"),
    };
    const index = state.images.findIndex((candidate) => candidate.id === requestedImageId);
    if (index >= 0) state.images[index] = image;
    state.productionRecords.delete(requestedImageId);
    renderPanelImage(image, { refreshPreview: true });
    await loadProductionRecord(image);
    if (state.selectedImageId === requestedImageId) {
      elements.detailRefresh.textContent = "✓ 완료";
    }
  } catch {
    if (state.selectedImageId === requestedImageId) {
      elements.detailRefresh.textContent = "다시 시도";
    }
  } finally {
    setTimeout(() => {
      elements.detailRefresh.textContent = original;
      elements.detailRefresh.disabled = false;
    }, 900);
  }
}

elements.archiveRefresh.addEventListener("click", refreshArchiveImages);
elements.detailRefresh.addEventListener("click", refreshSelectedImage);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.panel.classList.contains("open")) closePanel();
});

async function loadImages() {
try {
  const response = await fetch("/api/images", { cache: "no-store" });
  if (!response.ok) throw new Error("Archive request failed");
  const payload = await response.json();
  state.images = Array.isArray(payload.images) ? payload.images : [];
  state.images = state.images.map((image) => ({
    ...image,
    category: image.category ?? (image.group === "extra-requests" ? "legacy-extra" : "daily-theme"),
  }));
  const sourceCount = Object.values(payload.sources ?? {}).filter(
    (source) => source.available,
  ).length;
  elements.status.classList.toggle("online", sourceCount > 0);
  elements.status.lastChild.textContent =
    sourceCount > 0 ? ` ${sourceCount}개 저장소 연결됨` : " 저장소 연결 준비 중";
  renderFilters();
  renderGrid();
  return true;
} catch {
  elements.message.textContent =
    "이미지 모듈을 아직 실제 저장소에 연결하지 않았어요. 설정 후 이곳에 표시됩니다.";
  elements.status.lastChild.textContent = " 이미지 모듈 준비 중";
  elements.imageCount.textContent = "0";
  elements.dateCount.textContent = "0";
  return false;
}
}

async function loadGenerationStatus() {
  try {
    const response = await fetch("/api/images/generation-jobs", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    const highlighted = jobs.find((job) => job.status === "attention")
      ?? jobs.find((job) => job.status === "processing")
      ?? jobs[0];
    elements.generationStatus.className = `generation-status ${highlighted?.status ?? "idle"}`;
    elements.generationStatus.textContent = highlighted
      ? `${STAGE_LABELS[highlighted.stage] ?? "생성 상태"} · ${highlighted.progress.completed}/${highlighted.progress.total}`
      : "추가 생성 기록 없음";
    if (state.previousActiveCount > 0 && payload.activeCount === 0) await loadImages();
    state.previousActiveCount = payload.activeCount;
  } catch {
    elements.generationStatus.className = "generation-status attention";
    elements.generationStatus.textContent = "생성 상태 확인 필요";
  }
}

await loadImages();
loadTheme();
loadGenerationStatus();
setInterval(loadGenerationStatus, 10_000);
