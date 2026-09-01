import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// package.json is the single source of truth for the app version, so the
// About panel and backup metadata can never drift from the manifests.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

// Tauri expects a fixed dev port so the dev server URL in tauri.conf.json stays valid.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // WebKitGTK 2.52 (the Tauri webview) fully supports ES2022.
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
});

