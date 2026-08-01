const statusElement = document.querySelector("#server-status");
const serverStatusCopy = document.querySelector("#server-status-copy");
const codexStatusElement = document.querySelector("#codex-control-status");
const restartCodexButton = document.querySelector("#restart-codex");
const codexUsageValue = document.querySelector("#codex-usage-value");

try {
  const response = await fetch("/api/health");
  const health = await response.json();

  if (!response.ok || !health.ok) throw new Error("Unhealthy response");

  statusElement.classList.add("online");
  serverStatusCopy.textContent = "연결됨";
} catch {
  serverStatusCopy.textContent = "연결 확인 필요";
}

async function loadCodexControl() {
  try {
    const response = await fetch("/api/system/codex");
    const status = await response.json();
    if (!response.ok || !status.available) {
      throw new Error("Unavailable");
    }

    restartCodexButton.disabled = false;
    codexStatusElement.textContent = status.running
      ? "Codex가 실행 중이에요. 멈췄을 때만 사용해 주세요."
      : "Codex가 응답하지 않을 때 안전하게 다시 열 수 있어요.";
  } catch {
    restartCodexButton.disabled = true;
    codexStatusElement.textContent = "이 서버에서는 긴급 재기동을 사용할 수 없어요.";
  }
}

restartCodexButton.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Codex 앱을 종료하고 다시 열까요?\n진행 중인 Codex 작업은 중단될 수 있어요.",
  );
  if (!confirmed) return;

  restartCodexButton.disabled = true;
  codexStatusElement.textContent = "재기동 신호를 전달하고 있어요…";

  try {
    const response = await fetch("/api/system/codex/restart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "restart-codex" }),
    });
    const result = await response.json();
    if (!response.ok || !result.accepted) throw new Error(result.error);

    codexStatusElement.textContent =
      "재기동 신호를 보냈어요. 보통 10~30초 안에 Codex가 다시 열려요.";
  } catch {
    codexStatusElement.textContent =
      "재기동 신호를 보내지 못했어요. 잠시 후 페이지를 새로고침해 주세요.";
    window.setTimeout(loadCodexControl, 60_000);
  }
});

await loadCodexControl();

async function loadCodexUsage() {
  try {
    const response = await fetch("/api/system/codex/usage");
    const usage = await response.json();
    const window = usage.primary ?? usage.secondary;
    if (!response.ok || !usage.available || !window) throw new Error("Unavailable");
    codexUsageValue.textContent = `${Math.round(window.remainingPercent)}%`;
    const reset = window.resetsAt
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(window.resetsAt))
      : null;
    codexUsageValue.title = `Codex 주간 남은량${reset ? ` · ${reset} 초기화` : ""}`;
    return true;
  } catch {
    codexUsageValue.textContent = "--%";
    codexUsageValue.title = "Codex 사용량 확인 필요";
    return false;
  }
}

if (!(await loadCodexUsage())) {
  window.setTimeout(loadCodexUsage, 5_000);
}
window.setInterval(loadCodexUsage, 60_000);
