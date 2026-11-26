import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assembleLesson } from "../src/main/lesson";
import {
  DURATION_TOLERANCE_MS,
  mp3DurationMs,
  parseMp3Frame,
  probeAudio,
  reconcileDecodedDuration,
} from "../src/main/media";
import { assembleDialogue } from "../src/main/reetalk";
import { activeIndexAt, resolveTimings, revealedCountAt } from "../src/shared/timing";
import type { DraftContent, LyricMark, MediaInfo, ReetalkDraft, RightsChecklist } from "../src/shared/types";

/* ------------------------------------------------------------------ */
/* Synthetic MP3 streams                                              */
/* ------------------------------------------------------------------ */

/** MPEG-1 Layer III, 44.1 kHz, stereo frame header for a bitrate index. */
function frame(bitrateIndex: number, padding = 0): Buffer {
  const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bitrateIndex];
  const length = Math.floor((144 * kbps * 1000) / 44100) + padding;
  const data = Buffer.alloc(length, 0x00);
  data[0] = 0xff;
  data[1] = 0xfb; // MPEG-1, Layer III, no CRC
  data[2] = (bitrateIndex << 4) | (0 << 2) | (padding << 1); // 44.1 kHz
  data[3] = 0x00; // stereo
  return data;
}

/** An ID3v2 tag whose payload contains fake frame syncs, like embedded album art. */
function id3WithFakeSyncs(size: number): Buffer {
  const payload = Buffer.alloc(size, 0x20);
  for (let offset = 50; offset + 4 < size; offset += 997) {
    // A plausible but isolated header (MPEG-2 Layer III, 8 kbps): the old
    // parser took the first of these as the stream's format.
    payload[offset] = 0xff;
    payload[offset + 1] = 0xf3;
    payload[offset + 2] = 0x14;
    payload[offset + 3] = 0xc4;
  }
  const header = Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f,
  ]);
  return Buffer.concat([header, payload]);
}

const SAMPLES_PER_FRAME = 1152;
const msFor = (frames: number) => Math.round(((frames * SAMPLES_PER_FRAME) / 44100) * 1000);

test("mp3: frame header parsing covers bitrate, padding and length", () => {
  const header = parseMp3Frame(frame(9), 0);
  assert.ok(header);
  assert.equal(header.version, 1);
  assert.equal(header.layer, 3);
  assert.equal(header.sampleRate, 44100);
  assert.equal(header.samples, 1152);
  assert.equal(header.length, 417);
  assert.equal(parseMp3Frame(frame(9, 1), 0)?.length, 418);
  assert.equal(parseMp3Frame(Buffer.from([0xff, 0xfb, 0xf0, 0x00]), 0), null, "bitrate index 15 is invalid");
});

test("mp3: fake syncs inside a big ID3 tag (album art) do not change the duration", () => {
  const frames = Array.from({ length: 900 }, () => frame(9));
  const audio = Buffer.concat([id3WithFakeSyncs(300_000), ...frames]);
  assert.equal(mp3DurationMs(audio), msFor(900));
  assert.equal(probeAudio(audio, "song.mp3").durationMs, msFor(900));
});

test("mp3: VBR without a Xing header is measured by walking every frame", () => {
  // 128 kbps intro followed by a long 320 kbps body: the old single-frame CBR
  // estimate would be 2.5× too long.
  const frames = [...Array.from({ length: 50 }, () => frame(9)), ...Array.from({ length: 1150 }, (_, i) => frame(14, i % 3 === 0 ? 1 : 0))];
  const audio = Buffer.concat([id3WithFakeSyncs(4096), ...frames, Buffer.from("TAG".padEnd(128, " "))]);
  assert.equal(mp3DurationMs(audio), msFor(1200));
});

test("mp3: a Xing/Info frame count is used when present", () => {
  const xing = frame(9);
  // MPEG-1 stereo: side info is 32 bytes after the 4-byte header.
  xing.write("Xing", 36, "latin1");
  xing.writeUInt32BE(0x1, 40);
  xing.writeUInt32BE(5000, 44);
  const audio = Buffer.concat([xing, ...Array.from({ length: 20 }, () => frame(9))]);
  assert.equal(mp3DurationMs(audio), msFor(5000));
});

test("mp3: junk between frames is skipped without losing the stream", () => {
  const frames = Array.from({ length: 400 }, () => frame(9));
  const audio = Buffer.concat([...frames.slice(0, 200), Buffer.alloc(733, 0x11), ...frames.slice(200)]);
  assert.equal(mp3DurationMs(audio), msFor(400));
});

/* ------------------------------------------------------------------ */
/* Decoder reconciliation                                             */
/* ------------------------------------------------------------------ */

const baseMedia: MediaInfo = {
  audioPath: "/tmp/audio.mp3",
  audioFileName: "audio.mp3",
  audioSha256: "a".repeat(64),
  mimeType: "audio/mpeg",
  extension: "mp3",
  durationMs: 60_000,
  bytes: 1,
  importedAt: new Date(0).toISOString(),
  sourceName: "audio.mp3",
};

test("a decoder duration that disagrees with the container replaces it", () => {
  assert.equal(reconcileDecodedDuration(baseMedia, 60_000 + DURATION_TOLERANCE_MS, "audio"), null, "within tolerance: unchanged");
  const fixed = reconcileDecodedDuration(baseMedia, 74_321.4, "audio");
  assert.equal(fixed?.durationMs, 74_321);
  assert.equal(reconcileDecodedDuration({ ...baseMedia, durationMs: 0 }, 5000, "audio")?.durationMs, 5000);
  assert.throws(() => reconcileDecodedDuration(baseMedia, Number.NaN, "audio"), /out of range/);
  assert.throws(() => reconcileDecodedDuration(baseMedia, 1000, "story-audio"), /no story audio/);
  const story = { ...baseMedia, storyAudioPath: "/tmp/story.mp3", storyAudioDurationMs: 9000 };
  assert.equal(reconcileDecodedDuration(story, 12_000, "story-audio")?.storyAudioDurationMs, 12_000);
  assert.equal(reconcileDecodedDuration(story, 9100, "story-audio"), null);
});

/* ------------------------------------------------------------------ */
/* Renderer timing resolver == exporters                              */
/* ------------------------------------------------------------------ */

const fixtures = path.join(__dirname, "..", "contracts", "fixtures");
const rights: RightsChecklist = {
  audioRights: true,
  lyricsRights: true,
  coverRights: true,
  offlineDownloadAllowed: true,
  demoAudioDisclosure: true,
  evidenceRef: "test",
  notes: "",
  audioCredit: "test",
  coverCredit: "test",
};

test("resolveTimings reproduces the song exporter's endMs exactly", () => {
  const base = JSON.parse(fs.readFileSync(path.join(fixtures, "quiet-step.rddraft.json"), "utf8")) as DraftContent;
  const template = base.lyrics[0];
  const draft: DraftContent = {
    ...base,
    lyrics: Array.from({ length: 5 }, (_, index) => ({ ...template, id: `line-${index + 1}` })),
  };
  const media = { ...baseMedia, extension: "wav" as const, audioFileName: "audio.wav", mimeType: "audio/wav", durationMs: 10_000 };
  const marks: LyricMark[] = [
    { lineId: "line-1", startMs: 0, endMs: null },
    { lineId: "line-2", startMs: 1500, endMs: 2500 }, // recorded end, then silence
    { lineId: "line-3", startMs: 4000, endMs: null },
    { lineId: "line-4", startMs: 6000, endMs: null },
    { lineId: "line-5", startMs: 8000, endMs: null },
  ] as LyricMark[];
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  const record = Object.fromEntries(marks.map((mark) => [mark.lineId, mark]));
  const resolved = resolveTimings(draft.lyrics.map((line) => line.id), record, media.durationMs);
  assert.deepEqual(
    resolved.map((timing) => [timing.startMs, timing.endMs]),
    lesson.lyrics.map((line) => [line.startMs, line.endMs]),
  );
  assert.deepEqual(resolved.map((timing) => timing.endSource), ["next", "recorded", "next", "next", "duration"]);
  assert.ok(resolved.every((timing) => timing.problems.length === 0));

  assert.equal(activeIndexAt(resolved, 2000), 1);
  assert.equal(activeIndexAt(resolved, 3000), -1, "inside the recorded silence gap nothing is active");
  assert.equal(activeIndexAt(resolved, 9999), 4);
  assert.equal(revealedCountAt(resolved, 3000), 2);
  assert.equal(revealedCountAt(resolved, 8000), 5);
});

test("resolveTimings reproduces the ReeTalk exporter and flags what the export rejects", () => {
  const draft = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "reetalk-en-t01-s01.json"), "utf8")) as ReetalkDraft;
  const media: MediaInfo = {
    ...baseMedia,
    durationMs: 20_000,
    coverPath: "/tmp/cover.png",
    coverSha256: "b".repeat(64),
    coverMimeType: "image/png",
    coverExtension: "png",
    coverBytes: 10,
  };
  const marks = draft.turns.map((turn, index) => ({
    lineId: turn.id,
    startMs: index * 2000,
    endMs: index === 2 ? 5000 : null,
  })) as LyricMark[];
  const dialogue = assembleDialogue({ draft, marks, media, contentVersionCode: 1 });
  const record = Object.fromEntries(marks.map((mark) => [mark.lineId, mark]));
  const ids = draft.turns.map((turn) => turn.id);
  const resolved = resolveTimings(ids, record, media.durationMs);
  assert.deepEqual(
    resolved.map((timing) => [timing.startMs, timing.endMs]),
    dialogue.turns.map((turn) => [turn.startMs, turn.endMs]),
  );

  // The exact error the operator hit: a start at/after the (wrong) duration.
  const late = resolveTimings(ids, { ...record, [ids[5]]: { startMs: 25_000, endMs: null } }, media.durationMs);
  assert.ok(late[5].problems.includes("start-outside-audio"));
  assert.ok(late[6].problems.includes("starts-before-previous"));

  const overlap = resolveTimings(ids, { ...record, [ids[1]]: { startMs: 2000, endMs: 4500 } }, media.durationMs);
  assert.ok(overlap[1].problems.includes("overlaps-next"));

  const missing = resolveTimings(ids, { ...record, [ids[3]]: { startMs: null, endMs: null } }, media.durationMs);
  assert.deepEqual(missing[3].problems, ["no-start"]);
  assert.equal(missing[2].endMs, 5000, "a recorded end is kept even when the next start is missing");
  assert.equal(missing[2].endSource, "recorded");
});
