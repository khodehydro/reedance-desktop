import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The production renderer is loaded from `file://` inside Electron, so the CSP
 * is injected into the built HTML. The dev server (used for the browser mock
 * preview) intentionally runs without it because Vite injects inline scripts.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: rdmedia:",
  "media-src 'self' blob: rdmedia:",
  "font-src 'self' data:",
  "connect-src 'self' rdmedia:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "reedance-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<!--CSP-->",
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // The browser preview is served through a proxied *.e2b.app host, so the
    // dev server must accept it instead of rejecting unknown Host headers.
    allowedHosts: true,
    cors: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome130",
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: path.resolve(__dirname, "src/renderer/index.html"),
    },
  },
});
