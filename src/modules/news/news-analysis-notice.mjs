const MODEL_LABELS = Object.freeze({
  "gpt-5.6-terra": "GPT-5.6 Terra",
});

export function createNewsAnalysisNotice({
  codexReviewed = false,
  model = "gpt-5.6-terra",
} = {}) {
  const modelLabel = MODEL_LABELS[model] ?? (/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(model) ? model : "AI 모델");
  return codexReviewed
    ? `주의: 이 글의 해설은 ${modelLabel}의 1차 분석과 Codex 심층 검토 모델을 거쳐 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다.`
    : `주의: 이 글의 해설은 ${modelLabel}가 원문과 관련 문맥을 바탕으로 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다.`;
}
