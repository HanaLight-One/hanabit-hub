import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOfficialNewsCollector, loadOfficialNewsSources } from "../src/modules/news/official-news-collector.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const config = await loadOfficialNewsSources(path.join(PROJECT_ROOT, "config", "news-official-sources.json"));
const collector = createOfficialNewsCollector({
  stateRoot: path.join(PROJECT_ROOT, "state", "news"),
  sources: config.sources,
});
const summary = await collector.collectAll({ dryRun: true });
console.log(JSON.stringify({ dryRun: true, intervalMinutes: config.intervalMinutes, ...summary }, null, 2));
