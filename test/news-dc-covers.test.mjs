import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { APP_ROOT } from "../src/config.mjs";
import { createNewsDcCoverCatalog } from "../src/modules/news/news-dc-covers.mjs";

test("네 말머리 기본 커버는 Git 자산 폴더의 PNG만 반환한다", async () => {
  const catalog = createNewsDcCoverCatalog({
    root: path.join(APP_ROOT, "assets", "news", "dc-covers"),
  });
  for (const [headText, id, filename] of [
    ["뉴스/소식", "news", "news.png"],
    ["💡 정보", "information", "information.png"],
    ["잡담", "chatter", "chatter.png"],
    ["AI창작", "ai-creation", "ai-creation.png"],
  ]) {
    const cover = await catalog.forHeadText(headText);
    assert.equal(cover.id, id);
    assert.equal(cover.filename, filename);
    assert.equal(cover.contentType, "image/png");
    assert.equal(cover.size > 0, true);
    assert.equal(cover.target.startsWith(path.join(APP_ROOT, "assets", "news", "dc-covers")), true);
  }
  assert.equal(await catalog.find("unknown"), null);
  assert.throws(() => createNewsDcCoverCatalog({ root: "relative" }), /절대경로/u);
});
