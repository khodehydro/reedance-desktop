import { unzipSync, zipSync, type Zippable } from "fflate";

/**
 * ZIP plaintext used only inside the final `.rdpack`.
 *
 * Contract v1 restricts the archive to flat ASCII entry names at the root,
 * STORE or DEFLATE only, no extra fields, no data descriptors, no encryption,
 * no ZIP64, no duplicate entries and at most three entries
 * (lesson.json + one audio + optional cover).
 */
export const ZIP_MAX_ENTRIES = 3;
export const ZIP_MAX_TOTAL = 252 * 1024 * 1024;
export const ZIP_MAX_PLAINTEXT = 256 * 1024 * 1024;

export interface ZipEntryInput {
  name: "lesson.json" | "audio.mp3" | "audio.m4a" | "audio.wav" | "cover.jpg" | "cover.png" | "cover.webp";
  data: Buffer;
  /** Compress JSON with DEFLATE, keep already-compressed media STORE. */
  compress: boolean;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function buildZip(entries: ZipEntryInput[]): Buffer {
  if (entries.length < 2 || entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP must contain 2..${ZIP_MAX_ENTRIES} entries (lesson + audio + optional cover)`);
  }
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
    zippable[entry.name] = [new Uint8Array(entry.data), { level: entry.compress ? 6 : 0 }];
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
export function readZipStrict(data: Buffer, maxTotal = ZIP_MAX_TOTAL): ReadZipResult {
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
      if (!isJson && ratio > 100) throw new Error(`suspicious compression ratio for ${name}`);
      return true;
    },
  });
  for (const [name, bytes] of Object.entries(unzipped)) {
    total += bytes.length;
    if (total > maxTotal) throw new Error("extracted ZIP content exceeds the contract limit");
    files[name] = Buffer.from(bytes);
    entries.push({ name, size: bytes.length });
  }
  if (entries.length < 2 || entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP must contain 2..${ZIP_MAX_ENTRIES} entries, found ${entries.length}`);
  }
  if (!files["lesson.json"]) throw new Error("ZIP has no lesson.json");
  return { entries, files };
}
