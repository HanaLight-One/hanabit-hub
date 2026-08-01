const elements = {
  connection: document.querySelector("#connection"),
  form: document.querySelector("#upload-form"),
  file: document.querySelector("#style-file"),
  uploadButton: document.querySelector("#upload-button"),
  uploadResult: document.querySelector("#upload-result"),
  reindexButton: document.querySelector("#reindex-button"),
  indexResult: document.querySelector("#index-result"),
  indexedCount: document.querySelector("#indexed-count"),
  styleCount: document.querySelector("#style-count"),
  list: document.querySelector("#style-list"),
};

function styleCard(style) {
  const article = document.createElement("article");
  article.className = `style-item${style.indexed ? "" : " missing"}`;
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = style.id;
  const meta = document.createElement("span");
  meta.textContent = `${style.indexed ? "생성기 인식 완료" : "색인 갱신 필요"} · ${Math.max(1, Math.ceil(style.size / 1024))}KB`;
  text.append(title, meta);
  const link = document.createElement("a");
  link.href = style.downloadUrl;
  link.textContent = "TXT 다운로드";
  article.append(text, link);
  return article;
}

async function loadStyles() {
  const response = await fetch("/api/images/styles", { cache: "no-store" });
  if (!response.ok) throw new Error("화풍 목록을 불러오지 못했어요.");
  const payload = await response.json();
  elements.styleCount.textContent = payload.count;
  elements.indexedCount.textContent = payload.indexedCount;
  elements.list.replaceChildren(...payload.styles.map(styleCard));
  elements.indexResult.textContent = payload.count === payload.indexedCount
    ? `전체 ${payload.count}개가 생성기에 연결되어 있어요.`
    : `${payload.count - payload.indexedCount}개 화풍의 색인 갱신이 필요해요.`;
  elements.connection.innerHTML = `<span></span> 화풍 ${payload.count}개 연결됨`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했어요.");
  return payload;
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const [file] = elements.file.files;
  if (!file) return;
  if (file.size > 512 * 1024) {
    elements.uploadResult.textContent = "512KB 이하의 화풍 TXT를 선택해 주세요.";
    return;
  }
  elements.file.disabled = true;
  elements.uploadButton.disabled = true;
  elements.uploadResult.textContent = "화풍을 올리고 생성기 색인을 갱신하는 중이에요.";
  try {
    await postJson("/api/images/styles/upload", {
      filename: file.name,
      content: await file.text(),
      confirmation: "upload-style",
    });
    elements.form.reset();
    elements.uploadResult.textContent = `${file.name} 업로드와 색인 갱신이 끝났어요.`;
    await loadStyles();
  } catch (error) {
    elements.uploadResult.textContent = error.message;
  } finally {
    elements.file.disabled = false;
    elements.uploadButton.disabled = false;
  }
});

elements.reindexButton.addEventListener("click", async () => {
  elements.reindexButton.disabled = true;
  elements.indexResult.textContent = "기존 Python 색인 빌더를 실행하는 중이에요.";
  try {
    await postJson("/api/images/styles/reindex", { confirmation: "reindex-styles" });
    await loadStyles();
  } catch (error) {
    elements.indexResult.textContent = error.message;
  } finally {
    elements.reindexButton.disabled = false;
  }
});

loadStyles().catch((error) => {
  elements.connection.textContent = "화풍 보관함 연결 확인 필요";
  elements.indexResult.textContent = error.message;
  elements.list.textContent = "화풍 목록을 표시하지 못했어요.";
});
