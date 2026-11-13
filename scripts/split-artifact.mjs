import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Split the built installer into transport chunks.
 *
 * The Windows installer is produced on GitHub Actions, but the sandbox that
 * drives this repository can only reach `github.com` — not release assets or
 * action artifacts (both live on Azure/GitHub CDN hosts). Committing chunks to
 * the branch and fetching them with git is therefore the transport. This script
 * is only used by CI; the chunks and the installer never stay in the repository.
 */
const CHUNK = 45_000_000;
const releaseDir = path.resolve("release");
const outDir = path.resolve(".transport");

const installers = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((file) => file.endsWith(".exe"))
  : [];

if (installers.length === 0) {
  console.error("no installer found in release/");
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const file of installers) {
  const full = path.join(releaseDir, file);
  const bytes = fs.readFileSync(full);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const parts = Math.ceil(bytes.length / CHUNK) || 1;
  for (let index = 0; index < parts; index += 1) {
    const slice = bytes.subarray(index * CHUNK, Math.min((index + 1) * CHUNK, bytes.length));
    fs.writeFileSync(path.join(outDir, `${file}.part-${String(index).padStart(2, "0")}`), slice);
  }
  manifest.push(`${sha}  ${file}`);
  console.log(`${file}: ${bytes.length} bytes, sha256 ${sha}, ${parts} chunk(s)`);
}

for (const extra of ["latest.yml", "builder-effective-config.yaml"]) {
  const source = path.join(releaseDir, extra);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(outDir, extra));
}
fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${manifest.join("\n")}\n`);
