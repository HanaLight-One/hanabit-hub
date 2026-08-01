import { xLinksFromStreamEvent } from "./x-filtered-stream.mjs";

export function createXStreamDiscordBridge({
  channel,
  allowedHandles,
  collector,
  parseEvent = xLinksFromStreamEvent,
}) {
  if (!channel?.send || !collector?.hasPost) {
    throw new TypeError("X 스트림 Discord 연결 경계가 준비되지 않았습니다.");
  }
  const forwarded = new Set();

  async function forwardEvent(event) {
    const detected = parseEvent(event, { allowedHandles });
    if (!detected) return Object.freeze({ status: "ignored", contextCount: 0 });
    const key = `${detected.handle.toLowerCase()}:${detected.statusId}`;
    if (forwarded.has(key) || await collector.hasPost(detected)) {
      return Object.freeze({ status: "existing", contextCount: detected.links.length - 1 });
    }
    forwarded.add(key);
    try {
      await channel.send({
        content: detected.links.join("\n"),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      forwarded.delete(key);
      throw error;
    }
    return Object.freeze({ status: "forwarded", contextCount: detected.links.length - 1 });
  }

  return Object.freeze({ forwardEvent });
}

