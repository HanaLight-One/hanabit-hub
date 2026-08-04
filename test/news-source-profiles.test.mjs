import assert from "node:assert/strict";
import test from "node:test";
import { createNewsSourceProfileIndex, findNewsSourceProfile } from "../src/modules/news/news-source-profiles.mjs";

test("공식 GitHub 릴리스는 OpenAI 확정 출처 프로필을 사용한다", () => {
  const profile = findNewsSourceProfile({
    type: "official-github-release",
    repository: "openai/codex",
  }, new Map());
  assert.equal(profile.trustLevel, "official");
  assert.equal(profile.affiliationConfirmed, true);
  assert.match(profile.displayName, /openai\/codex/u);
});

const greg = {
  handle: "gdb",
  displayName: "Greg Brockman",
  sourceKind: "person",
  affiliation: "OpenAI",
  affiliationStatus: "confirmed",
  roles: ["president-cofounder", "engineering-leadership"],
  topics: ["engineering", "models", "research"],
  trustLevel: "high",
  verifiedAt: "2026-08-02",
};

test("X 출처 프로필은 인물의 역할과 추적 이유를 공개 문구로 바꾼다", () => {
  const profiles = createNewsSourceProfileIndex({ sources: [greg] });
  const profile = findNewsSourceProfile({ type: "x-post", account: "GDB" }, profiles);
  assert.deepEqual(profile.roles, ["사장·공동 창립자", "엔지니어링 리더십"]);
  assert.deepEqual(profile.topics, ["엔지니어링", "모델", "연구"]);
  assert.match(profile.whyTracked, /핵심 인물/);
  assert.equal(profile.verifiedAt, "2026-08-02");
});

test("제품 변화 관찰 후보는 공식 출처가 아닌 공개 설명을 사용한다", () => {
  const tibor = {
    handle: "btibor91",
    displayName: "Tibor Blaho",
    sourceKind: "candidate",
    affiliation: "AIPRM",
    affiliationStatus: "confirmed",
    roles: ["product-observer"],
    topics: ["chatgpt", "products"],
    trustLevel: "candidate",
    verifiedAt: "2026-08-04",
  };
  const profiles = createNewsSourceProfileIndex({ sources: [tibor] });
  const profile = findNewsSourceProfile({ type: "x-post", account: "btibor91" }, profiles);
  assert.deepEqual(profile.roles, ["제품 변화 관찰"]);
  assert.equal(profile.trustLabel, "관찰 후보");
  assert.match(profile.whyTracked, /초기 변화 신호/);
});

test("Discord Announcement는 별도 공식 출처 설명을 사용한다", () => {
  const profile = findNewsSourceProfile({ type: "discord-announcement" }, new Map());
  assert.equal(profile.trustLabel, "공식 출처");
  assert.match(profile.whyTracked, /공식 Discord/);
});
