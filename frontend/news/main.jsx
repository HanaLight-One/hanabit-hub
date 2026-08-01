import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const STATUS_LABELS = {
  pending_translation: "번역 대기",
  pending_triage: "판정 대기",
  pending_review: "게시 검토",
  approved_for_dc: "DC 게시 승인",
  ignored: "보류 · 게시하지 않음",
  translation_failed: "번역 확인 필요",
  published: "게시 완료",
};

const DECISION_LABELS = {
  publish: "바로 게시 후보",
  review: "검토 후보",
  skip: "보류",
};

const IMPORTANCE_LABELS = { low: "낮음", medium: "중간", high: "높음" };
const FAILURE_LABELS = {
  timeout: "응답 시간이 초과됐어요.",
  invalid_response: "응답 형식이 깨져 번역을 저장하지 못했어요.",
  provider_error: "무료 텍스트 API 요청이 완료되지 않았어요.",
  unknown: "분석 도중 안전하게 복구하지 못한 오류가 있었어요.",
};

function needsImageReview(item) {
  return item.workflow.status === "ignored" && item.media.length > 0;
}

const FILTERS = [
  { id: "action", label: "확인 필요", matches: (item) => ["pending_review", "translation_failed"].includes(item.workflow.status) || needsImageReview(item) },
  { id: "publish", label: "게시 후보", matches: (item) => item.workflow.triage?.decision === "publish" },
  { id: "review", label: "사람 검토", matches: (item) => item.workflow.triage?.decision === "review" },
  { id: "media", label: "이미지 확인", matches: needsImageReview },
  { id: "failed", label: "번역 실패", matches: (item) => item.workflow.status === "translation_failed" },
  { id: "ignored", label: "보류", matches: (item) => item.workflow.status === "ignored" },
  { id: "all", label: "전체", matches: () => true },
];

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "시각 미상"
    : new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function SourceLinks({ item }) {
  const links = new Map(item.original.links.map((url) => [url, "원문 링크"]));
  if (item.source.url) {
    links.set(item.source.url, item.source.type === "x-post" ? "X 원문" : "Discord 원문");
  }
  if (!links.size) return null;
  return (
    <div className="link-row">
      {[...links].map(([url, label]) => (
        <a href={url} target="_blank" rel="noopener noreferrer" key={url}>
          {label} ↗
        </a>
      ))}
    </div>
  );
}

function Original({ item }) {
  return (
    <details className="original-box">
      <summary>본문 원문과 관련 문맥 펼치기</summary>
      <p className="section-label">본문 원문</p>
      {item.original.content && <p className="original-content">{item.original.content}</p>}
      {item.original.contexts.map((context, index) => (
        <section className="context-box" key={`${context.url ?? context.account}-${index}`}>
          <strong>관련 글 문맥 · {context.label || context.account || "작성자 미상"}</strong>
          <p>{context.content}</p>
          {context.url && <a href={context.url} target="_blank" rel="noopener noreferrer">관련 X 글 ↗</a>}
        </section>
      ))}
      {item.original.embeds.map((embed, index) => (
        <section className="embed-box" key={`${embed.url ?? "embed"}-${index}`}>
          {embed.title && <h3>{embed.title}</h3>}
          {embed.description && <p>{embed.description}</p>}
          {embed.fields.map((field, fieldIndex) => (
            <div className="embed-field" key={`${field.name}-${fieldIndex}`}>
              {field.name && <strong>{field.name}</strong>}
              {field.value && <span>{field.value}</span>}
            </div>
          ))}
        </section>
      ))}
      <SourceLinks item={item} />
    </details>
  );
}

function fallbackAdvice(item) {
  const triage = item.workflow.triage;
  if (!triage) return "번역과 판정이 끝난 뒤 게시 조언을 확인할 수 있어요.";
  if (needsImageReview(item)) return "모델은 이미지 픽셀을 보지 않았어요. 텍스트만으로 내린 보류를 확정하지 말고 이미지와 원문 관계를 사람이 확인하세요.";
  if (triage.decision === "publish") return "구체적인 변화가 있는 게시 후보예요. 원문과 이미지를 확인한 뒤 승인하세요.";
  if (triage.decision === "review") return "의미 있는 신호일 수 있지만 단정하기 어려워요. 부모 글과 작성자 맥락을 사람이 확인하는 편이 좋아요.";
  return "현재 정보만으로는 뉴스 가치가 낮아 보류를 권해요. 이미지에 핵심 정보가 보일 때만 다시 검토하세요.";
}

function ApprovalPanel({ item, confirming, busy, error, onBegin, onCancel, onApprove }) {
  if (item.workflow.publishedToDc) {
    return <div className="approval approved">DC 게시 완료 영수증이 확인됐어요.</div>;
  }
  if (item.workflow.dcApproval) {
    return (
      <div className="approval approved">
        <strong>DC 게시 승인 완료</strong>
        <span>{formatDate(item.workflow.dcApproval.approvedAt)} · 아직 실제 게시 전</span>
      </div>
    );
  }
  if (!item.workflow.canApproveForDc) {
    return <div className="approval unavailable">번역과 판정이 끝난 검토 후보만 승인할 수 있어요.</div>;
  }
  if (!confirming) {
    return (
      <div className="approval">
        <p>승인은 게시 대기 영수증만 남깁니다. 실제 DC 게시는 실행하지 않아요.</p>
        <button type="button" className="approve-button" onClick={onBegin}>DC 게시 승인</button>
      </div>
    );
  }
  return (
    <div className="approval confirm">
      <strong>정말 게시 대기함으로 승인할까요?</strong>
      <span>원문·번역·이미지를 마지막으로 확인해 주세요.</span>
      {error && <span className="action-error">{error}</span>}
      <div className="approval-actions">
        <button type="button" className="cancel-button" onClick={onCancel} disabled={busy}>취소</button>
        <button type="button" className="approve-button" onClick={onApprove} disabled={busy}>
          {busy ? "승인 저장 중…" : "확인하고 승인"}
        </button>
      </div>
    </div>
  );
}

function NewsCard({ item, confirming, busy, error, onBegin, onCancel, onApprove, onRetry }) {
  const triage = item.workflow.triage;
  return (
    <article className="news-card">
      <div className="card-top">
        <div className="badges">
          <span className="status">{STATUS_LABELS[item.workflow.status] ?? "상태 확인 필요"}</span>
          {triage && <span className={`decision decision-${triage.decision}`}>{DECISION_LABELS[triage.decision]}</span>}
        </div>
        <time>{formatDate(item.source.publishedAt)}</time>
      </div>

      {(item.source.label || item.source.account) && (
        <p className="source-label">
          {item.source.label ?? item.source.account} · {item.source.type === "x-post" ? "X" : "Discord"}
        </p>
      )}

      {item.workflow.translation ? (
        <section className="translation-box">
          <p className="section-label">제목</p>
          <h2>{item.workflow.translation.title || "제목 없음"}</h2>
          <p className="section-label body-label">본문 번역</p>
          <p>{item.workflow.translation.body}</p>
        </section>
      ) : (
        <section className="translation-box muted-box">
          <strong>본문 번역</strong>
          <p>아직 한국어 번역이 준비되지 않았어요.</p>
          {item.workflow.analysisFailure && (
            <div className="analysis-failure">
              <span>{FAILURE_LABELS[item.workflow.analysisFailure.code] ?? FAILURE_LABELS.unknown}</span>
              {error && <span className="action-error">{error}</span>}
              <button type="button" className="retry-button" disabled={busy} onClick={onRetry}>
                {busy ? "다시 분석 중…" : "무료 텍스트 API로 다시 분석"}
              </button>
            </div>
          )}
        </section>
      )}

      {triage && (
        <section className="triage-box">
          <div>
            <span>판정</span>
            <strong>{DECISION_LABELS[triage.decision]}</strong>
          </div>
          <dl>
            <div><dt>산정 근거</dt><dd>{triage.reason}</dd></div>
            <div><dt>하나빛 조언</dt><dd>{needsImageReview(item) ? fallbackAdvice(item) : triage.advice || fallbackAdvice(item)}</dd></div>
          </dl>
          <small>
            신뢰도 {Math.round(triage.confidence * 100)}%
            {triage.importance && ` · 중요도 ${IMPORTANCE_LABELS[triage.importance]}`}
          </small>
        </section>
      )}

      {item.media.length > 0 && (
        <>
          {needsImageReview(item) && <p className="media-review-note">이미지는 자동 판정에 포함되지 않았어요 · 사람 확인 필요</p>}
          <div className="media-grid">
            {item.media.map((media, index) => (
              <img src={media.url} alt={`공지 첨부 이미지 ${index + 1}`} loading="lazy" key={media.url} />
            ))}
          </div>
        </>
      )}

      <Original item={item} />
      <ApprovalPanel
        item={item}
        confirming={confirming}
        busy={busy}
        error={error}
        onBegin={onBegin}
        onCancel={onCancel}
        onApprove={onApprove}
      />
    </article>
  );
}

function App() {
  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [confirmingId, setConfirmingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionErrorId, setActionErrorId] = useState(null);
  const [filter, setFilter] = useState("action");

  async function load() {
    const response = await fetch("/api/news", { cache: "no-store" });
    if (!response.ok) throw new Error("대기함 요청 실패");
    setPayload(await response.json());
  }

  useEffect(() => {
    load().catch(() => setLoadError("뉴스 대기함을 불러오지 못했어요."));
  }, []);

  const summary = useMemo(() => {
    const items = payload?.items ?? [];
    return {
      total: payload?.total ?? 0,
      review: items.filter((item) => item.workflow.canApproveForDc).length,
      approved: items.filter((item) => item.workflow.dcApproval).length,
      media: items.reduce((sum, item) => sum + item.media.length, 0),
    };
  }, [payload]);

  const visibleItems = useMemo(() => {
    const selected = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];
    return (payload?.items ?? []).filter(selected.matches);
  }, [payload, filter]);

  async function approve(item) {
    setBusyId(item.id);
    setActionError("");
    setActionErrorId(null);
    try {
      const response = await fetch(`/api/news/${item.id}/dc-approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "approve-dc-publication" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "승인을 저장하지 못했어요.");
      await load();
      setConfirmingId(null);
    } catch (error) {
      setActionError(error.message);
      setActionErrorId(item.id);
    } finally {
      setBusyId(null);
    }
  }

  async function retry(item) {
    setBusyId(item.id);
    setActionError("");
    setActionErrorId(null);
    try {
      const response = await fetch(`/api/news/${item.id}/analysis-retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "retry-news-analysis" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "다시 분석하지 못했어요.");
      await load();
    } catch (error) {
      setActionError(error.message);
      setActionErrorId(item.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header>
        <a href="/">← 허브 홈</a>
        <span>OWNER ONLY</span>
      </header>
      <main>
        <p className="eyebrow">HANABIT NEWS LAB · REACT PILOT</p>
        <h1>뉴스<br /><em>검수실.</em></h1>
        <p className="intro">원문·번역·판정·이미지를 한곳에서 확인하고, 검토가 끝난 뉴스만 DC 게시 대기 상태로 승인합니다.</p>

        <section className="summary" aria-label="뉴스 현황">
          <div><strong>{summary.total.toLocaleString("ko-KR")}</strong><span>전체 대기</span></div>
          <div><strong>{summary.review.toLocaleString("ko-KR")}</strong><span>승인 가능</span></div>
          <div><strong>{summary.approved.toLocaleString("ko-KR")}</strong><span>승인 완료</span></div>
          <div><strong>{summary.media.toLocaleString("ko-KR")}</strong><span>보존 이미지</span></div>
        </section>

        <nav className="filters" aria-label="뉴스 필터">
          {FILTERS.map((entry) => {
            const count = (payload?.items ?? []).filter(entry.matches).length;
            return (
              <button
                type="button"
                className={filter === entry.id ? "active" : ""}
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                key={entry.id}
              >
                {entry.label} <span>{count}</span>
              </button>
            );
          })}
        </nav>

        {!payload && <p className="notice" role="status">{loadError || "대기함을 확인하고 있어요…"}</p>}
        {payload?.items.length === 0 && <p className="notice">아직 수집된 뉴스가 없어요. 새 소식을 기다리는 중이에요.</p>}
        {payload?.items.length > 0 && visibleItems.length === 0 && <p className="notice">이 필터에 해당하는 뉴스가 없어요.</p>}
        <section className="news-list" aria-label="수집된 뉴스">
          {visibleItems.map((item) => (
            <NewsCard
              item={item}
              key={item.id}
              confirming={confirmingId === item.id}
              busy={busyId === item.id}
              error={actionErrorId === item.id ? actionError : ""}
              onBegin={() => { setActionError(""); setActionErrorId(null); setConfirmingId(item.id); }}
              onCancel={() => { setActionError(""); setActionErrorId(null); setConfirmingId(null); }}
              onApprove={() => approve(item)}
              onRetry={() => retry(item)}
            />
          ))}
        </section>
      </main>
    </>
  );
}

createRoot(document.querySelector("#news-root")).render(<App />);
