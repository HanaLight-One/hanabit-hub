import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const EMPTY = { id: null, headText: "잡담", title: "", bodyText: "", images: [] };

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "요청을 완료하지 못했어요.");
  return payload;
}

function sourceKey(image) { return `${image.sourceType}:${image.sourceId}`; }

function App() {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [publisherReady, setPublisherReady] = useState(false);
  const [headTexts, setHeadTexts] = useState([]);
  const [archive, setArchive] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("편집실을 준비하는 중이에요.");
  const selectedKeys = useMemo(() => new Set(draft.images.map(sourceKey)), [draft.images]);

  async function load() {
    try {
      const [composer, images] = await Promise.all([
        jsonFetch("/api/dc/composer", { cache: "no-store" }),
        jsonFetch("/api/images", { cache: "no-store" }),
      ]);
      setEnabled(composer.enabled);
      setPublisherReady(composer.publisherReady);
      setHeadTexts(composer.headTexts ?? []);
      setUploads(composer.uploads ?? []);
      setArchive((images.images ?? []).map((image) => ({ sourceType: "archive", sourceId: image.id, name: image.name, contentUrl: image.thumbnailUrl, meta: `${image.date ?? "날짜 없음"} · ${image.category}` })));
      if (composer.draft) setDraft({ ...composer.draft, images: composer.draft.images ?? [] });
      setMessage(composer.enabled ? "이미지를 고르고 원고를 작성해 주세요." : "DC 편집실 쓰기 권한이 꺼져 있어요.");
    } catch (error) { setMessage(error.message); }
    finally { setReady(true); }
  }
  useEffect(() => { load(); }, []);

  function toggle(image) {
    if (!enabled || busy) return;
    const key = sourceKey(image);
    setPreview(null);
    setDraft((current) => {
      if (current.images.some((item) => sourceKey(item) === key)) return { ...current, images: current.images.filter((item) => sourceKey(item) !== key) };
      if (current.images.length >= 10) { setMessage("이미지는 최대 10장까지 선택할 수 있어요."); return current; }
      return { ...current, images: [...current.images, image] };
    });
  }

  function move(index, direction) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.images.length) return current;
      const images = [...current.images];
      [images[index], images[target]] = [images[target], images[index]];
      return { ...current, images };
    });
    setPreview(null);
  }

  async function uploadFiles(event) {
    const files = [...event.target.files].slice(0, 10);
    if (!files.length) return;
    setBusy("upload");
    try {
      const added = [];
      for (const file of files) {
        const item = await jsonFetch("/api/dc/uploads", {
          method: "POST",
          headers: { "content-type": file.type, "x-upload-filename": encodeURIComponent(file.name) },
          body: file,
        });
        added.push(item);
      }
      setUploads((current) => [...added, ...current.filter((item) => !added.some((next) => next.id === item.id))]);
      setMessage(`${added.length}장 업로드했어요.`);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); event.target.value = ""; }
  }

  async function deleteUpload(item) {
    if (!item) return;
    if (selectedKeys.has(`upload:${item.id}`)) {
      setMessage("선택 중인 업로드 이미지는 첨부에서 먼저 빼주세요.");
      return;
    }
    if (!confirm(`'${item.name}' 업로드 파일을 서버에서 삭제할까요?`)) return;
    setBusy("delete-upload");
    try {
      await jsonFetch(`/api/dc/uploads/${item.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "delete-dc-upload" }),
      });
      setUploads((current) => current.filter((upload) => upload.id !== item.id));
      setMessage("업로드 파일을 삭제했어요.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  function startNewDraft() {
    setDraft(EMPTY);
    setPreview(null);
    setMessage("새 원고를 시작했어요.");
  }

  async function saveAndPreview() {
    setBusy("save");
    try {
      const saved = await jsonFetch("/api/dc/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: "save-dc-draft",
          id: draft.id,
          headText: draft.headText,
          title: draft.title,
          bodyText: draft.bodyText,
          images: draft.images.map(({ sourceType, sourceId }) => ({ sourceType, sourceId })),
        }),
      });
      setDraft(saved);
      const checked = await jsonFetch(`/api/dc/drafts/${saved.id}/preview`, { cache: "no-store" });
      setPreview(checked);
      setPublisherReady(checked.publisherReady);
      setMessage(checked.preflight.ready ? "게시 직전 모습을 확인해 주세요." : "게시 전 고칠 항목이 있어요.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  async function publish() {
    if (!preview?.canPublish || !draft.id) return;
    if (!confirm("이 원고를 챗GPT 갤러리에 실제로 게시할까요?\n제출 후 결과가 애매하면 자동으로 다시 시도하지 않아요.")) return;
    setBusy("publish");
    try {
      const result = await jsonFetch(`/api/dc/drafts/${draft.id}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "publish-dc-compose-now" }),
      });
      setDraft(result);
      setPreview((current) => ({ ...current, canPublish: false }));
      setMessage(result.publication?.status === "posted" ? "DC 게시가 완료됐어요." : "게시 결과가 불명확해 자동 재시도하지 않았어요.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  const uploadedImages = uploads.map((item) => ({ sourceType: "upload", sourceId: item.id, name: item.name, contentUrl: item.contentUrl, meta: "GPT 업로드" }));
  return <>
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark">H</span><span>HANABIT <b>DC</b></span></a>
      <span className={`runtime ${publisherReady ? "online" : ""}`}>{publisherReady ? "게시자 연결됨" : "게시자 확인 필요"}</span>
    </header>
    <main>
      <section className="hero"><p className="eyebrow">OWNER ONLY · COMPOSER</p><h1>골라서 쓰고,<br/><em>바로 게시.</em></h1><p>{message}</p></section>
      <div className="workspace">
        <section className="compose panel">
          <p className="section-label">01 · WRITE</p><h2>원고 작성</h2>
          <label>말머리<select value={draft.headText} disabled={!enabled || busy} onChange={(event) => { setDraft({ ...draft, headText: event.target.value }); setPreview(null); }}>{headTexts.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>제목 <span>{[...draft.title].length}/80</span><input value={draft.title} maxLength={80} disabled={!enabled || busy} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setPreview(null); }} placeholder="제목을 입력해 주세요" /></label>
          <label>본문 <span>{draft.bodyText.length.toLocaleString()}/20,000</span><textarea value={draft.bodyText} maxLength={20000} disabled={!enabled || busy} onChange={(event) => { setDraft({ ...draft, bodyText: event.target.value }); setPreview(null); }} placeholder="본문을 입력해 주세요" /></label>
        </section>
        <section className="library panel">
          <div className="section-head"><div><p className="section-label">02 · PICK</p><h2>이미지 보관함</h2></div><label className="upload-button">{busy === "upload" ? "업로드 중…" : "이미지 업로드"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={!enabled || busy} onChange={uploadFiles}/></label></div>
          <h3>업로드 이미지</h3><ImageGrid images={uploadedImages} selectedKeys={selectedKeys} toggle={toggle} onDelete={(image) => deleteUpload(uploads.find((item) => item.id === image.sourceId))} empty="아직 업로드한 이미지가 없어요." />
          <h3>허브 이미지</h3><ImageGrid images={archive} selectedKeys={selectedKeys} toggle={toggle} empty={ready ? "허브 이미지가 없어요." : "불러오는 중…"} />
        </section>
        <aside className="preview panel">
          <p className="section-label">03 · PREVIEW</p><h2>첨부 순서</h2>
          <div className="selected-list">{draft.images.length ? draft.images.map((image, index) => <article key={sourceKey(image)}><img src={image.contentUrl} alt=""/><div><strong>{String(index + 1).padStart(2, "0")} · {image.name}</strong><span>{image.sourceType === "upload" ? "업로드" : "허브"}</span></div><nav><button onClick={() => move(index, -1)} disabled={index === 0 || busy}>↑</button><button onClick={() => move(index, 1)} disabled={index === draft.images.length - 1 || busy}>↓</button><button onClick={() => toggle(image)} disabled={busy}>×</button></nav></article>) : <p className="empty">첨부 없이 글만 게시할 수도 있어요.</p>}</div>
          <button className="preview-button" disabled={!enabled || busy} onClick={saveAndPreview}>{busy === "save" ? "검사 중…" : "초안 저장 · 게시 미리보기"}</button>
          {preview && <section className="copy-preview"><span>{preview.draft.headText}</span><h3>{preview.draft.title || "제목 없음"}</h3><pre>{preview.draft.bodyText || "본문 없음"}</pre><p>이미지 {preview.draft.images.length}장 · 게시 직전 상단 첨부</p>{preview.preflight.errors.length > 0 && <ul>{preview.preflight.errors.map((error) => <li key={error}>{error}</li>)}</ul>}<button className="publish-button" disabled={!preview.canPublish || busy} onClick={publish}>{busy === "publish" ? "실제 게시 중…" : "DC에 실제 게시"}</button></section>}
          {draft.publication?.status === "posted" && <a className="receipt" href={draft.publication.url} target="_blank" rel="noreferrer">게시글 확인 ↗</a>}
          {draft.publication && <button className="new-draft-button" type="button" onClick={startNewDraft}>새 글 작성</button>}
        </aside>
      </div>
    </main>
  </>;
}

function ImageGrid({ images, selectedKeys, toggle, onDelete = null, empty }) {
  if (!images.length) return <p className="empty">{empty}</p>;
  return <div className="image-grid">{images.map((image) => <article className={selectedKeys.has(sourceKey(image)) ? "selected" : ""} key={sourceKey(image)}><button type="button" className="image-select" onClick={() => toggle(image)}><img src={image.contentUrl} alt="" loading="lazy"/><span>{image.name}</span><small>{selectedKeys.has(sourceKey(image)) ? "선택됨" : image.meta}</small></button>{onDelete && <button type="button" className="upload-delete" aria-label={`${image.name} 업로드 삭제`} onClick={() => onDelete(image)}>×</button>}</article>)}</div>;
}

createRoot(document.querySelector("#dc-root")).render(<App />);
