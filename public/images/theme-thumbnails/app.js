const elements = {
  connection: document.querySelector("#connection"), todayDate: document.querySelector("#today-date"),
  today: document.querySelector("#today-selection"), forceForm: document.querySelector("#force-form"),
  forceDate: document.querySelector("#force-date"), forceThumbnail: document.querySelector("#force-thumbnail"),
  clearForce: document.querySelector("#clear-force"), forceResult: document.querySelector("#force-result"),
  uploadForm: document.querySelector("#upload-form"), uploadFile: document.querySelector("#upload-file"),
  uploadLabel: document.querySelector("#upload-label"), uploadResult: document.querySelector("#upload-result"),
  list: document.querySelector("#thumbnail-list"), recent: document.querySelector("#recent-list"), forced: document.querySelector("#forced-list"),
};
let current = null;

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했어요.");
  return payload;
}

function jsonMutation(url, body, method = "POST") {
  return request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function compactItem(left, right) {
  const row = document.createElement("div"); row.className = "compact-item";
  const strong = document.createElement("strong"); strong.textContent = left;
  const span = document.createElement("span"); span.textContent = right;
  row.append(strong, span); return row;
}

function card(asset) {
  const article = document.createElement("article");
  article.className = `thumbnail-card${current.todaySelection === asset.filename ? " is-today" : ""}`;
  const image = document.createElement("img"); image.src = asset.previewUrl; image.alt = asset.label; image.loading = "lazy";
  const body = document.createElement("div"); body.className = "thumbnail-body";
  const title = document.createElement("div"); title.className = "thumbnail-title";
  const strong = document.createElement("strong"); strong.textContent = asset.label;
  title.append(strong);
  if (current.todaySelection === asset.filename) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = current.todayForced ? "오늘 강제" : "오늘 선택"; title.append(badge); }
  const meta = document.createElement("p"); meta.className = "thumbnail-meta"; meta.textContent = `${asset.filename} · 누적 ${asset.selectionCount}회 · 최근 ${asset.lastSelectedDate ?? "아직 없음"}`;
  const form = document.createElement("form"); form.className = "thumbnail-settings";
  form.innerHTML = `<label>표시 이름<input name="label" maxlength="60" required></label><label>기본 가중치<input name="weight" type="number" min="0" max="10" step="0.1" required></label>`;
  form.elements.label.value = asset.label; form.elements.weight.value = asset.weight;
  const actions = document.createElement("div"); actions.className = "thumbnail-actions";
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "설정 저장";
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "삭제";
  actions.append(save, remove); form.append(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true;
    try { current = await jsonMutation(`/api/images/theme-thumbnails/${asset.filename}/settings`, { label: form.elements.label.value, weight: Number(form.elements.weight.value), confirmation: "update-theme-thumbnail" }); render(); }
    catch (error) { alert(error.message); } finally { save.disabled = false; }
  });
  remove.addEventListener("click", async () => {
    if (!confirm(`${asset.label} (${asset.filename})을 서버에서도 삭제할까요?`)) return;
    remove.disabled = true;
    try { current = await jsonMutation(`/api/images/theme-thumbnails/${asset.filename}`, { confirmation: "delete-theme-thumbnail" }, "DELETE"); render(); }
    catch (error) { alert(error.message); } finally { remove.disabled = false; }
  });
  body.append(title, meta, form); article.append(image, body); return article;
}

function render() {
  elements.connection.innerHTML = `<span></span> 썸네일 ${current.assets.length}장 연결됨`;
  elements.todayDate.textContent = current.today;
  const selected = current.assets.find((asset) => asset.filename === current.todaySelection);
  elements.today.replaceChildren();
  const strong = document.createElement("strong"); strong.textContent = selected ? selected.label : "아직 선택 전";
  const detail = document.createTextNode(selected ? `${selected.filename} · ${current.todayForced ? "강제 선택" : "07:30 선택 기록"}` : " 07:30 게시 준비 때 자동으로 선택돼요.");
  elements.today.append(strong, detail);
  elements.forceDate.value ||= current.today;
  const selectedValue = elements.forceThumbnail.value;
  elements.forceThumbnail.replaceChildren(...current.assets.map((asset) => {
    const option = document.createElement("option"); option.value = asset.filename; option.textContent = `${asset.label} (${asset.filename})`; return option;
  }));
  if (current.assets.some((asset) => asset.filename === selectedValue)) elements.forceThumbnail.value = selectedValue;
  elements.list.replaceChildren(...current.assets.map(card));
  elements.recent.replaceChildren(...(current.recent.length ? current.recent.map((item) => compactItem(item.date, current.assets.find((asset) => asset.filename === item.filename)?.label ?? item.filename)) : [compactItem("기록 없음", "첫 선택을 기다리는 중") ]));
  elements.forced.replaceChildren(...(current.forced.length ? current.forced.map((item) => compactItem(item.date, current.assets.find((asset) => asset.filename === item.filename)?.label ?? item.filename)) : [compactItem("예약 없음", "평소 가중 랜덤 사용") ]));
}

elements.forceForm.addEventListener("submit", async (event) => {
  event.preventDefault(); elements.forceResult.textContent = "날짜를 고정하는 중이에요.";
  try { current = await jsonMutation("/api/images/theme-thumbnails/force", { date: elements.forceDate.value, filename: elements.forceThumbnail.value, confirmation: "force-theme-thumbnail" }); elements.forceResult.textContent = `${elements.forceDate.value} 예약을 저장했어요.`; render(); }
  catch (error) { elements.forceResult.textContent = error.message; }
});
elements.clearForce.addEventListener("click", async () => {
  elements.forceResult.textContent = "예약을 해제하는 중이에요.";
  try { current = await jsonMutation("/api/images/theme-thumbnails/force", { date: elements.forceDate.value, filename: null, confirmation: "force-theme-thumbnail" }); elements.forceResult.textContent = `${elements.forceDate.value} 예약을 해제했어요.`; render(); }
  catch (error) { elements.forceResult.textContent = error.message; }
});
elements.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const [file] = elements.uploadFile.files; if (!file) return;
  elements.uploadResult.textContent = "PNG를 안전하게 확인하고 있어요.";
  try {
    current = await request("/api/images/theme-thumbnails/upload", { method: "POST", headers: { "content-type": "image/png", "x-thumbnail-confirmation": "upload-theme-thumbnail", "x-thumbnail-label": encodeURIComponent(elements.uploadLabel.value) }, body: file });
    elements.uploadForm.reset(); elements.uploadResult.textContent = `${current.filename ?? file.name} 업로드를 마쳤어요.`; render();
  } catch (error) { elements.uploadResult.textContent = error.message; }
});

request("/api/images/theme-thumbnails").then((payload) => { current = payload; render(); }).catch((error) => { elements.connection.textContent = "썸네일 연결 확인 필요"; elements.list.textContent = error.message; });
