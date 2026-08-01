import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

test("모바일 알림 React 화면과 Service Worker를 제공한다", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${baseUrl}/notifications`);
    const body = await page.text();
    const script = await (await fetch(`${baseUrl}/notifications/app.js`)).text();
    const worker = await (await fetch(`${baseUrl}/notification-sw.js`)).text();
    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    const manifest = await manifestResponse.json();
    assert.equal(body.includes('id="notifications-root"'), true);
    assert.equal(body.includes('rel="manifest"'), true);
    assert.equal(script.includes("send-missed-you-notification"), true);
    assert.equal(script.includes("localStorage"), false);
    assert.equal(worker.includes('addEventListener("push"'), true);
    assert.equal(manifest.display, "standalone");
    assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/u);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
