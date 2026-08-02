export function createNewsAnalysisNotice({ codexReviewed = false } = {}) {
  return codexReviewed
    ? "주의: 아래 해설은 GPT-5.4 mini의 1차 분석과 Codex 심층 검토 모델을 거쳐 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다."
    : "주의: 아래 해설은 GPT-5.4 mini가 원문과 관련 문맥을 바탕으로 정리한 내용입니다. 원문 번역이 아니며, 최종 판단은 독자에게 있습니다.";
}
