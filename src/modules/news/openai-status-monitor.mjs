import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPendingNewsStore } from "./news-item-store.mjs";

export const OPENAI_STATUS_URL = "https://status.openai.com/";
export const OPENAI_STATUS_SUMMARY_URL = "https://status.openai.com/api/v2/summary.json";
export const OPENAI_STATUS_INTERVAL_MS = 20_000;

const PHASE_TITLES = Object.freeze({
  outage: "OpenAI service incident detected",
  expanded: "OpenAI service incident expanded",
  updated: "OpenAI service incident update",
  "partial-recovery": "OpenAI service incident partially recovered",
  recovered: "OpenAI service incident resolved",
});
const COMPONENT_STATUSES = new Set([
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
  "under_maintenance",
]);
const DEGRADED_COMPONENT_STATUSES = new Set([
  "degraded_performance",
  "partial_outage",
  "major_outage",
]);

function cleanText(value, maximum = 2_000) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function safeTime(value) {
  const text = String(value ?? "");
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function normalizeIncident(value) {
  const updates = Array.isArray(value?.incident_updates)
    ? value.incident_updates.map((entry) => ({
        id: cleanText(entry?.id, 64),
        status: cleanText(entry?.status, 40),
        body: cleanText(entry?.body),
        createdAt: safeTime(entry?.created_at),
      })).filter((entry) => entry.id && entry.createdAt)
    : [];
  updates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    id: cleanText(value?.id, 64),
    name: cleanText(value?.name, 300),
    status: cleanText(value?.status, 40),
    impact: cleanText(value?.impact, 40),
    createdAt: safeTime(value?.created_at),
    updatedAt: safeTime(value?.updated_at),
    latestUpdate: updates[0] ?? null,
  };
}

function normalizeComponent(value) {
  return {
    id: cleanText(value?.id, 64),
    name: cleanText(value?.name, 160),
    status: cleanText(value?.status, 40),
    updatedAt: safeTime(value?.updated_at),
  };
}

export function normalizeOpenAIStatusSummary(value) {
  if (!value || !Array.isArray(value.incidents) || !Array.isArray(value.components)) {
    throw new TypeError("OpenAI 상태 응답에 장애 또는 구성요소 목록이 없습니다.");
  }
  const incidents = value.incidents.map(normalizeIncident).filter((entry) => (
    entry.id && entry.name && entry.status && entry.createdAt && entry.updatedAt
  ));
  incidents.sort((left, right) => left.id.localeCompare(right.id));
  if (incidents.length !== value.incidents.length || incidents.length > 20) {
    throw new TypeError("OpenAI 상태 응답의 장애 항목이 올바르지 않습니다.");
  }
  const components = value.components.map(normalizeComponent);
  if (
    components.length > 200 ||
    components.some((entry) => !entry.id || !entry.name || !entry.updatedAt || !COMPONENT_STATUSES.has(entry.status))
  ) {
    throw new TypeError("OpenAI 상태 응답의 구성요소 항목이 올바르지 않습니다.");
  }
  const degradedComponents = components
    .filter((entry) => DEGRADED_COMPONENT_STATUSES.has(entry.status))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { incidents, degradedComponents };
}

function snapshotHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

function activeCount(snapshot) {
  return snapshot.incidents.length + snapshot.degradedComponents.length;
}

function phaseFor(previous, current, currentPost) {
  if (!activeCount(current)) return activeCount(previous) && currentPost ? "recovered" : null;
  if (!activeCount(previous)) return "outage";
  const previousIncidentIds = new Set(previous.incidents.map((entry) => entry.id));
  const currentIncidentIds = new Set(current.incidents.map((entry) => entry.id));
  const previousComponentIds = new Set(previous.degradedComponents.map((entry) => entry.id));
  const currentComponentIds = new Set(current.degradedComponents.map((entry) => entry.id));
  if (
    current.incidents.some((entry) => !previousIncidentIds.has(entry.id)) ||
    current.degradedComponents.some((entry) => !previousComponentIds.has(entry.id))
  ) return "expanded";
  if (
    previous.incidents.some((entry) => !currentIncidentIds.has(entry.id)) ||
    previous.degradedComponents.some((entry) => !currentComponentIds.has(entry.id))
  ) return "partial-recovery";
  return "updated";
}

function originalBody(phase, { incidents, degradedComponents }) {
  if (phase === "recovered") {
    return "OpenAI Status reports no active incidents or degraded components. The previously monitored service disruption has recovered.";
  }
  const lines = [
    `OpenAI Status update. Active incidents: ${incidents.length}.`,
    `Degraded components: ${degradedComponents.length}.`,
    `Update phase: ${phase}.`,
  ];
  incidents.forEach((incident, index) => {
    lines.push(
      `${index + 1}. ${incident.name}`,
      `Status: ${incident.status}. Impact: ${incident.impact || "unknown"}.`,
      `Latest official update: ${incident.latestUpdate?.body || "No update text supplied."}`,
    );
  });
  if (degradedComponents.length) {
    lines.push("Affected service components:");
    degradedComponents.forEach((component, index) => {
      lines.push(`${index + 1}. ${component.name}: ${component.status}.`);
    });
  }
  return lines.join("\n");
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function createOpenAIStatusMonitor({
  stateRoot,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  if (!path.isAbsolute(stateRoot ?? "")) {
    throw new TypeError("OpenAI 상태 감시 루트는 절대경로여야 합니다.");
  }
  const statePath = path.join(stateRoot, "openai-status-monitor.json");
  const store = createPendingNewsStore({ root: stateRoot });

  async function readState() {
    try {
      const value = JSON.parse(await readFile(statePath, "utf8"));
      if (
        ![1, 2].includes(value?.schemaVersion) ||
        !Array.isArray(value.activeIncidents) ||
        (value.schemaVersion === 2 && !Array.isArray(value.degradedComponents))
      ) {
        throw new TypeError("OpenAI 상태 감시 영수증이 올바르지 않습니다.");
      }
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function saveState(value) {
    await mkdir(stateRoot, { recursive: true });
    await writeJsonAtomic(statePath, value);
  }

  async function fetchSnapshot() {
    const response = await fetchImpl(OPENAI_STATUS_SUMMARY_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response?.ok) throw new Error(`OpenAI 상태 확인 실패 (${response?.status ?? "unknown"})`);
    return normalizeOpenAIStatusSummary(await response.json());
  }

  async function poll() {
    const checkedAt = now().toISOString();
    const snapshot = await fetchSnapshot();
    const { incidents, degradedComponents } = snapshot;
    const hash = snapshotHash(snapshot);
    const state = await readState();
    if (!state) {
      await saveState({
        schemaVersion: 2,
        initializedAt: checkedAt,
        lastCheckedAt: checkedAt,
        lastSnapshotHash: hash,
        activeIncidents: incidents,
        degradedComponents,
        currentPost: null,
        pendingSnapshot: null,
        history: [],
      });
      return {
        status: "baselined",
        activeCount: activeCount(snapshot),
        incidentCount: incidents.length,
        componentCount: degradedComponents.length,
      };
    }
    if (state.schemaVersion === 1) {
      await saveState({
        ...state,
        schemaVersion: 2,
        lastCheckedAt: checkedAt,
        lastSnapshotHash: hash,
        activeIncidents: incidents,
        degradedComponents,
        pendingSnapshot: null,
      });
      return {
        status: "components-baselined",
        activeCount: activeCount(snapshot),
        incidentCount: incidents.length,
        componentCount: degradedComponents.length,
      };
    }
    if (state.lastSnapshotHash === hash) {
      await saveState({ ...state, lastCheckedAt: checkedAt });
      return {
        status: "unchanged",
        activeCount: activeCount(snapshot),
        incidentCount: incidents.length,
        componentCount: degradedComponents.length,
      };
    }
    const previousSnapshot = {
      incidents: state.activeIncidents,
      degradedComponents: state.degradedComponents,
    };
    const phase = phaseFor(previousSnapshot, snapshot, state.currentPost);
    if (!phase) {
      await saveState({
        ...state,
        lastCheckedAt: checkedAt,
        lastSnapshotHash: hash,
        activeIncidents: incidents,
        degradedComponents,
        pendingSnapshot: null,
      });
      return {
        status: "observed",
        activeCount: activeCount(snapshot),
        incidentCount: incidents.length,
        componentCount: degradedComponents.length,
      };
    }
    const id = createHash("sha256").update(`openai-status\0${hash}`, "utf8").digest("hex").slice(0, 32);
    const publishedAt = incidents.reduce(
      (latest, incident) => incident.updatedAt > latest ? incident.updatedAt : latest,
      checkedAt,
    );
    const result = await store.create({
      id,
      source: {
        type: "openai-status-snapshot",
        provider: "openai-status",
        sourceId: "openai-status",
        externalId: hash,
        url: OPENAI_STATUS_URL,
        publishedAt,
        phase,
        incidentIds: incidents.map((entry) => entry.id),
        componentIds: degradedComponents.map((entry) => entry.id),
      },
      original: {
        title: PHASE_TITLES[phase],
        content: originalBody(phase, snapshot),
      },
      context: [],
      collectedAt: checkedAt,
      workflow: { status: "pending_translation" },
      internal: {
        openAIStatus: {
          schemaVersion: 2,
          phase,
          snapshotHash: hash,
          incidents,
          degradedComponents,
        },
      },
    });
    await saveState({
      ...state,
      lastCheckedAt: checkedAt,
      lastSnapshotHash: hash,
      activeIncidents: incidents,
      degradedComponents,
      pendingSnapshot: { id, phase, snapshotHash: hash, createdAt: checkedAt },
    });
    return {
      status: result.created ? "created" : "existing",
      id,
      phase,
      snapshotHash: hash,
      activeCount: activeCount(snapshot),
      incidentCount: incidents.length,
      componentCount: degradedComponents.length,
    };
  }

  async function confirmPublished(snapshotHashValue, publication) {
    if (!/^[a-f0-9]{64}$/u.test(String(snapshotHashValue ?? "")) ||
        !/^\d{4,}$/u.test(String(publication?.postId ?? ""))) {
      throw new TypeError("상태 게시 영수증이 올바르지 않습니다.");
    }
    const state = await readState();
    if (!state || state.pendingSnapshot?.snapshotHash !== snapshotHashValue) {
      throw new Error("현재 상태 스냅샷과 게시 영수증이 일치하지 않습니다.");
    }
    const previousPost = state.currentPost ?? null;
    const currentPost = {
      postId: String(publication.postId),
      url: String(publication.url ?? ""),
      snapshotHash: snapshotHashValue,
      publishedAt: now().toISOString(),
      ownership: "automatic",
    };
    await saveState({
      ...state,
      currentPost,
      pendingSnapshot: null,
      pendingReplacement: ["automatic", "adopted-replaceable"].includes(previousPost?.ownership)
        ? previousPost
        : null,
      history: [...state.history.slice(-99), { event: "posted", ...currentPost }],
    });
    return { currentPost, previousPost };
  }

  async function adoptProtectedPost(publication) {
    const postId = String(publication?.postId ?? "");
    const url = String(publication?.url ?? "");
    if (!/^\d{4,}$/u.test(postId) || url !== `https://m.dcinside.com/board/chatgpt/${postId}`) {
      throw new TypeError("보호할 수동 상태 글 주소가 올바르지 않습니다.");
    }
    const state = await readState();
    if (!state || !(state.activeIncidents.length + (state.degradedComponents?.length ?? 0))) {
      throw new Error("진행 중인 OpenAI 장애 기준선이 없습니다.");
    }
    if (state.currentPost) return { status: "already-adopted", currentPost: state.currentPost };
    const currentPost = {
      postId,
      url,
      snapshotHash: state.lastSnapshotHash,
      publishedAt: now().toISOString(),
      ownership: "manual-protected",
    };
    await saveState({
      ...state,
      currentPost,
      history: [...state.history.slice(-99), { event: "adopted", ...currentPost }],
    });
    return { status: "adopted", currentPost };
  }

  async function authorizeAdoptedPostReplacement(postIdValue) {
    const postId = String(postIdValue ?? "");
    if (!/^\d{4,}$/u.test(postId)) {
      throw new TypeError("교체를 허용할 상태 글 번호가 올바르지 않습니다.");
    }
    const state = await readState();
    if (!state || state.currentPost?.postId !== postId) {
      throw new Error("현재 상태 글 영수증과 교체 허용 글 번호가 일치하지 않습니다.");
    }
    if (state.currentPost.ownership === "adopted-replaceable") {
      return { status: "already-authorized", currentPost: state.currentPost };
    }
    if (state.currentPost.ownership !== "manual-protected") {
      throw new Error("보호된 수동 상태 글만 교체 대상으로 전환할 수 있습니다.");
    }
    const currentPost = { ...state.currentPost, ownership: "adopted-replaceable" };
    await saveState({
      ...state,
      currentPost,
      history: [...state.history.slice(-99), {
        event: "replacement-authorized",
        postId,
        authorizedAt: now().toISOString(),
      }],
    });
    return { status: "authorized", currentPost };
  }

  async function recordReplacement(previousPost, result) {
    const state = await readState();
    if (!state) throw new Error("OpenAI 상태 감시 영수증이 없습니다.");
    await saveState({
      ...state,
      pendingReplacement: null,
      history: [...state.history.slice(-99), {
        event: "replacement",
        previousPostId: String(previousPost?.postId ?? ""),
        status: String(result?.status ?? "ambiguous-no-retry"),
        recordedAt: now().toISOString(),
      }],
    });
  }

  return Object.freeze({
    poll,
    readState,
    confirmPublished,
    adoptProtectedPost,
    authorizeAdoptedPostReplacement,
    recordReplacement,
  });
}
