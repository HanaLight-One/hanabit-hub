const elements = {
  status: document.querySelector("#archive-status"),
  message: document.querySelector("#archive-message"),
  grid: document.querySelector("#image-grid"),
  imageCount: document.querySelector("#image-count"),
  dateCount: document.querySelector("#date-count"),
  dateFilter: document.querySelector("#date-filter"),
  themeLabel: document.querySelector("#theme-label"),
  themeTitle: document.querySelector("#theme-title"),
  themeDate: document.querySelector("#theme-date"),
  themeText: document.querySelector("#theme-text"),
  panel: document.querySelector("#detail-panel"),
  backdrop: document.querySelector("#panel-backdrop"),
  close: document.querySelector("#panel-close"),
  detailTitle: document.querySelector("#detail-title"),
  detailImage: document.querySelector("#detail-image"),
  basicRecord: document.querySelector("#basic-record"),
  recordMessage: document.querySelector("#record-message"),
  productionRecord: document.querySelector("#production-record"),
  createLink: document.querySelector("#create-link"),
  originalLink: document.querySelector("#original-link"),
  downloadLink: document.querySelector("#download-link"),
};

const state = {
  images: [],
  selectedDate: "all",
  currentOperationalDate: null,
  selectedImageId: null,
  lastFocused: null,
  themeRequest: 0,
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
  return state.selectedDate === "all"
    ? state.images
    : state.images.filter((image) => (image.date ?? "undated") === state.selectedDate);
}

function renderGrid() {
  const images = visibleImages();
  elements.grid.replaceChildren();
  elements.message.hidden = images.length > 0;
  if (images.length === 0) {
    elements.message.textContent =
      state.images.length === 0
        ? "아직 연결된 이미지가 없어요."
        : "선택한 날짜에 이미지가 없어요.";
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const image of images) {
    const card = document.createElement("button");
    card.className = "image-card";
    card.type = "button";
    card.setAttribute("aria-label", `${image.name} 제작 기록 열기`);

    const preview = document.createElement("img");
    preview.src = image.thumbnailUrl;
    preview.alt = "";
    preview.loading = "lazy";

    const copy = document.createElement("span");
    copy.className = "card-copy";
    const name = document.createElement("strong");
    name.textContent = image.name;
    const meta = document.createElement("span");
    meta.textContent = `${image.date ?? "날짜 없음"} · ${image.group}`;
    copy.append(name, meta);
    card.append(preview, copy);
    card.addEventListener("click", () => openPanel(image, card));
    fragment.append(card);
  }
  elements.grid.append(fragment);
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
  elements.recordMessage.hidden = false;
  elements.recordMessage.textContent = "제작 기록을 확인하는 중이에요.";

  try {
    const response = await fetch(image.productionRecordUrl);
    if (state.selectedImageId !== requestedImageId) return;
    if (response.status === 404) {
      elements.recordMessage.textContent =
        "이 이미지는 이전 기록이라 구조화된 제작 기록이 아직 없어요.";
      return;
    }
    if (!response.ok) throw new Error("Production record request failed");
    const { record } = await response.json();
    elements.recordMessage.hidden = true;
    appendDefinitionList(elements.productionRecord, [
      ["등장인물", record.characters.join(", ")],
      ["관계 그룹", record.relationGroup],
      ["화풍", record.style],
      ["생성 시각", formatDateTime(record.createdAt)],
      ["소요 시간", formatDuration(record.durationMs)],
      ["재시도", `${record.retryCount}회`],
    ]);
  } catch {
    if (state.selectedImageId !== requestedImageId) return;
    elements.recordMessage.textContent = "제작 기록을 불러오지 못했어요.";
  }
}

function openPanel(image, trigger) {
  state.selectedImageId = image.id;
  state.lastFocused = trigger;
  elements.detailTitle.textContent = image.name;
  elements.detailImage.src = image.thumbnailUrl;
  elements.detailImage.alt = `${image.name} 미리보기`;
  elements.createLink.href =
    `/images/create?source=${encodeURIComponent(image.id)}&mode=same-combination`;
  elements.originalLink.href = image.contentUrl;
  elements.downloadLink.href = image.downloadUrl;
  appendDefinitionList(elements.basicRecord, [
    ["날짜", image.date ?? "날짜 없음"],
    ["앨범", image.album],
    ["그룹", image.group],
    ["파일 크기", formatBytes(image.size)],
    ["수정 시각", formatDateTime(image.modifiedAt)],
  ]);
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
elements.close.addEventListener("click", closePanel);
elements.backdrop.addEventListener("click", closePanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.panel.classList.contains("open")) closePanel();
});

try {
  const response = await fetch("/api/images");
  if (!response.ok) throw new Error("Archive request failed");
  const payload = await response.json();
  state.images = Array.isArray(payload.images) ? payload.images : [];
  const sourceCount = Object.values(payload.sources ?? {}).filter(
    (source) => source.available,
  ).length;
  elements.status.classList.toggle("online", sourceCount > 0);
  elements.status.lastChild.textContent =
    sourceCount > 0 ? ` ${sourceCount}개 저장소 연결됨` : " 저장소 연결 준비 중";
  renderFilters();
  renderGrid();
  loadTheme();
} catch {
  elements.message.textContent =
    "이미지 모듈을 아직 실제 저장소에 연결하지 않았어요. 설정 후 이곳에 표시됩니다.";
  elements.status.lastChild.textContent = " 이미지 모듈 준비 중";
  elements.imageCount.textContent = "0";
  elements.dateCount.textContent = "0";
  loadTheme();
}
