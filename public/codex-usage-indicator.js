const indicator = document.createElement("div");
indicator.className = "hub-codex-meter hub-codex-meter-floating";
indicator.setAttribute("role", "status");
indicator.setAttribute("aria-live", "polite");
indicator.setAttribute("aria-label", "Codex 주간 남은량 확인 중");
indicator.innerHTML = `
  <strong class="hub-codex-meter-value">--%</strong>
  <span class="hub-codex-meter-dot" aria-hidden="true"></span>
`;

document.body.append(indicator);

function mountInHeader() {
  const header = document.querySelector("body > header, #news-root > header, #notifications-root > header");
  if (!header) return false;
  const connection = header.querySelector(":scope > .connection");
  indicator.classList.remove("hub-codex-meter-floating");
  indicator.classList.add("hub-codex-meter-in-header");
  indicator.classList.toggle("uses-host-dot", Boolean(connection));
  if (connection) header.insertBefore(indicator, connection);
  else header.append(indicator);
  return true;
}

if (!mountInHeader()) {
  const observer = new MutationObserver(() => {
    if (mountInHeader()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

const valueElement = indicator.querySelector(".hub-codex-meter-value");

async function loadUsage() {
  try {
    const response = await fetch("/api/system/codex/usage");
    const usage = await response.json();
    const window = usage.primary ?? usage.secondary;
    if (!response.ok || !usage.available || !window) throw new Error("Unavailable");
    const remaining = Math.round(window.remainingPercent);
    const reset = window.resetsAt
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(window.resetsAt))
      : null;
    valueElement.textContent = `${remaining}%`;
    indicator.classList.add("online");
    indicator.title = `Codex 주간 남은량${reset ? ` · ${reset} 초기화` : ""}`;
    indicator.setAttribute("aria-label", `Codex 주간 남은량 ${remaining}%`);
    return true;
  } catch {
    valueElement.textContent = "--%";
    indicator.classList.remove("online");
    indicator.title = "Codex 사용량 확인 필요";
    indicator.setAttribute("aria-label", "Codex 사용량 확인 필요");
    return false;
  }
}

if (!(await loadUsage())) window.setTimeout(loadUsage, 5_000);
window.setInterval(loadUsage, 60_000);
