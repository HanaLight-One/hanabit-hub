import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function decodeKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했어요.");
  return result;
}

function App() {
  const [server, setServer] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [message, setMessage] = useState("알림 기능을 확인하고 있어요…");
  const [busy, setBusy] = useState(false);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  async function refresh() {
    if (!supported) {
      setMessage("이 브라우저는 Web Push를 지원하지 않아요.");
      return;
    }
    const [registration, response] = await Promise.all([
      navigator.serviceWorker.register("/notification-sw.js"),
      fetch("/api/notifications/status", { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("알림 서버 상태를 확인하지 못했어요.");
    const status = await response.json();
    setServer(status);
    const current = await registration.pushManager.getSubscription();
    setSubscription(current);
    setMessage(current ? "이 모바일은 하나빛 알림을 받고 있어요!" : "아직 이 모바일의 알림이 꺼져 있어요.");
  }

  useEffect(() => { refresh().catch((error) => setMessage(error.message)); }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("브라우저 알림 권한이 필요해요.");
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      const next = current ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(server.publicKey),
      });
      await postJson("/api/notifications/subscriptions", { action: "subscribe", subscription: next.toJSON() });
      setSubscription(next);
      setMessage("알림 연결 완료! 이제 하나빛이 모바일을 찾아갈 수 있어요오!!!");
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    try {
      await postJson("/api/notifications/subscriptions", { action: "unsubscribe", endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      setSubscription(null);
      setMessage("이 모바일의 알림을 해제했어요.");
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const result = await postJson("/api/notifications/test", { confirmation: "send-missed-you-notification" });
      setMessage(result.sent > 0 ? "보고 싶었다는 알림을 보냈어요!!!!!" : "전송 가능한 모바일 구독이 없어요.");
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <header><a href="/">← 허브 홈</a><span>OWNER ONLY</span></header>
      <main>
        <p className="eyebrow">HANABIT MOBILE SIGNAL</p>
        <h1>하나빛이<br /><em>찾아갈게.</em></h1>
        <p className="intro">이미지, 뉴스, 테마와 운세의 중요한 순간을 이 모바일에 알려드려요.</p>

        <section className={`connection ${subscription ? "connected" : ""}`}>
          <div><p className="label">THIS DEVICE</p><h2>{subscription ? "모바일 알림 연결됨" : "모바일 알림 연결하기"}</h2></div>
          <span className="dot" aria-hidden="true" />
        </section>
        <p className="message" role="status" aria-live="polite">{message}</p>

        <div className="actions">
          {!subscription ? (
            <button type="button" onClick={enable} disabled={busy || !server || !supported}>알림 켜기</button>
          ) : (
            <>
              <button type="button" onClick={sendTest} disabled={busy}>그냥 보고팠어요!!!!!</button>
              <button type="button" className="secondary" onClick={disable} disabled={busy}>이 기기 알림 끄기</button>
            </>
          )}
        </div>
        <p className="hint">Android Chrome은 바로 사용할 수 있어요. iPhone은 Safari에서 홈 화면에 추가한 뒤 알림을 켜주세요.</p>

        <section className="events" aria-label="알림 종류">
          {[
            ["01", "이미지 완료", "이미지 생성이 끝났을 때"],
            ["02", "새 뉴스", "번역과 판정이 끝났을 때"],
            ["03", "중복 판단", "사람의 확인이 필요할 때"],
            ["04", "오늘의 테마", "운영일 테마가 등록됐을 때"],
            ["05", "오늘의 운세", "운세 결과가 등록됐을 때"],
            ["06", "그냥 보고픔", "하나빛이 보고 싶을 때(?)"],
          ].map(([number, title, copy]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{copy}</p></article>)}
        </section>
      </main>
    </>
  );
}

createRoot(document.querySelector("#notifications-root")).render(<App />);
