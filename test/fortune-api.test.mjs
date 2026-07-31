import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function withServer(fortune, callback) {
  const server = createServer({ fortune });
  await new Promise((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve); });
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("운세 API는 본문·날짜·안전한 게시 상태만 제공한다", async () => {
  const fortune = { async get(date) { return { date, available:true, text:"본문", publication:{ status:"posted", updatedAt:"", url:null } }; }, async dates() { return ["2026-07-31"]; }, async text(date) { return { date, text:"본문" }; } };
  await withServer(fortune, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/fortune?date=2026-07-31`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { date:"2026-07-31", available:true, text:"본문", publication:{ status:"posted", updatedAt:"", url:null }, dates:["2026-07-31"] });
    assert.equal((await fetch(`${baseUrl}/api/fortune`, { method:"POST" })).status, 405);
  });
});

test("운세 TXT API는 첨부 다운로드만 제공한다", async () => {
  const fortune = { async text(date) { return { date, text:"본문" }; } };
  await withServer(fortune, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/fortune/text/2026-07-31`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "본문");
    assert.match(response.headers.get("content-disposition"), /fortune-2026-07-31\.txt/);
  });
});
