const form = document.querySelector("#token-form");
const tokenInput = document.querySelector("#bot-token");
const statusBadge = document.querySelector("#status-badge");
const result = document.querySelector("#result");
const submitButton = form.querySelector('button[type="submit"]');

function showConfigured() {
  form.hidden = true;
  tokenInput.value = "";
  statusBadge.textContent = "저장 완료";
  statusBadge.className = "badge configured";
  result.textContent =
    "Bot Token이 안전하게 설정되어 있어요. 일회성 입력 기능은 잠겼습니다.";
}

function showAvailable() {
  form.hidden = false;
  statusBadge.textContent = "입력 가능";
  statusBadge.className = "badge available";
  result.textContent = "토큰은 전송 후 화면과 메모리 입력칸에서 즉시 지워집니다.";
}

async function loadStatus() {
  try {
    const response = await fetch("/api/setup/discord-token", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("status unavailable");
    const payload = await response.json();
    payload.configured ? showConfigured() : showAvailable();
  } catch {
    form.hidden = true;
    statusBadge.textContent = "사용 불가";
    statusBadge.className = "badge error";
    result.textContent = "비밀값 저장소 상태를 확인하지 못했어요.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const token = tokenInput.value;
  submitButton.disabled = true;
  tokenInput.disabled = true;
  result.textContent = "노트북에 안전하게 저장하는 중이에요.";

  try {
    const response = await fetch("/api/setup/discord-token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        confirmation: "save-discord-bot-token",
      }),
    });
    tokenInput.value = "";
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "저장하지 못했습니다.");
    showConfigured();
  } catch (error) {
    tokenInput.value = "";
    tokenInput.disabled = false;
    submitButton.disabled = false;
    statusBadge.textContent = "다시 확인";
    statusBadge.className = "badge error";
    result.textContent = error.message;
  }
});

await loadStatus();
