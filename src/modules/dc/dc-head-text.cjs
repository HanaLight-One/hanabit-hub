const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{FE0F}\u{200D}\u{20E3}]/gu;

const DC_COMPOSER_HEAD_TEXTS = Object.freeze([
  "잡담",
  "🛠️작업",
  "❓질문",
  "💡정보",
  "뉴스/소식",
  "AI창작",
  "프롬프트",
  "🫣후방",
  "🎄대회",
  "공지",
]);

function headTextKey(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(EMOJI_PATTERN, "")
    .replace(/\s+/gu, "")
    .trim();
}

function uniqueSemanticMatch(values, requested) {
  const exact = values.find((value) => String(value?.name ?? value) === String(requested ?? ""));
  if (exact) return exact;
  const requestedKey = headTextKey(requested);
  if (!requestedKey) return null;
  const matches = values.filter((value) => headTextKey(value?.name ?? value) === requestedKey);
  return matches.length === 1 ? matches[0] : null;
}

function canonicalDcComposerHeadText(value) {
  return uniqueSemanticMatch(DC_COMPOSER_HEAD_TEXTS, value);
}

function findGalleryHeadText(heads, requested) {
  return Array.isArray(heads) ? uniqueSemanticMatch(heads, requested) : null;
}

module.exports = {
  DC_COMPOSER_HEAD_TEXTS,
  canonicalDcComposerHeadText,
  findGalleryHeadText,
  headTextKey,
};
