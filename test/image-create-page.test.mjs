import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(callback) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("/images/create가 안전한 추가생성 초안 화면을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/images/create`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /추가 이미지 생성실 · Hanabit Hub/);
    assert.match(body, /id="creation-form"/);
    assert.match(body, /id="style-grid"/);
    assert.match(body, /id="style-toggle"/);
    assert.match(body, /id="character-grid"/);
    assert.match(body, /id="character-toggle"/);
    assert.match(body, /aria-expanded="false"/);
    assert.match(body, /격리 초안 저장/);
    assert.match(body, /maxlength="12000"/);
    assert.match(body, /id="preview-route"/);
    assert.match(body, /id="preview-scene-details"/);
    assert.match(body, /id="preview-scene-summary"/);
    assert.match(body, /id="preview-scene-copy"/);
    assert.match(body, /20260803-job-history/);
    assert.match(body, /id="execute-button"/);
    assert.match(body, /name="purpose"/);
    assert.match(body, /value="theme-followup"/);
    assert.match(body, /value="free-play"/);
    assert.match(body, /value="per-character"/);
    assert.match(body, /value="variants"/);
    assert.match(body, /id="batch-count"/);
    assert.match(body, /id="preview-batch"/);
    assert.match(body, /id="jobs-list"/);
    assert.match(body, /id="source-remove"/);
    assert.match(body, /연결 해제/);
    assert.match(body, /id="source-picker"/);
    assert.match(body, /id="source-picker-open"/);
    assert.match(body, /id="source-upload-form"/);
    assert.match(body, /id="source-upload-file"/);
    assert.match(body, /id="source-upload-button"/);
    assert.match(body, /aria-haspopup="dialog"/);
    assert.match(body, /＋ 소스 이미지 선택/);
    assert.match(body, /소스 이미지 고르기/);
    assert.match(body, /1장 실제 생성/);
    assert.match(body, /disabled/);
    assert.equal(body.includes("<form action="), false);
  });
});

test("추가생성 초안 화면의 스크립트와 스타일을 제공한다", async () => {
  await withServer(async (baseUrl) => {
    const [page, script, style] = await Promise.all([
      fetch(`${baseUrl}/images/create`),
      fetch(`${baseUrl}/images/create/app.js`),
      fetch(`${baseUrl}/images/create/styles.css`),
    ]);
    const body = await page.text();
    const scriptBody = await script.text();

    assert.equal(page.status, 200);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.match(scriptBody, /fetch\(`\/api\/images\//);
    assert.match(scriptBody, /\/api\/images\/creation-options/);
    assert.match(scriptBody, /프롬프트 화풍 사용/);
    assert.match(scriptBody, /Hyper-realistic-anime/);
    assert.match(scriptBody, /2\.5D Semi-realistic-anime/);
    assert.match(scriptBody, /등장인물 없음/);
    assert.match(scriptBody, /PINK_BRIDGE_ID/);
    assert.match(scriptBody, /\/api\/images\/generation-drafts/);
    assert.match(scriptBody, /method: "POST"/);
    assert.match(scriptBody, /prompt-only/);
    assert.match(scriptBody, /generate-one-draft-image/);
    assert.match(scriptBody, /generate-draft-image-batch/);
    assert.match(scriptBody, /regenerate-same-settings/);
    assert.match(scriptBody, /그대로 재생성/);
    assert.match(scriptBody, /기존 이미지를 레퍼런스로 사용하지 않고/);
    assert.match(scriptBody, /MAX_BATCH_IMAGES = 10/);
    assert.match(scriptBody, /선택 인물로 1장 실제 생성/);
    assert.match(scriptBody, /MAX_CUSTOM_CHARACTERS = 6/);
    assert.match(scriptBody, /MAX_SELECTED_STYLES = 3/);
    assert.match(scriptBody, /최대 \$\{MAX_SELECTED_STYLES\}개 혼합/);
    assert.match(scriptBody, /name = blendable \? "style" : "style-mode"/);
    assert.doesNotMatch(scriptBody, /pinkBridge\.checked = false/);
    assert.match(body, /이미지 앵커 사용/);
    assert.match(scriptBody, /useImageAnchors/);
    assert.match(scriptBody, /선택 자산 실제 생성 · 연결 준비 중/);
    assert.match(scriptBody, /프롬프트 자유 생성 · 선택 화풍만 적용/);
    assert.match(scriptBody, /선택 화풍으로 1장 실제 생성/);
    assert.match(scriptBody, /\["auto", "selected", "prompt", "rendering"\]/);
    assert.match(scriptBody, /자동 선택은 실행 시 확정되어 제작 기록에 남아요/);
    assert.match(scriptBody, /자동 화풍으로 1장 실제 생성/);
    assert.match(scriptBody, /previewSceneDetails\.open = false/);
    assert.match(scriptBody, /navigator\.clipboard/);
    assert.match(scriptBody, /복사됨/);
    assert.match(scriptBody, /window\.confirm/);
    assert.match(scriptBody, /\/api\/images\/generation-jobs/);
    assert.match(body, /이전 작업 더 불러오기/);
    assert.match(scriptBody, /JOB_PAGE_SIZE = 10/);
    assert.match(scriptBody, /jobDisplayLimit \+= JOB_PAGE_SIZE/);
    assert.match(scriptBody, /generation-jobs\?limit=/);
    assert.match(scriptBody, /같은 조합으로/);
    assert.match(scriptBody, /인물만 유지/);
    assert.match(scriptBody, /화풍만 유지/);
    assert.match(scriptBody, /job\.images/);
    assert.match(scriptBody, /applySourcePurpose/);
    assert.match(scriptBody, /history\.replaceState/);
    assert.match(scriptBody, /source = null/);
    assert.match(scriptBody, /새 요청 · 소스 없음/);
    assert.match(scriptBody, /openSourcePicker/);
    assert.match(scriptBody, /fallbackOpen/);
    assert.match(scriptBody, /typeof elements\.sourcePicker\.showModal/);
    assert.match(scriptBody, /source-option/);
    assert.match(scriptBody, /\/api\/images\/source-uploads/);
    assert.match(scriptBody, /upload-generation-source/);
    assert.match(scriptBody, /selectSourceImage/);
    assert.match(scriptBody, /clipboardData/);
    assert.match(scriptBody, /moveUploadedSourceToTrash/);
    assert.match(scriptBody, /move-image-to-trash/);
    assert.match(body, /Ctrl\+V/);
    assert.match(scriptBody, /mode: preferredMode/);
    assert.match(scriptBody, /제작 기록이 없는 직접 참조 이미지예요/);
    assert.match(scriptBody, /hasProductionRecord/);
    assert.match(scriptBody, /applySourceProductionSelection/);
    assert.match(scriptBody, /applySourceCharacters/);
    assert.match(scriptBody, /applySourceStyle/);
    assert.match(scriptBody, /await loadCreationOptions\(\)/);
    assert.match(scriptBody, /await loadSourceContext\(\)/);
    assert.match(scriptBody, /제작 기록과 선택을 불러왔어요/);
    assert.match(scriptBody, /purpose/);
    assert.equal(scriptBody.includes('method: "PUT"'), false);
    assert.equal(scriptBody.includes('method: "DELETE"'), false);
    assert.equal(scriptBody.includes("localStorage"), false);
    assert.match(scriptBody, /SAFE_SOURCE_ID/);
  });
});
