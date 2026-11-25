import { unzipSync, zipSync, type Zippable } from "fflate";

/**
 * ZIP plaintext used only inside the final `.rdpack`.
 *
 * Contract v1 restricts the archive to flat ASCII entry names at the root,
 * STORE or DEFLATE only, no extra fields, no data descriptors, no encryption,
 * no ZIP64 and no duplicate entries. A song pack has at most four entries
 * (lesson.json + one audio + optional cover + optional story audio); a ReeTalk
 * pack has exactly three (dialogue.json + one audio + one cover).
 *
 * Every entry is packed at the maximum DEFLATE level so the pack is tighter
 * than a standard ZIP: lesson.json and uncompressed sources (WAV PCM) shrink
 * dramatically, and already-compressed containers (MP3/M4A/JPEG) still go
 * through the strongest deflate available.
 */
export const ZIP_MAX_ENTRIES = 4;
export const ZIP_MAX_TOTAL = 252 * 1024 * 1024;
export const ZIP_MAX_PLAINTEXT = 256 * 1024 * 1024;

/**
 * Content profile of the plaintext ZIP.
 *
 * - `lesson`  — song pack: `lesson.json` + one audio + optional cover + optional story (2..4 entries).
 * - `reetalk` — dialogue pack: exactly `dialogue.json` + one audio + one cover (3 entries, cover mandatory).
 */
export type ZipProfile = "lesson" | "reetalk";

/** Maximum DEFLATE level — the pack must beat a standard ZIP, not match it. */
export const MAX_DEFLATE_LEVEL = 9;

export interface ZipEntryInput {
  name:
    | "lesson.json"
    | "dialogue.json"
    | "audio.mp3" | "audio.m4a" | "audio.wav"
    | "cover.jpg" | "cover.png" | "cover.webp"
    | "story.mp3" | "story.m4a" | "story.wav";
  data: Buffer;
  /** Pack the entry with maximum DEFLATE; STORE (false) is only used by tests. */
  compress: boolean;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function validateProfile(entries: ZipEntryInput[], profile: ZipProfile): void {
  const names = entries.map((entry) => entry.name);
  if (profile === "reetalk") {
    if (entries.length !== 3) {
      throw new Error(`a ReeTalk ZIP must contain exactly 3 entries (dialogue.json + audio + cover), found ${entries.length}`);
    }
    if (!names.includes("dialogue.json")) throw new Error("ReeTalk ZIP has no dialogue.json");
    if (names.includes("lesson.json")) throw new Error("a ReeTalk ZIP must not contain lesson.json");
    if (names.some((name) => name.startsWith("story."))) throw new Error("a ReeTalk ZIP must not contain story audio");
    if (!names.some((name) => name.startsWith("audio."))) throw new Error("a ReeTalk ZIP has no audio entry");
    if (!names.some((name) => name.startsWith("cover."))) throw new Error("a ReeTalk ZIP has no cover entry");
    return;
  }
  if (entries.length < 2 || entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP must contain 2..${ZIP_MAX_ENTRIES} entries (lesson + audio + optional cover + optional story audio)`);
  }
  if (!names.includes("lesson.json")) throw new Error("ZIP has no lesson.json");
}

export function buildZip(entries: ZipEntryInput[], profile: ZipProfile = "lesson"): Buffer {
  validateProfile(entries, profile);
  const seen = new Set<string>();
  const zippable: Zippable = {};
  let total = 0;
  for (const entry of entries) {
    if (!SAFE_NAME.test(entry.name)) throw new Error(`unsafe ZIP entry name: ${entry.name}`);
    const lowered = entry.name.toLowerCase();
    if (seen.has(lowered)) throw new Error(`duplicate ZIP entry: ${entry.name}`);
    seen.add(lowered);
    if (entry.data.length === 0) throw new Error(`ZIP entry ${entry.name} is empty`);
    total += entry.data.length;
    zippable[entry.name] = [new Uint8Array(entry.data), { level: entry.compress ? MAX_DEFLATE_LEVEL : 0 }];
  }
  if (total > ZIP_MAX_PLAINTEXT) throw new Error("ZIP plaintext exceeds the 256 MiB contract limit");
  // A fixed in-range timestamp keeps our packs byte-reproducible apart from the
  // random GCM nonce; fflate encodes DOS time and rejects dates < 1980.
  const out = zipSync(zippable, { mtime: new Date("2020-01-01T00:00:00Z") });
  if (out.length > ZIP_MAX_PLAINTEXT) throw new Error("ZIP output exceeds the 256 MiB contract limit");
  return Buffer.from(out);
}

export interface ReadZipResult {
  entries: { name: string; size: number }[];
  files: Record<string, Buffer>;
}

/**
 * Strict reader used to re-open our own output and to validate archives found
 * during a library rescan. It never writes to disk: extraction happens in
 * memory with size and ratio limits, so a hostile archive cannot escape a
 * staging directory (there is no staging directory).
 */
export function readZipStrict(data: Buffer, maxTotal = ZIP_MAX_TOTAL, profile: ZipProfile = "lesson"): ReadZipResult {
  if (data.length > ZIP_MAX_PLAINTEXT) throw new Error("ZIP is larger than 256 MiB");
  const files: Record<string, Buffer> = {};
  let total = 0;
  const entries: { name: string; size: number }[] = [];
  const unzipped = unzipSync(new Uint8Array(data), {
    filter: (file) => {
      const name = file.name;
      if (!SAFE_NAME.test(name)) throw new Error(`unsafe ZIP entry name: ${name}`);
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new Error(`ZIP entry must live at the archive root: ${name}`);
      }
      if (file.originalSize > maxTotal) throw new Error(`ZIP entry ${name} is too large`);
      const compressed = Math.max(file.size, 1);
      const ratio = file.originalSize / compressed;
      const isJson = name.endsWith(".json");
      // Uncompressed WAV PCM legitimately deflates far below its original size;
      // the bound stays far below zip-bomb territory while accepting any real
      // container produced by maximum DEFLATE.
      if (!isJson && ratio > 1000) throw new Error(`suspicious compression ratio for ${name}`);
      return true;
    },
  });
  for (const [name, bytes] of Object.entries(unzipped)) {
    total += bytes.length;
    if (total > maxTotal) throw new Error("extracted ZIP content exceeds the contract limit");
    files[name] = Buffer.from(bytes);
    entries.push({ name, size: bytes.length });
  }
  if (profile === "reetalk") {
    if (entries.length !== 3) {
      throw new Error(`a ReeTalk ZIP must contain exactly 3 entries, found ${entries.length}`);
    }
    if (!files["dialogue.json"]) throw new Error("ZIP has no dialogue.json");
    if (files["lesson.json"]) throw new Error("a ReeTalk ZIP must not contain lesson.json");
    return { entries, files };
  }
  if (entries.length < 2 || entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP must contain 2..${ZIP_MAX_ENTRIES} entries, found ${entries.length}`);
  }
  if (!files["lesson.json"]) throw new Error("ZIP has no lesson.json");
  return { entries, files };
}
