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
const EVIDENCE_LABELS = {
  official: "공식",
  confirmed: "확정",
  use_case: "사례",
  inference: "유추",
  rumor: "루머",
  opinion: "의견",
};
const BOARD_CATEGORY_LABELS = {
  news: "뉴스/소식",
  information: "💡 정보",
  chatter: "잡담",
  ai_creation: "AI창작",
};
const AUTO_GATE_LABELS = {
  eligible: "자동 게시 가능",
  human_review: "사람 확인 필요",
  blocked: "자동 게시 제외",
};
const EDITORIAL_SHADOW_LABELS = {
  ready: "자동 게시 후보",
  merge: "같은 사건에 합치기",
  hold: "자동 대기",
  hub_only: "허브에만 보관",
};
const FAILURE_LABELS = {
  timeout: "응답 시간이 초과됐어요.",
  invalid_response: "응답 형식이 깨져 번역을 저장하지 못했어요.",
  provider_error: "무료 텍스트 API 요청이 완료되지 않았어요.",
  unknown: "분석 도중 안전하게 복구하지 못한 오류가 있었어요.",
};
const PROVIDER_REASON_LABELS = {
  rate_limit: "요청이 잠시 몰렸거나 사용 한도에 닿았어요.",
  authentication: "API 인증 또는 프로젝트 권한을 확인해야 해요.",
  connection: "무료 API 서버와의 네트워크 연결이 끊겼어요.",
  timeout: "무료 API가 제한 시간 안에 응답하지 않았어요.",
  bad_request: "무료 API가 요청 형식을 받아들이지 않았어요.",
  provider_server: "무료 API 서버에서 일시적인 오류가 발생했어요.",
  unknown: "제공자 오류 종류를 더 좁히지 못했어요.",
};

function needsImageReview(item) {
  return item.workflow.status === "ignored" && item.media.length > 0;
}

const FILTERS = [
  { id: "action", label: "확인 필요", matches: (item) => ["pending_review", "translation_failed"].includes(item.workflow.status) || needsImageReview(item) },
  { id: "publish", label: "게시 후보", matches: (item) => item.workflow.triage?.decision === "publish" },
  { id: "use_case", label: "활용 사례", matches: (item) => item.workflow.triage?.evidenceTag === "use_case" },
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

function TriageBox({ triage, label, advice, className = "" }) {
  return (
    <section className={`triage-box ${className}`.trim()}>
      <div>
        <span>{label}</span>
        <strong>{DECISION_LABELS[triage.decision]}</strong>
      </div>
      <dl>
        <div><dt>산정 근거</dt><dd>{triage.reason}</dd></div>
        <div><dt>하나빛 조언</dt><dd>{advice}</dd></div>
      </dl>
      <small>
        신뢰도 {Math.round(triage.confidence * 100)}%
        {triage.importance && ` · 중요도 ${IMPORTANCE_LABELS[triage.importance]}`}
        {triage.evidenceTag && ` · 정보 성격 [${EVIDENCE_LABELS[triage.evidenceTag]}]`}
        {triage.boardCategory && ` · 게시 분류 ${BOARD_CATEGORY_LABELS[triage.boardCategory]}`}
      </small>
    </section>
  );
}

function SourceProfile({ profile }) {
  if (!profile) return null;
  return (
    <details className="source-profile">
      <summary>누구예요?</summary>
      <div className="source-profile-body">
        <strong>{profile.displayName}</strong>
        <p>{profile.affiliation} · {profile.roles.join(" · ")}</p>
        <p>{profile.whyTracked}</p>
        <dl>
          <div><dt>주요 분야</dt><dd>{profile.topics.join(" · ")}</dd></div>
          <div><dt>출처 구분</dt><dd>{profile.trustLabel}</dd></div>
          <div>
            <dt>소속 확인</dt>
            <dd>
              {profile.affiliationConfirmed ? "확인됨" : "사람 재확인 필요"}
              {profile.verifiedAt && ` · ${profile.verifiedAt}`}
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

function ContextTranslations({ item }) {
  const translations = item.workflow.contextTranslations ?? [];
  if (!translations.length) return null;
  return (
    <section className="context-translations">
      <p className="section-label">관련 글 번역</p>
      {translations.map((translation) => {
        const context = item.original.contexts?.[translation.index - 1];
        return (
          <article key={translation.index}>
            <strong>{context?.label || context?.account || `관련 글 ${translation.index}`}</strong>
            <p>{translation.body}</p>
            {context?.url && <a href={context.url} target="_blank" rel="noopener noreferrer">관련 X 원문 ↗</a>}
          </article>
        );
      })}
      <small>각 문장은 위 작성자의 관련 글을 별도로 번역한 내용이며, 본문 작성자의 발언이 아닙니다.</small>
    </section>
  );
}

function AutoPublishGate({ gate }) {
  if (!gate) return null;
  return (
    <section className={`auto-gate auto-gate-${gate.decision}`}>
      <div>
        <span>AUTO PUBLISH GATE</span>
        <strong>{AUTO_GATE_LABELS[gate.decision]}</strong>
      </div>
      <p>{gate.reason}</p>
      {gate.decision === "eligible" && <small>현재는 판정만 표시하며 실제 DC 자동 게시는 꺼져 있어요.</small>}
    </section>
  );
}

function EditorialShadow({ shadow }) {
  if (!shadow) return null;
  return (
    <section className={`editorial-shadow editorial-shadow-${shadow.decision}`}>
      <div>
        <span>AUTONOMOUS EDITOR · SHADOW</span>
        <strong>{EDITORIAL_SHADOW_LABELS[shadow.decision]}</strong>
      </div>
      <p>{shadow.reason}</p>
      {shadow.storySize > 1 && <small>같은 사건으로 감지한 출처 {shadow.storySize}개</small>}
      <small>현재는 그림자 판정만 기록하며 실제 자동 게시는 실행하지 않아요.</small>
    </section>
  );
}

function DcBodyPreview({ bodyText }) {
  return (
    <div className="dc-copy-content">
      {String(bodyText ?? "").split("\n").map((line, index) => {
        const key = `${index}-${line.slice(0, 24)}`;
        if (!line) return <span className="dc-copy-space" aria-hidden="true" key={key} />;
        if (line.startsWith("게시자: ")) return <p className="dc-copy-publisher" key={key}>{line}</p>;
        if (["본문 번역", "왜 중요한가", "아직 확인되지 않은 점", "원문 링크"].includes(line) ||
            line.startsWith("관련 글 번역 · ")) {
          return <h4 className={line === "아직 확인되지 않은 점" ? "dc-copy-section caution" : "dc-copy-section"} key={key}>{line}</h4>;
        }
        if (line.startsWith("주의: ")) return <p className="dc-copy-notice" key={key}>{line}</p>;
        if (/^https:\/\/(?:x\.com|twitter\.com|discord\.com|(?:[a-z0-9-]+\.)*openai\.com)\//iu.test(line)) {
          return <a className="dc-copy-link" href={line} target="_blank" rel="noopener noreferrer" key={key}>{line}</a>;
        }
        return <p className="dc-copy-line" key={key}>{line}</p>;
      })}
    </div>
  );
}

function DcPublicationPanel({ item, preview, busy, error, onPreview, onPublish }) {
  if (item.workflow.publishedToDc) {
    return (
      <div className="approval approved">
        <strong>DC 게시 완료</strong>
        {item.workflow.dcPublication?.url && (
          <a href={item.workflow.dcPublication.url} target="_blank" rel="noopener noreferrer">게시글 확인</a>
        )}
      </div>
    );
  }
  if (item.workflow.dcPublication?.status === "submitting") {
    return <div className="approval confirm">DC에 한 번 제출하고 있어요. 완료될 때까지 다시 누르지 마세요.</div>;
  }
  if (item.workflow.dcPublication?.status === "ambiguous-no-retry") {
    return (
      <div className="approval danger">
        <strong>게시 결과를 자동으로 확정하지 못했어요.</strong>
        <span>중복 게시를 막기 위해 다시 제출하지 않습니다. DC 게시판에서 직접 확인해 주세요.</span>
      </div>
    );
  }
  if (!item.workflow.canApproveForDc && !item.workflow.dcApproval) {
    return <div className="approval unavailable">번역과 판정이 끝난 검토 후보만 승인할 수 있어요.</div>;
  }
  if (!preview) {
    return (
      <div className="approval">
        <p>먼저 실제로 들어갈 제목·본문·이미지 순서와 DC 안전 검사를 확인해요.</p>
        {error && <span className="action-error">{error}</span>}
        <button type="button" className="preview-button" onClick={onPreview} disabled={busy}>
          {busy ? "원고 만드는 중…" : "DC 원고 미리보기"}
        </button>
      </div>
    );
  }
  return (
    <section className="dc-preview">
      <div className="dc-preview-heading">
        <span>DC POST PREVIEW</span>
        <strong>{preview.headText}</strong>
      </div>
      {preview.fallbackCover?.used && (
        <figure className="dc-cover-preview">
          <img src={preview.fallbackCover.url} alt={`${preview.headText} 기본 커버`} />
          <figcaption>원문 이미지가 없어 말머리 기본 커버를 첫 이미지로 첨부해요.</figcaption>
        </figure>
      )}
      <dl>
        <div><dt>제목</dt><dd>{preview.title}</dd></div>
        <div>
          <dt>이미지</dt>
          <dd>{preview.imageCount}장 · 본문 최상단 첨부{preview.fallbackCover?.used ? " · 기본 커버 자동 추가" : ""}</dd>
        </div>
      </dl>
      <div className="dc-copy-preview">
        <span>본문</span>
        <DcBodyPreview bodyText={preview.bodyText} />
      </div>
      <ul className="dc-warnings">
        {preview.preflight.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>
      {preview.preflight.emojiRemovedCount > 0 && (
        <p className="dc-safe-note">미리보기와 실제 게시 원고 모두에서 이모지를 제거했어요.</p>
      )}
      {!preview.publisherReady && <p className="action-error">실제 DC 게시 실행환경을 확인해 주세요.</p>}
      {error && <span className="action-error">{error}</span>}
      <p className="dc-submit-copy">
        누르면 필요한 경우 승인을 먼저 저장하고 DC에 정확히 한 번 제출합니다. 실패가 불명확하면 자동 재시도하지 않아요.
      </p>
      <button
        type="button"
        className="publish-button"
        onClick={onPublish}
        disabled={busy || !preview.publisherReady || !preview.preflight.ready || !preview.canPublish}
      >
        {busy ? "DC에 제출 중…" : "수동 DC 게시"}
      </button>
    </section>
  );
}

function NewsCard({ item, preview, busy, error, onPreview, onPublish, onRetry, onReanalyze }) {
  const triage = item.workflow.triage;
  const freeTriage = item.workflow.freeTriage;
  const codexReview = item.workflow.codexReview;
  return (
    <article className="news-card">
      <div className="card-top">
        <div className="badges">
          <span className="status">{STATUS_LABELS[item.workflow.status] ?? "상태 확인 필요"}</span>
          {triage && <span className={`decision decision-${triage.decision}`}>{DECISION_LABELS[triage.decision]}</span>}
          {triage?.evidenceTag && (
            <span className={`evidence evidence-${triage.evidenceTag}`}>
              [{EVIDENCE_LABELS[triage.evidenceTag]}]
            </span>
          )}
          {codexReview?.status === "complete" && <span className="decision codex-badge">Codex 검토 완료</span>}
        </div>
        <time>{formatDate(item.source.publishedAt)}</time>
      </div>

      {(item.source.label || item.source.account) && (
        <div className="source-heading">
          <p className="source-label">
            {item.source.label ?? item.source.account} · {item.source.type === "x-post" ? "X" : "Discord"}
          </p>
          <SourceProfile profile={item.source.profile} />
        </div>
      )}

      {item.workflow.translation ? (
        <section className="translation-box">
          <p className="section-label">제목</p>
          <h2>
            {triage?.evidenceTag && `[${EVIDENCE_LABELS[triage.evidenceTag]}] `}
            {item.workflow.translation.title || "제목 없음"}
          </h2>
          <p className="section-label body-label">본문 번역</p>
          <p>{item.workflow.translation.body}</p>
          <small className="translation-boundary">
            원문만 번역 · 관련 글의 정보는 번역문에 포함하지 않음
            {item.workflow.translationReview?.status === "codex_corrected" && " · Codex가 귀속 오류를 교정함"}
            {item.workflow.translationReview?.status === "codex_verified" && " · Codex 귀속 검증 완료"}
            {item.workflow.translationReview?.status === "local_verified" && " · 원문 경계 자동 검증 완료"}
            {item.workflow.translationReview?.status === "free_unverified" && item.workflow.translationReview.reason &&
              ` · 자동 검증 보류: ${item.workflow.translationReview.reason}`}
          </small>
        </section>
      ) : (
        <section className="translation-box muted-box">
          <strong>본문 번역</strong>
          <p>아직 한국어 번역이 준비되지 않았어요.</p>
          {item.workflow.analysisFailure && (
            <div className="analysis-failure">
              <span>{FAILURE_LABELS[item.workflow.analysisFailure.code] ?? FAILURE_LABELS.unknown}</span>
              {item.workflow.analysisFailure.code === "provider_error" && (
                <small>{PROVIDER_REASON_LABELS[item.workflow.analysisFailure.providerReason] ?? PROVIDER_REASON_LABELS.unknown}</small>
              )}
              {error && <span className="action-error">{error}</span>}
              <button type="button" className="retry-button" disabled={busy} onClick={onRetry}>
                {busy ? "다시 분석 중…" : "무료 텍스트 API로 다시 분석"}
              </button>
            </div>
          )}
        </section>
      )}

      <ContextTranslations item={item} />

      {freeTriage && (
        <TriageBox
          triage={freeTriage}
          label="무료 API 1차 판정"
          advice={freeTriage.advice || "애매함을 감지해 Codex 하나빛에게 전달했어요."}
          className="free-triage"
        />
      )}

      {triage && <p className="analysis-notice">{item.workflow.analysisNotice}</p>}

      {triage && (
        <TriageBox
          triage={triage}
          label={codexReview?.status === "complete" ? "Codex 하나빛 심층검토" : "무료 API 판정"}
          advice={needsImageReview(item) ? fallbackAdvice(item) : triage.advice || fallbackAdvice(item)}
          className={codexReview?.status === "complete" ? "codex-triage" : ""}
        />
      )}

      {codexReview?.status === "daily_limit" && (
        <p className="codex-review-note">오늘의 Codex 심층검토 상한에 도달해 사람 확인으로 남겼어요.</p>
      )}
      {codexReview?.status === "failed" && (
        <p className="codex-review-note">Codex 심층검토를 완료하지 못해 무료 API 판정을 보존했어요.</p>
      )}

      <AutoPublishGate gate={item.workflow.autoPublishGate} />
      <EditorialShadow shadow={item.workflow.editorialShadow} />

      {item.workflow.canReanalyze && (
        <button type="button" className="reanalysis-button" disabled={busy} onClick={onReanalyze}>
          {busy ? "새 정책으로 판정 중…" : "↻ 새 정책으로 다시 판정"}
        </button>
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
      <DcPublicationPanel
        item={item}
        preview={preview}
        busy={busy}
        error={error}
        onPreview={onPreview}
        onPublish={onPublish}
      />
    </article>
  );
}

function App() {
  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [previews, setPreviews] = useState({});
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

  async function loadPreview(item) {
    setBusyId(item.id);
    setActionError("");
    setActionErrorId(null);
    try {
      const response = await fetch(`/api/news/${item.id}/dc-preview`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "DC 원고를 만들지 못했어요.");
      setPreviews((current) => ({ ...current, [item.id]: result }));
    } catch (error) {
      setActionError(error.message);
      setActionErrorId(item.id);
    } finally {
      setBusyId(null);
    }
  }

  async function publishToDc(item) {
    const confirmed = window.confirm(
      "이 원고를 실제 DCInside 챗갤에 한 번 게시할까요?\n제출 결과가 불명확하면 자동으로 다시 시도하지 않습니다.",
    );
    if (!confirmed) return;
    setBusyId(item.id);
    setActionError("");
    setActionErrorId(null);
    try {
      if (!item.workflow.dcApproval) {
        const approvalResponse = await fetch(`/api/news/${item.id}/dc-approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "approve-dc-publication" }),
        });
        const approvalResult = await approvalResponse.json();
        if (!approvalResponse.ok) throw new Error(approvalResult.error || "게시 승인을 저장하지 못했어요.");
      }
      const response = await fetch(`/api/news/${item.id}/dc-publication`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "publish-news-to-dc-now" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "DC 게시 요청을 완료하지 못했어요.");
      await load();
      const previewResponse = await fetch(`/api/news/${item.id}/dc-preview`, { cache: "no-store" });
      if (previewResponse.ok) {
        const refreshedPreview = await previewResponse.json();
        setPreviews((current) => ({ ...current, [item.id]: refreshedPreview }));
      }
      if (result.publication?.status === "failed-preflight") {
        throw new Error("DC 로그인·말머리·금칙어 검사 단계에서 게시가 중단됐어요. 원고를 확인한 뒤 다시 시도할 수 있어요.");
      }
    } catch (error) {
      setActionError(error.message);
      setActionErrorId(item.id);
      await load().catch(() => {});
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

  async function reanalyze(item) {
    if (!window.confirm("번역과 판정을 새 정책으로 다시 실행할까요? 무료 API와 필요한 경우 Codex 토큰을 사용합니다.")) return;
    setBusyId(item.id);
    setActionError("");
    setActionErrorId(null);
    try {
      const response = await fetch(`/api/news/${item.id}/reanalysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "reclassify-news-item" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "새 정책으로 다시 판정하지 못했어요.");
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
        <p className="intro">원문·번역·판정·이미지를 확인하고, DC에 들어갈 최종 원고를 미리 본 뒤 수동으로 한 번 게시합니다.</p>

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
              preview={previews[item.id]}
              busy={busyId === item.id}
              error={actionErrorId === item.id ? actionError : ""}
              onPreview={() => loadPreview(item)}
              onPublish={() => publishToDc(item)}
              onRetry={() => retry(item)}
              onReanalyze={() => reanalyze(item)}
            />
          ))}
        </section>
      </main>
    </>
  );
}

createRoot(document.querySelector("#news-root")).render(<App />);
