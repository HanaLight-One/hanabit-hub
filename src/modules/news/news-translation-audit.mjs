const URL_PATTERN = /(?:https?:\/\/|(?:pic\.)?twitter\.com\/)[^\s]+/giu;
const LATIN_OR_NUMBER_PATTERN = /[a-z][a-z0-9._+-]{1,}|\d+(?:\.\d+)+|\d{2,}/giu;
const UNEXPECTED_SCRIPT_PATTERN = /[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Thai}]/u;
export const NEWS_TRANSLATION_AUDIT_REVIEWER = "local-source-boundary-v3";

function sourceIdentity(record) {
  if (
    record?.source?.type === "official-changelog" &&
    record?.source?.provider === "openai-docs"
  ) {
    return "OpenAI API";
  }
  return "";
}

function isEnglishDominant(value) {
  const text = clean(value);
  const koreanCount = (text.match(/[가-힣]/gu) ?? []).length;
  const latinCount = (text.match(/[a-z]/giu) ?? []).length;
  return latinCount >= 24 && latinCount > koreanCount * 2;
}

function clean(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(URL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sourceText(record) {
  const embeds = (Array.isArray(record?.original?.embeds) ? record.original.embeds : [])
    .flatMap((embed) => [
      embed?.title,
      embed?.description,
      ...(Array.isArray(embed?.fields)
        ? embed.fields.flatMap((field) => [field?.name, field?.value])
        : []),
    ]);
  return clean([record?.original?.content, ...embeds].filter(Boolean).join("\n"));
}

function invariants(value) {
  return new Set((clean(value).match(LATIN_OR_NUMBER_PATTERN) ?? [])
    .map((token) => token.toLowerCase().replace(/[._+-]+$/gu, ""))
    .filter(Boolean));
}

function sourceInvariantAliases(value) {
  const allowed = invariants(value);
  for (const token of [...allowed]) {
    if (/^[a-z][a-z0-9._+-]*ies$/u.test(token) && token.length > 4) {
      allowed.add(`${token.slice(0, -3)}y`);
    } else if (/^[a-z][a-z0-9._+-]*(?:sses|shes|ches|xes|zes)$/u.test(token)) {
      allowed.add(token.slice(0, -2));
    } else if (/^[a-z][a-z0-9._+-]*s$/u.test(token) && token.length > 4 && !token.endsWith("ss")) {
      allowed.add(token.slice(0, -1));
    }
  }
  return allowed;
}

function unexpectedInvariant(source, translated) {
  const allowed = sourceInvariantAliases(source);
  return [...invariants(translated)].find((token) => !allowed.has(token)) ?? null;
}

function hasUrl(value) {
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(String(value ?? ""));
}

function result(status, code, reason) {
  return Object.freeze({ status, code, reason });
}

export function auditFreeNewsTranslation(record, translationResult = record?.workflow) {
  const original = sourceText(record);
  const title = clean(translationResult?.translation?.title);
  const body = clean(translationResult?.translation?.body);
  const readerSummary = clean(translationResult?.readerSummary);
  const contexts = (Array.isArray(record?.original?.contexts) ? record.original.contexts : []).slice(0, 3);
  const contextTranslations = Array.isArray(translationResult?.contextTranslations)
    ? translationResult.contextTranslations
    : [];

  if (!original || !title || !body) {
    return result("failed", "missing_text", "원문 또는 원문 전용 번역이 비어 있어 자동 검증하지 않아요.");
  }
  if (hasUrl(translationResult?.translation?.title) || hasUrl(translationResult?.translation?.body)) {
    return result("failed", "source_link_leak", "원문 전용 번역에 링크가 남아 있어 자동 검증하지 않아요.");
  }
  if (!/[가-힣]/u.test(body)) {
    return result("failed", "body_korean_missing", "본문에서 한국어 번역을 확인할 수 없어 자동 검증하지 않아요.");
  }
  if (isEnglishDominant(body)) {
    return result("failed", "body_english_dominant", "본문 대부분이 영문이라 한국어 번역으로 자동 검증하지 않아요.");
  }
  if (UNEXPECTED_SCRIPT_PATTERN.test(`${title} ${body}`) && !UNEXPECTED_SCRIPT_PATTERN.test(original)) {
    return result("failed", "unexpected_script", "원문에 없는 문자 체계가 번역에 섞여 자동 검증하지 않아요.");
  }
  if (contextTranslations.length !== contexts.length) {
    return result("failed", "context_count", "관련 글과 관련 글 번역의 개수가 달라 자동 검증하지 않아요.");
  }

  const translatedBody = body.toLowerCase();
  const seen = new Set();
  for (const [offset, context] of contexts.entries()) {
    const entry = contextTranslations[offset];
    const expectedIndex = offset + 1;
    if (Number(entry?.index) !== expectedIndex || seen.has(expectedIndex)) {
      return result("failed", "context_order", "관련 글 번역의 순서가 달라 자동 검증하지 않아요.");
    }
    seen.add(expectedIndex);
    const translatedContext = clean(entry?.body);
    if (!translatedContext || hasUrl(entry?.body)) {
      return result("failed", "context_text", "관련 글 번역이 비었거나 링크를 포함해 자동 검증하지 않아요.");
    }
    const contextExtra = unexpectedInvariant(context?.content, translatedContext);
    if (contextExtra) {
      return result("failed", "context_invariant_added", "관련 글 원문에 없는 영문명 또는 수치가 번역에 추가되어 자동 검증하지 않아요.");
    }
    if (translatedContext.length >= 12 && translatedBody.includes(translatedContext.toLowerCase())) {
      return result("failed", "context_mixed_into_source", "관련 글 번역이 원문 전용 번역에 섞여 자동 검증하지 않아요.");
    }
  }

  const bodyExtra = unexpectedInvariant(original, body);
  if (bodyExtra) {
    return result("failed", "source_invariant_added", "원문에 없는 영문명 또는 수치가 번역에 추가되어 자동 검증하지 않아요.");
  }
  const evidencePackage = [
    original,
    sourceIdentity(record),
    record?.source?.account,
    record?.source?.label,
    ...contexts.map((context) => context?.content),
  ].filter(Boolean).join("\n");
  if (readerSummary) {
    if (hasUrl(translationResult?.readerSummary)) {
      return result("failed", "reader_summary_link_leak", "독자 요약에 링크가 포함되어 자동 검증하지 않아요.");
    }
    if (!/[가-힣]/u.test(readerSummary)) {
      return result("failed", "reader_summary_korean_missing", "독자 요약에서 한국어를 확인할 수 없어 자동 검증하지 않아요.");
    }
    if (UNEXPECTED_SCRIPT_PATTERN.test(readerSummary) && !UNEXPECTED_SCRIPT_PATTERN.test(evidencePackage)) {
      return result("failed", "reader_summary_unexpected_script", "원문에 없는 문자 체계가 독자 요약에 섞여 자동 검증하지 않아요.");
    }
    if (unexpectedInvariant(evidencePackage, readerSummary)) {
      return result("failed", "reader_summary_invariant_added", "원문과 관련 글에 없는 영문명 또는 수치가 독자 요약에 추가되어 자동 검증하지 않아요.");
    }
  }
  const titleExtra = unexpectedInvariant(evidencePackage, title);
  if (titleExtra) {
    return result("failed", "title_invariant_added", "원문과 관련 글에 없는 영문명 또는 수치가 제목에 추가되어 자동 검증하지 않아요.");
  }

  return result("passed", "local_source_boundary", "원문·관련 글 분리와 링크·식별자 보존 규칙을 로컬에서 통과했어요.");
}
