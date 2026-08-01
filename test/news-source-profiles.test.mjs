import assert from "node:assert/strict";
import test from "node:test";
import { createNewsSourceProfileIndex, findNewsSourceProfile } from "../src/modules/news/news-source-profiles.mjs";

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

test("Discord Announcement는 별도 공식 출처 설명을 사용한다", () => {
  const profile = findNewsSourceProfile({ type: "discord-announcement" }, new Map());
  assert.equal(profile.trustLabel, "공식 출처");
  assert.match(profile.whyTracked, /공식 Discord/);
});
