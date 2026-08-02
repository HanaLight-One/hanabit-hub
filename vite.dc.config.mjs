import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: path.join(root, "public", "dc"),
    lib: {
      entry: path.join(root, "frontend", "dc", "main.jsx"),
      formats: ["es"],
      fileName: () => "app.js",
    },
  },
});
