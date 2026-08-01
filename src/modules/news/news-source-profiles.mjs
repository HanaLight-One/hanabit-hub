const ROLE_LABELS = Object.freeze({
  "official-publisher": "회사 공식 발표 채널",
  "developer-publisher": "개발자 공식 발표 채널",
  "chief-executive": "CEO",
  "president-cofounder": "사장·공동 창립자",
  "engineering-leadership": "엔지니어링 리더십",
  "codex-product": "Codex 제품",
  "developer-relations": "개발자 관계",
});

const TOPIC_LABELS = Object.freeze({
  api: "API",
  chatgpt: "ChatGPT",
  codex: "Codex",
  company: "회사",
  "developer-platform": "개발자 플랫폼",
  engineering: "엔지니어링",
  models: "모델",
  products: "제품",
  research: "연구",
  usage: "사용량",
});

const TRUST_LABELS = Object.freeze({
  official: "공식 출처",
  high: "핵심 인물",
  standard: "참고 인물",
  candidate: "관찰 후보",
});

function whyTracked(source) {
  if (source.sourceKind === "official") {
    return "OpenAI가 직접 운영하는 공식 발표 출처라서 제품·모델 변화를 우선 확인해요.";
  }
  if (source.roles.includes("president-cofounder")) {
    return "OpenAI의 경영·기술 방향을 직접 언급할 수 있는 핵심 인물이라서 주목해요.";
  }
  if (source.roles.includes("chief-executive")) {
    return "OpenAI의 회사·모델·제품 방향을 직접 언급할 수 있는 핵심 인물이라서 주목해요.";
  }
  if (source.roles.includes("codex-product")) {
    return "Codex와 ChatGPT 제품 변화에 가까운 발언을 살펴보기 위해 추적해요.";
  }
  if (source.roles.includes("developer-relations")) {
    return "API와 개발자 플랫폼 변화를 설명하는 발언을 살펴보기 위해 추적해요.";
  }
  return "OpenAI의 기술·제품 방향과 관련된 발언을 살펴보기 위해 추적해요.";
}

function publicProfile(source) {
  return Object.freeze({
    displayName: source.displayName,
    handle: source.handle,
    affiliation: source.affiliation,
    affiliationConfirmed: source.affiliationStatus === "confirmed",
    roles: Object.freeze(source.roles.map((role) => ROLE_LABELS[role] ?? role)),
    topics: Object.freeze(source.topics.map((topic) => TOPIC_LABELS[topic] ?? topic)),
    trustLabel: TRUST_LABELS[source.trustLevel] ?? "확인 필요",
    verifiedAt: source.verifiedAt,
    whyTracked: whyTracked(source),
  });
}

export function createNewsSourceProfileIndex(roster) {
  if (!roster || !Array.isArray(roster.sources)) {
    throw new TypeError("뉴스 출처 프로필 명부가 올바르지 않습니다.");
  }
  return new Map(roster.sources.map((source) => [source.handle.toLowerCase(), publicProfile(source)]));
}

export function findNewsSourceProfile(source, profiles) {
  if (source?.type === "discord-announcement") {
    return Object.freeze({
      displayName: "OpenAI Announcements",
      handle: null,
      affiliation: "OpenAI",
      affiliationConfirmed: true,
      roles: Object.freeze(["회사 공식 발표 채널"]),
      topics: Object.freeze(["회사", "모델", "제품", "연구"]),
      trustLabel: "공식 출처",
      verifiedAt: null,
      whyTracked: "OpenAI 공식 Discord에서 전달된 발표라서 가장 먼저 확인해요.",
    });
  }
  const handle = String(source?.account ?? "").toLowerCase();
  return handle && profiles instanceof Map ? profiles.get(handle) ?? null : null;
}
