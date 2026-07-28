const statusElement = document.querySelector("#server-status");

try {
  const response = await fetch("/api/health");
  const health = await response.json();

  if (!response.ok || !health.ok) throw new Error("Unhealthy response");

  statusElement.classList.add("online");
  statusElement.lastChild.textContent = " 연결됨";
} catch {
  statusElement.lastChild.textContent = " 연결 확인 필요";
}
