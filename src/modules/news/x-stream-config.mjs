const TOKEN_PATTERN = /^[^\s\u0000-\u001f\u007f]{40,500}$/u;

export function loadXStreamConfig({ env = process.env } = {}) {
  const enabledValue = String(env.X_STREAM_ENABLED ?? "false").trim().toLowerCase();
  if (!new Set(["true", "false"]).has(enabledValue)) {
    throw new Error("X_STREAM_ENABLED는 true 또는 false여야 합니다.");
  }
  const enabled = enabledValue === "true";
  const bearerToken = String(env.X_BEARER_TOKEN ?? "").trim();
  if (enabled && !TOKEN_PATTERN.test(bearerToken)) {
    throw new Error("X 스트림을 사용하려면 올바른 X_BEARER_TOKEN이 필요합니다.");
  }
  return Object.freeze({ enabled, bearerToken: enabled ? bearerToken : "" });
}

