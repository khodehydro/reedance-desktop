import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Issue, MediaOutcome, MediaInfo } from "../shared/types";
import { assertInside, projectDir, readFileLimited, writeFileAtomic } from "./paths";

/** Contract v1 media limits. */
export const AUDIO_MAX_BYTES = 240 * 1024 * 1024;
export const COVER_MAX_BYTES = 8 * 1024 * 1024;

export type AudioExtension = "mp3" | "m4a" | "wav";
export type CoverExtension = "jpg" | "png" | "webp";

export interface ProbeResult {
  extension: AudioExtension;
  mimeType: "audio/mpeg" | "audio/mp4" | "audio/wav";
  durationMs: number | null;
  durationSource: "container" | "unknown";
}

const MIME_BY_EXTENSION: Record<AudioExtension, "audio/mpeg" | "audio/mp4" | "audio/wav"> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

const COVER_MIME: Record<CoverExtension, "image/jpeg" | "image/png" | "image/webp"> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Detect the real container from magic bytes; the file name is only a hint. */
export function sniffAudio(buffer: Buffer, fileName: string): AudioExtension {
  if (buffer.length < 12) throw new Error("audio file is too small to be valid");
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    return "wav";
  }
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "mp3";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (/^(M4A|M4B|mp42|isom|iso2|dash|MSNV)/.test(brand)) return "m4a";
  }
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  const lower = fileName.toLowerCase();
  throw new Error(`unsupported audio container (expected MP3, M4A or WAV): ${lower}`);
}

export function sniffCover(buffer: Buffer): CoverExtension {
  if (buffer.length < 12) throw new Error("cover file is too small");
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  throw new Error("unsupported cover format (expected JPG, PNG or WEBP)");
}

function wavDurationMs(buffer: Buffer): number | null {
  try {
    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (offset + 8 <= buffer.length) {
      const id = buffer.subarray(offset, offset + 4).toString("ascii");
      const size = buffer.readUInt32LE(offset + 4);
      if (id === "fmt ") {
        byteRate = buffer.readUInt32LE(offset + 16);
      } else if (id === "data") {
        dataSize = Math.min(size, buffer.length - offset - 8);
      }
      offset += 8 + size + (size % 2);
      if (byteRate && dataSize) break;
    }
    if (byteRate > 0 && dataSize > 0) return Math.round((dataSize / byteRate) * 1000);
    return null;
  } catch {
    return null;
  }
}

function m4aDurationMs(buffer: Buffer): number | null {
  try {
    const index = buffer.indexOf(Buffer.from("mvhd", "ascii"));
    if (index < 0) return null;
    const version = buffer.readUInt8(index + 4);
    if (version === 0) {
      const timescale = buffer.readUInt32BE(index + 16);
      const duration = buffer.readUInt32BE(index + 20);
      if (!timescale) return null;
      return Math.round((duration / timescale) * 1000);
    }
    const timescale = buffer.readUInt32BE(index + 24);
    const duration = Number(buffer.readBigUInt64BE(index + 28));
    if (!timescale) return null;
    return Math.round((duration / timescale) * 1000);
  } catch {
    return null;
  }
}

function mp3DurationMs(buffer: Buffer): number | null {
  // Prefer a Xing/Info VBR header (frames × samples per frame).
  const search = buffer.subarray(0, Math.min(buffer.length, 200_000));
  const xingIndex = search.indexOf(Buffer.from("Xing"));
  const infoIndex = search.indexOf(Buffer.from("Info"));
  const headerIndex = xingIndex >= 0 ? xingIndex : infoIndex;
  const bitratesV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const sampleRatesV1 = [44100, 48000, 32000];

  const findFrame = (): number => {
    for (let i = 0; i + 4 < search.length; i += 1) {
      if (search[i] === 0xff && (search[i + 1] & 0xe0) === 0xe0) return i;
    }
    return -1;
  };
  const frameOffset = findFrame();
  if (frameOffset < 0) return null;
  const b1 = search[frameOffset + 1];
  const b2 = search[frameOffset + 2];
  const b3 = search[frameOffset + 3];
  const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG1
  const layerBits = (b1 >> 1) & 0x03; // 1 = layer III
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (layerBits !== 1) return null;
  const sampleRate = versionBits === 3 ? sampleRatesV1[sampleRateIndex] : sampleRatesV1[sampleRateIndex] / 2;
  if (!sampleRate) return null;

  if (headerIndex >= 0 && headerIndex + 12 <= search.length) {
    const flags = search.readUInt32BE(headerIndex + 4);
    const framesOffset = headerIndex + 8;
    const hasFrames = (flags & 0x00000001) !== 0;
    if (hasFrames) {
      const frames = search.readUInt32BE(framesOffset);
      const samplesPerFrame = versionBits === 3 ? 1152 : 576;
      if (frames > 0) return Math.round(((frames * samplesPerFrame) / sampleRate) * 1000);
    }
  }

  const bitrate = bitratesV1L3[bitrateIndex];
  if (!bitrate) return null;
  const frameLength = Math.floor(((versionBits === 3 ? 144 : 72) * bitrate * 1000) / sampleRate) + padding;
  const id3Size = buffer.subarray(0, 3).toString("ascii") === "ID3"
    ? 10 + ((buffer[6] & 0x7f) << 21) + ((buffer[7] & 0x7f) << 14) + ((buffer[8] & 0x7f) << 7) + (buffer[9] & 0x7f)
    : 0;
  const audioBytes = buffer.length - id3Size;
  if (frameLength <= 0) return null;
  const frames = Math.floor(audioBytes / frameLength);
  const samplesPerFrame = versionBits === 3 ? 1152 : 576;
  return Math.round(((frames * samplesPerFrame) / sampleRate) * 1000);
}

export function probeAudio(buffer: Buffer, fileName: string): ProbeResult {
  const extension = sniffAudio(buffer, fileName);
  let durationMs: number | null = null;
  if (extension === "wav") durationMs = wavDurationMs(buffer);
  else if (extension === "m4a") durationMs = m4aDurationMs(buffer);
  else durationMs = mp3DurationMs(buffer);
  if (durationMs !== null && (durationMs <= 0 || durationMs > 86_400_000)) durationMs = null;
  return {
    extension,
    mimeType: MIME_BY_EXTENSION[extension],
    durationMs,
    durationSource: durationMs === null ? "unknown" : "container",
  };
}

export function hashFile(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export interface ImportedAudio {
  media: MediaInfo;
  outcome: MediaOutcome;
}

/**
 * Copy the operator-selected audio into the immutable project folder.
 *
 * The project copy is what gets exported; deleting or replacing the original
 * file later can never change the pack silently. Replacing audio resets every
 * timeline review mark (handled by the caller).
 */
export function importAudio(projectId: string, sourcePath: string, previous: MediaInfo | null): ImportedAudio {
  const buffer = readFileLimited(sourcePath, AUDIO_MAX_BYTES);
  const probe = probeAudio(buffer, path.basename(sourcePath));
  const sha = hashFile(buffer);
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const target = assertInside(dir, path.join(dir, `audio.${probe.extension}`));
  writeFileAtomic(target, buffer, 0o444);
  // Remove stale copies with another extension so the folder stays unambiguous.
  for (const extension of ["mp3", "m4a", "wav"] as const) {
    if (extension === probe.extension) continue;
    const stale = path.join(dir, `audio.${extension}`);
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }

  const warnings: Issue[] = [];
  if (probe.durationMs === null) {
    warnings.push({
      path: "media.audio.durationMs",
      message: "container duration could not be parsed; the renderer will measure it with the audio decoder",
      severity: "warning",
    });
  }
  if (previous && previous.audioSha256 !== sha) {
    warnings.push({
      path: "timeline",
      message: "audio replaced: every timeline mark and review needs to be redone",
      severity: "warning",
    });
  }

  const media: MediaInfo = {
    audioPath: target,
    audioFileName: `audio.${probe.extension}`,
    audioSha256: sha,
    mimeType: probe.mimeType,
    extension: probe.extension,
    durationMs: probe.durationMs ?? previous?.durationMs ?? 0,
    bytes: buffer.length,
    importedAt: new Date().toISOString(),
    sourceName: path.basename(sourcePath),
    coverPath: previous?.coverPath,
    coverSha256: previous?.coverSha256,
    coverMimeType: previous?.coverMimeType,
    coverExtension: previous?.coverExtension,
    coverBytes: previous?.coverBytes,
  };

  return {
    media,
    outcome: {
      media,
      warnings,
      durationSource: probe.durationSource === "container" ? "container" : "unknown",
    },
  };
}

export function importCover(projectId: string, sourcePath: string, media: MediaInfo): MediaInfo {
  const buffer = readFileLimited(sourcePath, COVER_MAX_BYTES);
  const extension = sniffCover(buffer);
  const sha = hashFile(buffer);
  const dir = projectDir(projectId);
  const target = assertInside(dir, path.join(dir, `cover.${extension}`));
  writeFileAtomic(target, buffer, 0o444);
  for (const other of ["jpg", "png", "webp"] as const) {
    if (other === extension) continue;
    const stale = path.join(dir, `cover.${other}`);
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }
  return {
    ...media,
    coverPath: target,
    coverSha256: sha,
    coverMimeType: COVER_MIME[extension],
    coverExtension: extension,
    coverBytes: buffer.length,
  };
}

/** Duration measured by Chromium's decoder when the container has no header. */
export function withMeasuredDuration(media: MediaInfo, durationMs: number): MediaInfo {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 86_400_000) {
    throw new Error("measured duration is out of range");
  }
  return { ...media, durationMs: Math.round(durationMs) };
}

export { COVER_MIME, MIME_BY_EXTENSION };
