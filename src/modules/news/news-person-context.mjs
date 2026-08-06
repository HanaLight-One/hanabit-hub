const PERSON_PROFILES = Object.freeze({
  nikitabier: Object.freeze({
    handle: "nikitabier",
    label: "Nikita Bier 공개 이력",
    content: [
      "Nikita Bier co-founded the consumer social apps tbh and Gas, which were acquired by Facebook and Discord respectively.",
      "He later served as Head of Product at X and is known for consumer product design and growth.",
      "The source announces that he is joining the Codex team, but does not state his exact role there.",
    ].join(" "),
  }),
});

const PERSONNEL_ANNOUNCEMENT_PATTERN = /(?:\bwelcome\s+@?[a-z0-9_]+\s+to\b|\bjoin(?:s|ed|ing)?\s+(?:the\s+)?[^\n.!?]{0,80}\bteam\b|팀에\s*합류|합류를\s*환영)/iu;

function sourceText(record) {
  return [
    record?.original?.content,
    ...(record?.original?.embeds ?? []).flatMap((embed) => [embed?.title, embed?.description]),
  ].filter(Boolean).join("\n");
}

function mentionedHandles(value) {
  return [...String(value ?? "").matchAll(/@([a-z0-9_]{1,30})/giu)]
    .map((match) => match[1].toLowerCase());
}

export function isPersonnelAnnouncement(record) {
  return PERSONNEL_ANNOUNCEMENT_PATTERN.test(sourceText(record));
}

export function enrichMentionedPersonContext(record) {
  if (!isPersonnelAnnouncement(record)) return record;
  const contexts = Array.isArray(record?.original?.contexts) ? record.original.contexts : [];
  const existing = new Set(contexts
    .filter((context) => context?.relation === "public-background")
    .map((context) => String(context?.account ?? "").toLowerCase()));
  const additions = [...new Set(mentionedHandles(sourceText(record)))]
    .map((handle) => PERSON_PROFILES[handle])
    .filter((profile) => profile && !existing.has(profile.handle))
    .map((profile) => ({
      relation: "public-background",
      account: profile.handle,
      label: profile.label,
      content: profile.content,
    }));
  if (!additions.length) return record;
  return {
    ...record,
    original: {
      ...record.original,
      contexts: [...contexts, ...additions].slice(0, 3),
    },
  };
}

