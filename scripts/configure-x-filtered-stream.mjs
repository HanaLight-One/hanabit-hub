import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { buildXStreamRule, getXStreamRules, syncXStreamRule } from "../src/modules/news/x-filtered-stream.mjs";
import { loadXSourceAllowlist } from "../src/modules/news/x-watch-source.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });
const handles = await loadXSourceAllowlist(path.join(PROJECT_ROOT, "config", "news-x-sources.json"));
const rule = buildXStreamRule(handles);
const apply = process.argv.includes("--confirm=sync-hanabit-x-rules");

if (!apply) {
  console.log(JSON.stringify({ apply: false, tag: rule.tag, rule: rule.value }, null, 2));
  process.exit(0);
}

const bearerToken = String(process.env.X_BEARER_TOKEN ?? "").trim();
if (!bearerToken) throw new Error(".env의 X_BEARER_TOKEN이 필요합니다.");
const existingRules = await getXStreamRules({ bearerToken });
const result = await syncXStreamRule({ bearerToken, rule, existingRules });
console.log(JSON.stringify({ ok: true, changed: result.changed, tag: rule.tag }));

