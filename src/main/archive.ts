import fs from "node:fs";
import path from "node:path";
import type { RescanReport, StagedBundle } from "../shared/types";
import { all, audit, flushNow, run } from "./db";
import { exportRow } from "./projects";
import { sha256Hex } from "./util";
import { writeFileAtomic } from "./paths";
import { exportSummaries } from "./projects";

interface ExportFileRow {
  export_id: string;
  song_id: string;
  version_code: number;
  pack_path: string;
  pack_sha256: string;
  pack_size: number;
  manifest_path: string;
  manifest_sha256: string;
  file_state: string;
}

function walkPacks(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".rdpack")) found.push(target);
    }
  };
  walk(root, 0);
  return found;
}

/**
 * Compare the database to what is actually on disk. Missing or drifted files
 * are reported, never silently re-counted; orphan packs stay untouched and are
 * listed so the operator can decide what to do with them.
 */
export function rescanArchive(archiveRoot: string): RescanReport {
  const rows = all<ExportFileRow>(
    "SELECT export_id, song_id, version_code, pack_path, pack_sha256, pack_size, manifest_path, manifest_sha256, file_state FROM exports",
  );
  const report: RescanReport = { scanned: rows.length, present: 0, missing: [], orphans: [], warnings: [] };
  for (const row of rows) {
    let present = false;
    try {
      const stat = fs.statSync(row.pack_path);
      if (!fs.existsSync(row.manifest_path)) {
        report.warnings.push(`manifest copy is missing for v${row.version_code} ${row.song_id}`);
      }
      if (stat.size !== row.pack_size) {
        report.warnings.push(`pack size changed on disk for v${row.version_code} ${row.song_id}`);
      } else if (stat.size <= 64 * 1024 * 1024) {
        const sha = sha256Hex(fs.readFileSync(row.pack_path));
        if (sha !== row.pack_sha256) {
          report.warnings.push(`pack hash changed on disk for v${row.version_code} ${row.song_id}`);
        } else {
          present = true;
        }
      } else {
        present = true;
      }
    } catch {
      present = false;
    }
    const state = present ? "present" : "missing";
    if (present) report.present += 1;
    else report.missing.push(`${row.song_id} v${row.version_code}`);
    if (state !== row.file_state) {
      run("UPDATE exports SET file_state = ? WHERE export_id = ?", [state, row.export_id]);
    }
  }
  const known = new Set(rows.map((row) => path.resolve(row.pack_path)));
  for (const pack of walkPacks(archiveRoot)) {
    if (!known.has(path.resolve(pack))) report.orphans.push(pack);
  }
  audit("archive", "rescan", "operator", {
    scanned: report.scanned,
    present: report.present,
    missing: report.missing.length,
    orphans: report.orphans.length,
  });
  flushNow();
  return report;
}

/** Copy the immutable pack and manifest into a deploy folder (pack first). */
export function stageExport(exportId: string, folder: string): StagedBundle {
  const row = exportRow(exportId);
  if (!row) throw new Error("export not found");
  const packName = path.basename(row.pack_path);
  const targetPack = path.join(folder, packName);
  fs.mkdirSync(folder, { recursive: true });
  const packBytes = fs.readFileSync(row.pack_path);
  if (fs.existsSync(targetPack)) {
    const existing = sha256Hex(fs.readFileSync(targetPack));
    if (existing !== row.pack_sha256) {
      throw new Error("the target folder already has a different pack with this name; never overwrite a versioned pack");
    }
  } else {
    writeFileAtomic(targetPack, packBytes, 0o444);
  }
  const manifestBytes = fs.readFileSync(row.manifest_path);
  if (sha256Hex(manifestBytes) !== row.manifest_sha256) {
    throw new Error("the stored manifest copy no longer matches its recorded hash");
  }
  const targetManifest = path.join(folder, "latest.json");
  writeFileAtomic(targetManifest, manifestBytes, 0o444);
  audit(exportId, "staged", "operator", { folder, pack: targetPack });
  return {
    folder,
    packPath: targetPack,
    manifestPath: targetManifest,
    packSha256: row.pack_sha256,
  };
}

export { exportSummaries };
