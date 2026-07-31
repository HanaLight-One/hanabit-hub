const dateSelect = document.querySelector("#date-select");
const downloadLink = document.querySelector("#download-link");
const publicationStatus = document.querySelector("#publication-status");
const publicationTime = document.querySelector("#publication-time");
const publicationDot = document.querySelector("#publication-dot");
const publicationLink = document.querySelector("#publication-link");
const notice = document.querySelector("#notice");
const fortuneText = document.querySelector("#fortune-text");

const STATUS_LABELS = {
  posted: "게시 완료",
  attention: "확인 필요",
  running: "처리 중",
  pending: "게시 대기",
};

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { dateStyle:"medium", timeStyle:"short" }).format(date);
}

function render(payload) {
  dateSelect.replaceChildren();
  const dates = payload.dates.includes(payload.date) ? payload.dates : [payload.date, ...payload.dates];
  for (const date of dates) dateSelect.add(new Option(date === payload.date ? `${date} · 선택됨` : date, date));
  dateSelect.value = payload.date;
  dateSelect.disabled = false;

  const status = payload.publication.status;
  publicationStatus.textContent = STATUS_LABELS[status] ?? "상태 확인 필요";
  publicationDot.className = status;
  publicationTime.textContent = formatDateTime(payload.publication.updatedAt);
  publicationLink.hidden = !payload.publication.url;
  if (payload.publication.url) publicationLink.href = payload.publication.url;

  if (payload.available) {
    fortuneText.textContent = payload.text;
    fortuneText.hidden = false;
    notice.hidden = true;
    downloadLink.href = `/api/fortune/text/${encodeURIComponent(payload.date)}`;
    downloadLink.classList.remove("disabled");
    downloadLink.removeAttribute("aria-disabled");
  } else {
    fortuneText.textContent = "";
    fortuneText.hidden = true;
    notice.hidden = false;
    notice.textContent = "이 날짜의 운세 본문은 아직 준비되지 않았어요.";
    downloadLink.removeAttribute("href");
    downloadLink.classList.add("disabled");
    downloadLink.setAttribute("aria-disabled", "true");
  }
}

async function load(date) {
  dateSelect.disabled = true;
  try {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await fetch(`/api/fortune${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error("fortune unavailable");
    render(await response.json());
  } catch {
    notice.hidden = false;
    notice.textContent = "운세를 불러오지 못했어요.";
  }
}

dateSelect.addEventListener("change", () => load(dateSelect.value));
await load();
