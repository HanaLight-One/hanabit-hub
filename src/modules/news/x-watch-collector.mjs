import { findAllowedXPost, normalizeXWatchMessage, xPostId } from "./x-watch-source.mjs";
import { downloadDiscordMedia } from "./discord-media.mjs";
import { createPendingNewsStore } from "./news-item-store.mjs";

export function createXWatchCollector({
  stateRoot,
  channelId,
  allowedHandles,
  mediaDownloader = downloadDiscordMedia,
  resolveMessage = normalizeXWatchMessage,
  identifyMessage = (message) => {
    const post = findAllowedXPost(message, { channelId, allowedHandles });
    return post ? { id: xPostId(post), post } : null;
  },
}) {
  const store = createPendingNewsStore({ root: stateRoot });

  async function collectMessage(message, { dryRun = false } = {}) {
    const identified = identifyMessage(message);
    if (!identified) return { status: "ignored", id: null, mediaCount: 0 };
    if (await store.has(identified.id)) return { status: "existing", id: identified.id, mediaCount: 0 };
    if (dryRun) return { status: "candidate", id: identified.id, mediaCount: 0 };
    const normalized = await resolveMessage(message, { channelId, allowedHandles, post: identified.post });
    if (!normalized || normalized.id !== identified.id) throw new Error("X 뉴스 식별자가 일치하지 않습니다.");
    const result = await store.create(normalized.record, {
      writeMedia: (destination) => mediaDownloader(normalized.mediaCandidates, { destination }),
    });
    return { status: result.created ? "created" : "existing", id: normalized.id, mediaCount: result.mediaCount ?? 0 };
  }

  async function collectRecent(channel, { limit = 25, dryRun = false } = {}) {
    const messages = [...(await channel.messages.fetch({ limit })).values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const summary = { scanned: messages.length, eligible: 0, existing: 0, created: 0, media: 0, ids: [] };
    for (const message of messages) {
      const result = await collectMessage(message, { dryRun });
      if (result.status === "ignored") continue;
      summary.eligible += 1;
      if (result.status === "existing") summary.existing += 1;
      if (result.status === "created") summary.created += 1;
      if (result.id) summary.ids.push(result.id);
      summary.media += result.mediaCount;
    }
    return summary;
  }

  return Object.freeze({ collectMessage, collectRecent });
}
