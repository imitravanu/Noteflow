import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port so the dev server URL in tauri.conf.json stays valid.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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

