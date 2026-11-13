import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Main + preload are bundled to CommonJS and keep Node dependencies external so
 * electron-builder ships them from `node_modules`. `sql.js` needs its wasm
 * beside the bundle, so it is copied into dist/main.
 */
await build({
  entryPoints: [path.join(root, "src/main/index.ts"), path.join(root, "src/preload/index.ts")],
  outdir: path.join(root, "dist"),
  outbase: path.join(root, "src"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
});

mkdirSync(path.join(root, "dist/main"), { recursive: true });
copyFileSync(path.join(root, "node_modules/sql.js/dist/sql-wasm.wasm"), path.join(root, "dist/main/sql-wasm.wasm"));
console.log("main + preload built, sql-wasm.wasm copied");
