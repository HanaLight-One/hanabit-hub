import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("React 뉴스 검수실 화면과 승인 스크립트를 제공한다", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${baseUrl}/news`);
    const body = await page.text();
    const script = await (await fetch(`${baseUrl}/news/app.js`)).text();
    assert.equal(page.status, 200);
    assert.equal(body.includes("뉴스 검수실"), true);
    assert.equal(body.includes('id="news-root"'), true);
    assert.equal(script.includes("localStorage"), false);
    assert.equal(script.includes('fetch("/api/news"'), true);
    assert.equal(script.includes("translation-box"), true);
    assert.equal(script.includes("retry-news-analysis"), true);
    assert.equal(script.includes("확인 필요"), true);
    assert.equal(script.includes("하나빛 조언"), true);
    assert.equal(script.includes("이미지 확인"), true);
    assert.equal(script.includes("이미지 픽셀을 보지 않았어요"), true);
    assert.equal(script.includes("무료 API 1차 판정"), true);
    assert.equal(script.includes("Codex 하나빛 심층검토"), true);
    assert.equal(script.includes("누구예요?"), true);
    assert.equal(script.includes("정보 성격"), true);
    assert.equal(script.includes("inference: \"유추\""), true);
    assert.equal(script.includes("AUTO PUBLISH GATE"), true);
    assert.equal(script.includes("새 정책으로 다시 판정"), true);
    assert.equal(script.includes("approve-dc-publication"), true);
    assert.equal(script.includes("DC 원고 미리보기"), true);
    assert.equal(script.includes("publish-news-to-dc-now"), true);
    assert.equal(script.includes("수동 DC 게시"), true);
    assert.equal(script.includes("기본 커버 자동 추가"), true);
    assert.equal(script.includes("AUTONOMOUS EDITOR · SHADOW"), true);
    assert.equal(script.includes("원문 경계 자동 검증 완료"), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
