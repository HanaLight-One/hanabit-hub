import { normalizeDiscordAnnouncement } from "./discord-announcement.mjs";
import { downloadDiscordMedia } from "./discord-media.mjs";
import { createPendingNewsStore } from "./news-item-store.mjs";

export function createDiscordAnnouncementCollector({
  stateRoot,
  channelId,
  mediaDownloader = downloadDiscordMedia,
}) {
  const store = createPendingNewsStore({ root: stateRoot });

  async function collectMessage(message, { dryRun = false } = {}) {
    const normalized = normalizeDiscordAnnouncement(message, { channelId });
    if (!normalized) return { status: "ignored", id: null, mediaCount: 0 };
    if (await store.has(normalized.id)) return { status: "existing", id: normalized.id, mediaCount: 0 };
    if (dryRun) return { status: "candidate", id: normalized.id, mediaCount: 0 };

    const result = await store.create(normalized.record, {
      writeMedia: (destination) =>
        mediaDownloader(normalized.mediaCandidates, { destination }),
    });
    return {
      status: result.created ? "created" : "existing",
      id: normalized.id,
      mediaCount: result.mediaCount ?? 0,
    };
  }

  async function collectRecent(channel, { limit = 25, dryRun = false } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("수집 개수는 1부터 100 사이의 정수여야 합니다.");
    }
    const messages = [...(await channel.messages.fetch({ limit })).values()].sort(
      (left, right) => left.createdTimestamp - right.createdTimestamp,
    );
    const summary = {
      scanned: messages.length,
      eligible: 0,
      existing: 0,
      created: 0,
      media: 0,
      ids: [],
    };

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
