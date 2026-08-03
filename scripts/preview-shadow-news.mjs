import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShadowNewsCollector, loadShadowNewsSources } from "../src/modules/news/shadow-news-collector.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const config = await loadShadowNewsSources(path.join(PROJECT_ROOT, "config", "news-shadow-sources.json"));
const collector = createShadowNewsCollector({
  stateRoot: path.join(PROJECT_ROOT, "state", "news"),
  sources: config.sources,
});
const summary = await collector.collectAll({ dryRun: true });
console.log(JSON.stringify({ dryRun: true, intervalMinutes: config.intervalMinutes, ...summary }, null, 2));
