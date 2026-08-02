import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("DC 편집실 React 화면과 업로드·미리보기·실제 게시 진입점을 제공한다", async () => {
  const server = createServer({ archive: null, dcComposer: null });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await (await fetch(`${baseUrl}/dc`)).text();
    const app = await (await fetch(`${baseUrl}/dc/app.js`)).text();
    assert.match(page, /id="dc-root"/u);
    assert.match(page, /\/dc\/app\.js/u);
    assert.equal(app.includes("save-dc-draft"), true);
    assert.equal(app.includes("publish-dc-compose-now"), true);
    assert.equal(app.includes("이미지 업로드"), true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
