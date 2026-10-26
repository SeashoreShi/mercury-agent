import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mercury Desktop frontend. The dashboard itself lives in ../../ui/src and
 * is imported here as source (alias "@"), so there is one React UI for the
 * runtime-served dashboard and the desktop app. `dedupe` makes the UI's
 * imports of react/zustand/etc. resolve to THIS package's copies — two
 * React instances would break every hook.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const uiSrc = path.resolve(here, "../../ui/src");
const repoRoot = path.resolve(here, "../..");

// `tauri dev` sets TAURI_DEV_HOST when the frontend is served to a device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: { "@": uiSrc },
    dedupe: ["react", "react-dom", "react-router-dom", "zustand", "framer-motion", "lucide-react"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    fs: { allow: [repoRoot] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses the platform webview: WebView2 on Windows, WebKit elsewhere.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    outDir: "dist",
    chunkSizeWarningLimit: 900,
  },
});
