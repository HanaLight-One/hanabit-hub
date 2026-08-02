const grid = document.querySelector("#trash-grid");
const message = document.querySelector("#message");

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
  }).format(date);
}

async function mutate(item, action) {
  const deleting = action === "delete";
  const question = deleting
    ? `'${item.image.name}'을 영구 삭제할까요?\n서버 파일과 DB 기록이 함께 사라지고 복원할 수 없어요.`
    : `'${item.image.name}'을 원래 위치로 복원할까요?`;
  if (!confirm(question)) return;
  if (deleting && !confirm("정말 영구 삭제할까요? 이 작업은 되돌릴 수 없어요.")) return;
  const response = await fetch(`/api/images/trash/${item.id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: deleting ? "permanently-delete-image" : "restore-image-from-trash" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return alert(payload.error ?? "휴지통 작업을 완료하지 못했어요.");
  await load();
}

function render(items) {
  grid.replaceChildren();
  message.hidden = items.length > 0;
  if (!items.length) {
    message.textContent = "휴지통이 비어 있어요.";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "trash-card";
    const image = document.createElement("img");
    image.src = item.image.contentUrl;
    image.alt = `${item.image.name} 미리보기`;
    const body = document.createElement("div");
    body.className = "trash-card-body";
    const title = document.createElement("h2");
    title.textContent = item.image.name;
    const meta = document.createElement("p");
    meta.textContent = `${item.image.date ?? "날짜 없음"} · ${formatDateTime(item.trashedAt)} 이동`;
    const facts = document.createElement("p");
    const record = item.productionRecord;
    facts.textContent = record
      ? `${record.characters?.join(", ") || "등장인물 기록 없음"} · ${record.style || "화풍 기록 없음"}`
      : "제작 기록 없음";
    const actions = document.createElement("div");
    actions.className = "trash-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "복원";
    restore.addEventListener("click", () => mutate(item, "restore"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "permanent-delete";
    remove.textContent = "영구 삭제";
    remove.addEventListener("click", () => mutate(item, "delete"));
    actions.append(restore, remove);
    body.append(title, meta, facts, actions);
    card.append(image, body);
    fragment.append(card);
  }
  grid.append(fragment);
}

async function load() {
  try {
    const response = await fetch("/api/images/trash", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (!payload.enabled) {
      message.hidden = false;
      message.textContent = "이 서버에서는 이미지 휴지통 작업이 아직 허용되지 않았어요.";
      grid.replaceChildren();
      return;
    }
    render(Array.isArray(payload.items) ? payload.items : []);
  } catch {
    message.hidden = false;
    message.textContent = "휴지통을 불러오지 못했어요.";
  }
}

await load();
