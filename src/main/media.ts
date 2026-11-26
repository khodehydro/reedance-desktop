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

/* ---------------------------------------------------------------- */
/* MP3: exact duration from the frame stream.                        */
/* ---------------------------------------------------------------- */

const MP3_BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps by index (0 = free format, unsupported here).
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

export interface Mp3Frame {
  /** 1 = MPEG-1, 2 = MPEG-2, 25 = MPEG-2.5 */
  version: 1 | 2 | 25;
  layer: 1 | 2 | 3;
  sampleRate: number;
  samples: number;
  length: number;
  mono: boolean;
}

/** Parse a 4-byte MPEG audio frame header; null when it is not a valid one. */
export function parseMp3Frame(buffer: Buffer, offset: number): Mp3Frame | null {
  if (offset + 4 > buffer.length) return null;
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  const b3 = buffer[offset + 3];
  if (buffer[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (versionBits === 1 || layerBits === 0) return null;
  const version: 1 | 2 | 25 = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
  const padding = (b2 >> 1) & 0x01;
  const bitrate = MP3_BITRATES[`${version === 1 ? 1 : 2}-${layer}`][bitrateIndex] * 1000;
  const sampleRate = MP3_SAMPLE_RATES[version][sampleRateIndex];
  let samples: number;
  let length: number;
  if (layer === 1) {
    samples = 384;
    length = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  } else {
    samples = layer === 3 && version !== 1 ? 576 : 1152;
    const coefficient = layer === 3 && version !== 1 ? 72 : 144;
    length = Math.floor((coefficient * bitrate) / sampleRate) + padding;
  }
  if (length < 24) return null;
  return { version, layer, sampleRate, samples, length, mono: ((b3 >> 6) & 0x03) === 3 };
}

/** Bytes taken by leading ID3v2 tags (there can be more than one). */
function id3v2Size(buffer: Buffer): number {
  let offset = 0;
  while (offset + 10 <= buffer.length && buffer.subarray(offset, offset + 3).toString("latin1") === "ID3") {
    const size =
      ((buffer[offset + 6] & 0x7f) << 21) |
      ((buffer[offset + 7] & 0x7f) << 14) |
      ((buffer[offset + 8] & 0x7f) << 7) |
      (buffer[offset + 9] & 0x7f);
    const footer = (buffer[offset + 5] & 0x10) !== 0 ? 10 : 0;
    offset += 10 + size + footer;
  }
  return Math.min(offset, buffer.length);
}

function sameStream(a: Mp3Frame, b: Mp3Frame): boolean {
  return a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate;
}

/**
 * First real frame after the tags: a header whose successor (at exactly
 * header + frame length) is another header of the same stream. Album art and
 * tag payloads are full of 0xFFEx byte pairs, so a single header match is not
 * enough — that was the old parser's bug and produced durations that were
 * seconds or minutes off.
 */
function firstMp3Frame(buffer: Buffer, from: number): { offset: number; frame: Mp3Frame } | null {
  const limit = Math.min(buffer.length - 4, from + 2_000_000);
  for (let offset = from; offset <= limit; offset += 1) {
    if (buffer[offset] !== 0xff) continue;
    const frame = parseMp3Frame(buffer, offset);
    if (!frame) continue;
    const nextOffset = offset + frame.length;
    if (nextOffset === buffer.length) return { offset, frame };
    const next = parseMp3Frame(buffer, nextOffset);
    if (next && sameStream(frame, next)) return { offset, frame };
  }
  return null;
}

/** Frame count from a Xing/Info or VBRI header inside the first frame, if present. */
function vbrHeaderFrames(buffer: Buffer, offset: number, frame: Mp3Frame): number | null {
  if (frame.layer === 3) {
    const sideInfo = frame.version === 1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
    const xing = offset + 4 + sideInfo;
    if (xing + 12 <= buffer.length) {
      const tag = buffer.subarray(xing, xing + 4).toString("latin1");
      if (tag === "Xing" || tag === "Info") {
        const flags = buffer.readUInt32BE(xing + 4);
        if ((flags & 0x1) !== 0) {
          const frames = buffer.readUInt32BE(xing + 8);
          if (frames > 0) return frames;
        }
      }
    }
  }
  const vbri = offset + 4 + 32;
  if (vbri + 18 <= buffer.length && buffer.subarray(vbri, vbri + 4).toString("latin1") === "VBRI") {
    const frames = buffer.readUInt32BE(vbri + 14);
    if (frames > 0) return frames;
  }
  return null;
}

/**
 * Exact MP3 duration. Uses the encoder's Xing/Info/VBRI frame count when it is
 * there; otherwise walks every frame header and sums the samples, which is
 * exact for CBR and VBR alike (a 240 MiB file is well under a million frames).
 */
export function mp3DurationMs(buffer: Buffer): number | null {
  const first = firstMp3Frame(buffer, id3v2Size(buffer));
  if (!first) return null;
  const { frame: head } = first;
  const declared = vbrHeaderFrames(buffer, first.offset, head);
  if (declared !== null) return Math.round(((declared * head.samples) / head.sampleRate) * 1000);

  let samples = 0;
  let offset = first.offset;
  while (offset + 4 <= buffer.length) {
    const frame = parseMp3Frame(buffer, offset);
    if (frame && sameStream(frame, head) && offset + frame.length <= buffer.length + frame.length / 2) {
      samples += frame.samples;
      offset += frame.length;
      continue;
    }
    // Trailing tags end the stream; anything else is junk to resync over.
    const marker = buffer.subarray(offset, offset + 8).toString("latin1");
    if (marker.startsWith("TAG") || marker === "APETAGEX" || marker.startsWith("LYRICS")) break;
    const resync = firstMp3Frame(buffer, offset + 1);
    if (!resync || !sameStream(resync.frame, head) || resync.offset - offset > 65_536) break;
    offset = resync.offset;
  }
  if (samples === 0) return null;
  return Math.round((samples / head.sampleRate) * 1000);
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
    // A different file must never inherit the old file's length (that made
    // valid marks look "outside the audio"). Re-importing the very same file
    // keeps the stored value, which may already be the decoder-measured one.
    durationMs: previous && previous.audioSha256 === sha && previous.durationMs > 0 ? previous.durationMs : (probe.durationMs ?? 0),
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

/**
 * Copy the operator-selected story narration audio into the immutable project
 * folder as `story.<ext>`. Same rules as the song audio: the project copy is
 * what gets exported, the container is sniffed from magic bytes and the
 * duration comes from the container header when parseable.
 */
export function importStoryAudio(projectId: string, sourcePath: string, previous: MediaInfo): MediaInfo {
  const buffer = readFileLimited(sourcePath, AUDIO_MAX_BYTES);
  const probe = probeAudio(buffer, path.basename(sourcePath));
  const sha = hashFile(buffer);
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const target = assertInside(dir, path.join(dir, `story.${probe.extension}`));
  writeFileAtomic(target, buffer, 0o444);
  for (const extension of ["mp3", "m4a", "wav"] as const) {
    if (extension === probe.extension) continue;
    const stale = path.join(dir, `story.${extension}`);
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }
  return {
    ...previous,
    storyAudioPath: target,
    storyAudioFileName: `story.${probe.extension}`,
    storyAudioSha256: sha,
    storyAudioMimeType: probe.mimeType,
    storyAudioExtension: probe.extension,
    storyAudioDurationMs:
      previous.storyAudioSha256 === sha && (previous.storyAudioDurationMs ?? 0) > 0
        ? previous.storyAudioDurationMs
        : (probe.durationMs ?? 0),
    storyAudioBytes: buffer.length,
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

/**
 * The decoder is the ground truth for what the operator hears: the timeline's
 * waveform, playhead and capture times all come from Chromium's decode of the
 * same project file. Container headers can be wrong (VBR without a Xing frame,
 * broken muxers), and a too-short duration makes legitimate marks fail with
 * "outside the audio" while the waveform is stretched over the wrong width.
 * A decoder measurement that disagrees with the stored value by more than
 * this tolerance replaces it.
 */
export const DURATION_TOLERANCE_MS = 250;

export function reconcileDecodedDuration(
  media: MediaInfo,
  measuredMs: number,
  kind: "audio" | "story-audio",
): MediaInfo | null {
  if (!Number.isFinite(measuredMs) || measuredMs <= 0 || measuredMs > 86_400_000) {
    throw new Error("measured duration is out of range");
  }
  const measured = Math.round(measuredMs);
  if (kind === "story-audio") {
    if (!media.storyAudioPath) throw new Error("no story audio selected");
    const stored = media.storyAudioDurationMs ?? 0;
    if (stored > 0 && Math.abs(stored - measured) <= DURATION_TOLERANCE_MS) return null;
    return { ...media, storyAudioDurationMs: measured };
  }
  if (media.durationMs > 0 && Math.abs(media.durationMs - measured) <= DURATION_TOLERANCE_MS) return null;
  return { ...media, durationMs: measured };
}

export { COVER_MIME, MIME_BY_EXTENSION };
