import { createHash } from "node:crypto";

const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const BURST_WINDOW_MS = 15 * 60 * 1000;
const USE_CASE_WINDOW_MS = 4 * 60 * 60 * 1000;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "chatgpt", "for", "from", "has", "have",
  "into", "more", "openai", "that", "the", "their", "this", "using", "with", "your",
  "관련", "대한", "그리고", "사용", "통해", "한다", "하는", "했다", "합니다",
]);

const EVIDENCE_SCORES = Object.freeze({
  official: 60,
  confirmed: 48,
  use_case: 24,
  inference: 30,
  rumor: 12,
  opinion: 6,
});

function timestamp(item) {
  const value = Date.parse(item?.source?.publishedAt ?? item?.collectedAt ?? "");
  return Number.isFinite(value) ? value : 0;
}

function activityTimestamp(item) {
  const value = Date.parse(item?.workflow?.processedAt ?? item?.collectedAt ?? item?.source?.publishedAt ?? "");
  return Number.isFinite(value) ? value : timestamp(item);
}

function publicationTimestamp(item) {
  const value = Date.parse(item?.workflow?.dcPublication?.submittedAt ?? "");
  return Number.isFinite(value) ? value : null;
}

function tokenSet(item) {
  const text = [
    item?.workflow?.translation?.title,
    item?.workflow?.translation?.body,
    ...(item?.workflow?.contextTranslations ?? []).map((entry) => entry?.body),
  ].filter(Boolean).join(" ").normalize("NFKC").toLowerCase().replace(/https?:\/\/\S+/gu, " ");
  return new Set((text.match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((token) => !STOP_WORDS.has(token)));
}

function canonicalLink(value) {
  try {
    const url = new URL(String(value ?? ""));
    const status = url.pathname.match(/\/status\/(\d+)/u)?.[1];
    if (["x.com", "twitter.com"].includes(url.hostname.toLowerCase()) && status) return `x:${status}`;
    const pathname = url.pathname.replace(/\/+$/u, "");
    return pathname && pathname !== "/" ? `${url.hostname.toLowerCase()}${pathname}` : null;
  } catch {
    return null;
  }
}

function linkSet(item) {
  return new Set([
    item?.source?.url,
    ...(item?.original?.links ?? []),
    ...(item?.original?.contexts ?? []).map((context) => context?.url),
  ].map(canonicalLink).filter(Boolean));
}

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function sameStory(left, right) {
  if (Math.abs(timestamp(left.item) - timestamp(right.item)) > STORY_WINDOW_MS) return false;
  if (intersects(left.links, right.links)) return true;
  const shared = [...left.tokens].filter((token) => right.tokens.has(token)).length;
  if (shared < 3) return false;
  const smaller = Math.min(left.tokens.size, right.tokens.size);
  const union = new Set([...left.tokens, ...right.tokens]).size;
  return smaller > 0 && shared / smaller >= 0.6 && union > 0 && shared / union >= 0.35;
}

function editorialScore(item) {
  const triage = item?.workflow?.triage ?? {};
  const importance = triage.importance === "high" ? 20 : triage.importance === "medium" ? 10 : 0;
  const confidence = Math.round((Number(triage.confidence) || 0) * 10);
  const review = item?.workflow?.codexReview?.status === "complete" ? 8 : 0;
  const trust = item?.source?.profile?.trustLevel === "official"
    ? 10
    : item?.source?.profile?.trustLevel === "high"
      ? 5
      : 0;
  return (EVIDENCE_SCORES[triage.evidenceTag] ?? 0) + importance + confidence + review + trust;
}

function bypassesBurstLimit(item) {
  const triage = item?.workflow?.triage ?? {};
  return triage.evidenceTag === "official" ||
    (triage.evidenceTag === "confirmed" && triage.importance === "high");
}

function result(decision, code, reason, extra = {}) {
  return Object.freeze({ decision, code, reason, ...extra });
}

export function applyNewsEditorialShadow(items) {
  const nodes = items.map((item, index) => ({
    item,
    index,
    tokens: tokenSet(item),
    links: linkSet(item),
    score: editorialScore(item),
  }));
  const parent = nodes.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (sameStory(nodes[left], nodes[right])) join(left, right);
    }
  }

  const groups = new Map();
  nodes.forEach((node, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  });

  const representativeByIndex = new Map();
  for (const group of groups.values()) {
    const representative = [...group].sort((left, right) =>
      right.score - left.score || timestamp(left.item) - timestamp(right.item),
    )[0];
    const storyId = createHash("sha256")
      .update(group.map((node) => node.item.id).sort().join("\0"), "utf8")
      .digest("hex")
      .slice(0, 12);
    for (const node of group) representativeByIndex.set(node.index, { representative, storyId, size: group.length });
  }

  const burstById = new Map();
  const accepted = [];
  const publishedUseCases = nodes.filter((node) =>
    node.item?.workflow?.triage?.evidenceTag === "use_case" &&
    node.item?.workflow?.dcPublication?.status === "posted" &&
    publicationTimestamp(node.item) !== null,
  );
  const publishableRepresentatives = nodes
    .filter((node) => {
      const cluster = representativeByIndex.get(node.index);
      const gate = node.item?.workflow?.autoPublishGate;
      return cluster.representative.index === node.index &&
        gate?.decision === "eligible" &&
        !(node.item.workflow.triage?.evidenceTag === "inference" && node.item.workflow.codexReview?.status !== "complete");
    })
    .sort((left, right) => right.score - left.score || timestamp(left.item) - timestamp(right.item));
  for (const node of publishableRepresentatives) {
    if (node.item?.workflow?.triage?.evidenceTag === "use_case") {
      const currentTime = activityTimestamp(node.item);
      const priorUseCase = publishedUseCases.some((candidate) => {
        const publishedAt = publicationTimestamp(candidate.item);
        return publishedAt <= currentTime && currentTime - publishedAt < USE_CASE_WINDOW_MS;
      }) || accepted.some((candidate) =>
        candidate.item?.workflow?.triage?.evidenceTag === "use_case" &&
        Math.abs(activityTimestamp(candidate.item) - currentTime) < USE_CASE_WINDOW_MS,
      );
      if (priorUseCase) {
        burstById.set(node.item.id, result(
          "hold",
          "use_case_cooldown",
          "최근 사례 게시 후 4시간이 지나지 않아 허브에 보관해요.",
        ));
        continue;
      }
    }
    const competing = accepted.find((candidate) =>
      Math.abs(timestamp(candidate.item) - timestamp(node.item)) <= BURST_WINDOW_MS,
    );
    if (competing && !bypassesBurstLimit(node.item)) {
      burstById.set(node.item.id, result("hold", "burst_queue", "더 강한 독립 뉴스와 가까운 시각에 감지되어 자동 대기해요."));
    } else {
      accepted.push(node);
      burstById.set(node.item.id, result(
        "ready",
        bypassesBurstLimit(node.item) ? "priority_pass" : "quality_pass",
        bypassesBurstLimit(node.item)
          ? "서로 다른 공식·확정 속보라 연속 게시 제한 없이 자동 게시해요."
          : "중복·출처·번역·판정 관문을 통과한 자동 게시 후보예요.",
      ));
    }
  }

  return items.map((item, index) => {
    const cluster = representativeByIndex.get(index);
    if (cluster.size > 1 && cluster.representative.index !== index) {
      return {
        ...item,
        workflow: {
          ...item.workflow,
          editorialShadow: result("merge", "same_story", "같은 사건의 더 강한 원고에 출처로 합쳐요.", {
            storyId: cluster.storyId,
            storySize: cluster.size,
            representativeId: cluster.representative.item.id,
          }),
        },
      };
    }

    const gate = item?.workflow?.autoPublishGate;
    let shadow;
    if (gate?.decision === "eligible") {
      if (item.workflow.triage?.evidenceTag === "inference" && item.workflow.codexReview?.status !== "complete") {
        shadow = result("hold", "inference_review", "[유추]는 Codex 심층검토가 끝날 때까지 허브에 보관해요.");
      } else {
        shadow = burstById.get(item.id);
      }
    } else if (gate?.decision === "human_review") {
      shadow = result("hold", gate.code || "quality_review", "자동 게시 품질 기준이 부족해 허브에 보관해요.");
    } else {
      shadow = result("hub_only", gate?.code || "not_publishable", "자동 게시 대상이 아니어서 허브 기록으로만 남겨요.");
    }
    return {
      ...item,
      workflow: {
        ...item.workflow,
        editorialShadow: { ...shadow, storyId: cluster.storyId, storySize: cluster.size },
      },
    };
  });
}
