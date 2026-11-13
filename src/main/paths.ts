import type { App } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * All mutable state of the studio lives in `userData/studio`:
 *   studio.db            metadata database (SQLite via sql.js, single file)
 *   projects/<id>/       immutable copies of operator-selected audio/cover
 *   raw/<sha>.json       the exact imported draft snapshot (audit trail)
 *   revisions/<id>.json  approved content snapshots
 *   archive/             immutable .rdpack + latest.json output tree
 *   keys/keystore.json   AES/Ed25519 material protected with safeStorage
 *   backups/             passphrase-encrypted key backups
 *
 * The archive folder can be relocated from Settings; nothing is stored in the
 * installer, the repository, or the renderer profile.
 */
function electronApp(): App {
  // Required lazily: tests and the packaging scripts exercise the domain layer
  // in plain Node, where the `electron` module exists but has no running app.
  const loaded = require("electron") as { app: App };
  return loaded.app;
}

export function studioRoot(): string {
  const override = process.env.REEDANCE_STUDIO_ROOT;
  if (override && override.trim()) return path.resolve(override);
  return path.join(electronApp().getPath("userData"), "studio");
}

export function ensureDirs(): void {
  for (const dir of [
    studioRoot(),
    path.join(studioRoot(), "projects"),
    path.join(studioRoot(), "raw"),
    path.join(studioRoot(), "revisions"),
    path.join(studioRoot(), "archive"),
    path.join(studioRoot(), "keys"),
    path.join(studioRoot(), "backups"),
    path.join(studioRoot(), "logs"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function dbFile(): string {
  return path.join(studioRoot(), "studio.db");
}

export function defaultArchiveDir(): string {
  return path.join(studioRoot(), "archive");
}

export function projectDir(projectId: string): string {
  return path.join(studioRoot(), "projects", projectId);
}

export function rawDraftPath(sha256: string): string {
  return path.join(studioRoot(), "raw", `${sha256}.rddraft.json`);
}

export function revisionsDir(): string {
  return path.join(studioRoot(), "revisions");
}

export function keysDir(): string {
  return path.join(studioRoot(), "keys");
}

/** Resolve `target` inside `root`; throws when traversal would escape it. */
export function assertInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes allowed root: ${target}`);
  }
  return resolved;
}

export function readFileLimited(file: string, limitBytes: number): Buffer {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("not a regular file");
  if (stat.size > limitBytes) {
    throw new Error(`file is larger than the allowed ${Math.round(limitBytes / 1024 / 1024)} MiB`);
  }
  return fs.readFileSync(file);
}

/** Write via temp file + fsync + rename so a crash never leaves a torn file. */
export function writeFileAtomic(file: string, data: Buffer | string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, "w", mode ?? 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Windows refuses to replace a file that still carries the read-only
  // attribute (our immutable project copies use mode 0o444), so drop it first.
  if (process.platform === "win32" && fs.existsSync(file)) {
    try {
      fs.chmodSync(file, 0o666);
    } catch {
      // Ignore: the rename below reports the real error.
    }
  }
  fs.renameSync(tmp, file);
  try {
    const dirFd = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is not supported on every platform (Windows); ignore.
  }
}
