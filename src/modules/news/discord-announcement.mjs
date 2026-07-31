import { createHash } from "node:crypto";

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gu;

function valuesOf(collection) {
  if (!collection) return [];
  if (typeof collection.values === "function") return [...collection.values()];
  return Array.isArray(collection) ? collection : [];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanUrl(value) {
  const candidate = cleanText(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function extractLinks(...values) {
  const links = new Set();
  for (const value of values) {
    for (const match of cleanText(value).matchAll(URL_PATTERN)) {
      const url = cleanUrl(match[0].replace(/[.,!?;:]+$/u, ""));
      if (url) links.add(url);
    }
  }
  return [...links];
}

function normalizeEmbed(embed) {
  const fields = valuesOf(embed?.fields)
    .map((field) => ({
      name: cleanText(field?.name),
      value: cleanText(field?.value),
    }))
    .filter((field) => field.name || field.value);

  return {
    title: cleanText(embed?.title),
    description: cleanText(embed?.description),
    url: cleanUrl(embed?.url),
    fields,
  };
}

function mediaFromMessage(message) {
  const candidates = [];

  for (const attachment of valuesOf(message?.attachments)) {
    const contentType = cleanText(attachment?.contentType).toLowerCase();
    if (contentType && !contentType.startsWith("image/")) continue;
    const url = cleanUrl(attachment?.url);
    if (!url) continue;
    candidates.push({
      kind: "attachment",
      url,
      name: cleanText(attachment?.name) || "attachment",
      contentType: contentType || null,
      declaredSize: Number(attachment?.size) || null,
    });
  }

  for (const embed of valuesOf(message?.embeds)) {
    for (const [kind, image] of [
      ["embed-image", embed?.image],
      ["embed-thumbnail", embed?.thumbnail],
    ]) {
      const url = cleanUrl(image?.proxyURL) ?? cleanUrl(image?.url);
      if (!url) continue;
      candidates.push({ kind, url, name: kind, contentType: null, declaredSize: null });
    }
  }

  return [...new Map(candidates.map((item) => [item.url, item])).values()].slice(0, 10);
}

export function normalizeDiscordAnnouncement(message, { channelId }) {
  const messageId = cleanText(message?.id);
  if (!/^\d{17,20}$/u.test(messageId) || !/^\d{17,20}$/u.test(channelId)) {
    throw new TypeError("Discord 메시지와 채널 ID가 필요합니다.");
  }

  const content = cleanText(message?.content);
  const embeds = valuesOf(message?.embeds).map(normalizeEmbed).filter((embed) =>
    embed.title || embed.description || embed.url || embed.fields.length,
  );
  const mediaCandidates = mediaFromMessage(message);
  const embedTexts = embeds.flatMap((embed) => [
    embed.title,
    embed.description,
    ...embed.fields.flatMap((field) => [field.name, field.value]),
  ]);

  if (!content && embeds.length === 0 && mediaCandidates.length === 0) return null;

  const id = createHash("sha256")
    .update(`discord\0${channelId}\0${messageId}`)
    .digest("hex")
    .slice(0, 32);
  const publishedAt = new Date(message.createdTimestamp ?? message.createdAt ?? Date.now());

  return {
    id,
    mediaCandidates,
    record: {
      schemaVersion: 1,
      id,
      source: {
        type: "discord-announcement",
        channelId,
        messageId,
        url: cleanUrl(message?.url),
        publishedAt: publishedAt.toISOString(),
      },
      original: {
        language: "en",
        content,
        embeds,
        links: extractLinks(content, ...embedTexts, ...embeds.map((embed) => embed.url)),
      },
      workflow: {
        status: "pending_translation",
        translation: null,
        triage: null,
        dcPublication: null,
      },
      collectedAt: new Date().toISOString(),
    },
  };
}
