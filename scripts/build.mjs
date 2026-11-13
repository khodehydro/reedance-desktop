import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function step(label, command, args) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

step("building renderer (vite)", process.execPath, [
  path.join(root, "node_modules/vite/bin/vite.js"),
  "build",
]);
step("building main + preload (esbuild)", process.execPath, [path.join(root, "scripts/build-main.mjs")]);
console.log("\n✓ build complete → dist/");
