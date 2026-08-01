import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseSchemaVersion, openHubDatabase } from "../src/modules/database/hub-database.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const database = openHubDatabase({ filePath: path.join(root, "state", "hanabit-hub.sqlite") });
try {
  console.log(JSON.stringify({ ok: true, database: "state/hanabit-hub.sqlite", schemaVersion: databaseSchemaVersion(database) }));
} finally {
  database.close();
}
