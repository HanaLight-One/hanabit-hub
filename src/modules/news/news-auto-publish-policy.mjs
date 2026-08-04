const GOOD_IMPORTANCE = new Set(["medium", "high"]);
const TRUSTED_SOURCES = new Set(["official", "high", "standard"]);
export const NEWS_ANALYSIS_POLICY_VERSION = 16;

function result(decision, code, reason) {
  return Object.freeze({ decision, code, reason });
}

export function evaluateNewsAutoPublish(record, sourceProfile = null) {
  const workflow = record?.workflow ?? {};
  const triage = workflow.triage ?? {};
  if (workflow.dcPublication || workflow.dcApproval?.status === "approved") {
    return result("blocked", "already_handled", "이미 승인 또는 게시 영수증이 있어 자동 처리하지 않아요.");
  }
  if (workflow.status !== "pending_review" || triage.decision === "skip") {
    return result("blocked", "not_publishable", "현재 게시 후보 상태가 아니에요.");
  }
  if (triage.decision !== "publish") {
    return result("human_review", "editorial_review", "게시 가치가 검토 단계라 사람 판단이 필요해요.");
  }
  if (!triage.evidenceTag) {
    return result("human_review", "legacy_analysis", "새 정보 성격 태그로 다시 판정해야 해요.");
  }
  const translationReviewStatus = workflow.translationReview?.status;
  if (!["local_verified", "codex_verified", "codex_corrected", "human_verified"].includes(translationReviewStatus)) {
    return result("human_review", "translation_unverified", "원문 전용 번역의 귀속 검증이 끝나지 않아 자동 게시하지 않아요.");
  }
  if (!String(workflow.analysisNotice ?? "").includes("원문 번역이 아니며")) {
    return result("human_review", "analysis_notice_missing", "AI 해설 주의 문구가 없어 자동 게시하지 않아요.");
  }
  if (triage.evidenceTag === "official") {
    return result("eligible", "official", "공식 출처의 게시 후보라 자동 게시 조건을 충족해요.");
  }
  if (triage.boardCategory === "chatter" || triage.importance === "low") {
    return result("blocked", "low_value", "잡담 또는 낮은 중요도 항목이라 허브에만 보관해요.");
  }
  const trusted = TRUSTED_SOURCES.has(sourceProfile?.trustLevel) && sourceProfile?.affiliationConfirmed === true;
  const confidence = Number(triage.confidence) || 0;
  if (
    triage.evidenceTag === "confirmed" &&
    trusted &&
    GOOD_IMPORTANCE.has(triage.importance) &&
    confidence >= 0.8
  ) {
    return result("eligible", "confirmed", "신뢰 출처의 확인된 정보라 자동 게시 조건을 충족해요.");
  }
  if (
    triage.evidenceTag === "use_case" &&
    trusted &&
    triage.importance === "high" &&
    confidence >= 0.85
  ) {
    return result("eligible", "trusted_use_case", "신뢰 출처가 소개한 중요하고 구체적인 활용 사례라 [사례] 표현으로 자동 게시할 수 있어요.");
  }
  if (triage.evidenceTag === "use_case") {
    return result("blocked", "routine_use_case", "새 기능 경계가 뚜렷하지 않은 일반 활용 사례라 허브에만 보관해요.");
  }
  if (
    triage.evidenceTag === "inference" &&
    sourceProfile?.trustLevel === "high" &&
    sourceProfile?.affiliationConfirmed === true &&
    GOOD_IMPORTANCE.has(triage.importance) &&
    confidence >= 0.82
  ) {
    if (translationReviewStatus === "local_verified") {
      return result("human_review", "inference_deep_review", "[유추]는 Codex 심층검토가 끝나야 자동 게시 후보가 될 수 있어요.");
    }
    return result("eligible", "trusted_inference", "핵심 인물의 구체적인 초기 신호라 [유추] 표현으로 자동 게시할 수 있어요.");
  }
  if (
    ["rumor", "opinion"].includes(triage.evidenceTag) &&
    trusted &&
    triage.importance === "high" &&
    confidence >= 0.75
  ) {
    return result(
      "eligible",
      triage.evidenceTag === "rumor" ? "valuable_rumor" : "notable_opinion",
      `[${triage.evidenceTag === "rumor" ? "루머" : "의견"}]이지만 신뢰 출처가 전한 높은 중요도의 게시 후보예요.`,
    );
  }
  if (["rumor", "opinion"].includes(triage.evidenceTag)) {
    return result("blocked", triage.evidenceTag, "가치 기준을 통과하지 못한 루머·의견이라 허브에만 보관해요.");
  }
  return result("human_review", "insufficient_confidence", "출처·중요도·신뢰도 중 자동 게시 기준을 충족하지 못했어요.");
}
