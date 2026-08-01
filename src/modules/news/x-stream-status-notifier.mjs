const STATUS_MESSAGES = Object.freeze({
  connected: (sourceCount, reconnected) =>
    `✅ X 실시간 감시 ${reconnected ? "재연결됨" : "연결됨"} · 감시 계정 ${sourceCount}개`,
  reconnecting: () => "⚠️ X 실시간 감시 재연결 중 · 잠시 후 다시 시도해요.",
  limited: () => "🚨 X 실시간 감시 제한됨 · 크레딧 또는 사용 한도를 확인해 주세요.",
  stopped: () => "🚨 X 실시간 감시 중단 · 인증과 API 이용 상태를 확인해 주세요.",
});

export function createXStreamStatusNotifier({ channel, sourceCount }) {
  if (!channel || typeof channel.send !== "function") {
    throw new TypeError("X 상태 알림 채널이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 1 || sourceCount > 100) {
    throw new TypeError("X 감시 계정 수가 올바르지 않습니다.");
  }

  let currentStatus = null;
  let hasConnected = false;

  return Object.freeze({
    async announce(status) {
      const messageFactory = STATUS_MESSAGES[status];
      if (!messageFactory) throw new TypeError("알 수 없는 X 감시 상태입니다.");
      if (status === currentStatus) return false;

      const previousStatus = currentStatus;
      const reconnected = status === "connected" && hasConnected;
      currentStatus = status;
      try {
        await channel.send({
          content: messageFactory(sourceCount, reconnected),
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        currentStatus = previousStatus;
        throw error;
      }
      if (status === "connected") hasConnected = true;
      return true;
    },
  });
}
