import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { DraftContent, LyricMark, MediaInfo, RightsChecklist } from "../src/shared/types";
import { decryptPack, parsePackHeader } from "../src/main/crypto/pack";
import { buildZip, readZipStrict, MAX_DEFLATE_LEVEL } from "../src/main/crypto/zip";
import { getAesKey, PACK_KEY_ID, SIGNING_KEY_ID } from "../src/main/keys";
import { importDraftFile } from "../src/main/import";
import { importAudio, importStoryAudio } from "../src/main/media";
import { getProjectDetail, readMedia, saveMarks, saveMedia, saveRights } from "../src/main/projects";
import { runExport } from "../src/main/exporter";
import { closeDatabase, openDatabase } from "../src/main/db";
import { sha256Hex } from "../src/main/util";
import { assembleLesson } from "../src/main/lesson";
import { validateLessonSemantics, validateLessonStructure } from "../src/main/validation";

const repo = path.join(__dirname, "..");
const fixtures = path.join(repo, "contracts", "fixtures");
const draft = JSON.parse(
  fs.readFileSync(path.join(fixtures, "quiet-step.rddraft.json"), "utf8"),
) as DraftContent;

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-story-audio-test-"));
const archiveRoot = path.join(workspace, "archive");
process.env.REEDANCE_STUDIO_ROOT = workspace;
process.env.REEDANCE_SQL_WASM_DIR = path.join(repo, "node_modules", "sql.js", "dist");
process.env.REEDANCE_CONTRACTS_DIR = path.join(repo, "contracts");

const rights: RightsChecklist = {
  audioRights: true,
  lyricsRights: true,
  coverRights: false,
  offlineDownloadAllowed: true,
  demoAudioDisclosure: true,
  evidenceRef: "demo-licence-2026-01",
  notes: "Silent fixture audio, cleared for internal testing.",
  audioCredit: "Silent fixture audio",
  coverCredit: "",
};

let projectId = "";
let media: MediaInfo;

const marks: LyricMark[] = [
  { lineId: "line-1", startMs: 0, endMs: null, reviewed: false, reviewedAudioSha: null, reviewedLineSha: null },
  { lineId: "line-2", startMs: 2000, endMs: null, reviewed: false, reviewedAudioSha: null, reviewedLineSha: null },
];

before(async () => {
  await openDatabase();
});

after(() => {
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("importing a story audio file copies it into the project as story.<ext>", () => {
  const result = importDraftFile(path.join(fixtures, "quiet-step.rddraft.json"));
  projectId = result.projectId;
  const audioImport = importAudio(projectId, path.join(fixtures, "audio.wav"), null).media;
  media = audioImport.durationMs > 0 ? audioImport : { ...audioImport, durationMs: 4000 };
  saveMedia(projectId, media, true);

  const imported = importStoryAudio(projectId, path.join(fixtures, "audio.wav"), media);
  assert.equal(imported.storyAudioFileName, "story.wav");
  assert.equal(imported.storyAudioExtension, "wav");
  assert.equal(imported.storyAudioMimeType, "audio/wav");
  assert.equal(imported.storyAudioSha256, sha256Hex(fs.readFileSync(path.join(fixtures, "audio.wav"))));
  const storyPath = imported.storyAudioPath!;
  assert.ok(fs.existsSync(storyPath), "the story audio copy lives in the project folder");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(storyPath).mode & 0o777, 0o444);
  }

  // A different container replaces the previous one instead of stacking files.
  const mp3ish = Buffer.concat([Buffer.from("ID3\x04\x00\x00", "binary"), Buffer.alloc(256)]);
  const stale = path.join(path.dirname(storyPath), "story.wav");
  assert.ok(fs.existsSync(stale));
  const mp3File = path.join(workspace, "voice.mp3");
  fs.writeFileSync(mp3File, mp3ish);
  const replaced = importStoryAudio(projectId, mp3File, imported);
  assert.equal(replaced.storyAudioFileName, "story.mp3");
  assert.ok(!fs.existsSync(stale), "the previous story.wav is removed");
  assert.ok(fs.existsSync(path.join(path.dirname(storyPath), "story.mp3")));
  // Restore the wav story audio for the export tests.
  const restored = importStoryAudio(projectId, path.join(fixtures, "audio.wav"), replaced);
  media = { ...restored, durationMs: media.durationMs };
  saveMedia(projectId, media, false);
});

test("the media row persists the story audio columns and readMedia returns them", () => {
  const read = readMedia(projectId);
  assert.ok(read, "media row must exist");
  assert.equal(read.media.storyAudioFileName, "story.wav");
  assert.equal(read.media.storyAudioSha256, media.storyAudioSha256);
  assert.equal(read.media.storyAudioMimeType, "audio/wav");
  assert.ok((read.media.storyAudioDurationMs ?? 0) > 0);
});

test("the export gate opens once audio, marks and rights are complete", () => {
  const detail = getProjectDetail(projectId);
  const markIds = (detail.content as DraftContent).lyrics.map((line) => line.id);
  saveMarks(
    projectId,
    markIds.map((lineId, index) => ({ lineId, startMs: index * 1000, endMs: null })),
    media,
    draft,
  );
  saveRights(projectId, rights);
  const detailAfter = getProjectDetail(projectId);
  assert.ok(detailAfter.marks.length > 0);
  assert.equal(detailAfter.summary.state, "sync-incomplete");
});

test("the exported pack ships the story audio at maximum DEFLATE and lesson.json references it", () => {
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  assert.ok(lesson.media.storyAudio, "assembleLesson must map the story audio into lesson.json");
  assert.equal(lesson.media.storyAudio.path, "story.wav");
  assert.equal(lesson.media.storyAudio.sha256, media.storyAudioSha256);
  assert.equal(lesson.media.storyAudio.mimeType, "audio/wav");
  assert.equal(lesson.media.storyAudio.durationMs, Math.round(media.storyAudioDurationMs ?? 0));
  assert.deepEqual(validateLessonStructure(lesson), []);
  assert.deepEqual(
    validateLessonSemantics(lesson, media.durationMs, media.audioSha256).filter((issue) => issue.severity === "error"),
    [],
  );

  const enc = PACK_KEY_ID;
  const sig = SIGNING_KEY_ID;
  const outcome = runExport(
    projectId,
    { encryptionKeyId: enc, signatureKeyId: sig, displayVersion: "1.0.0", manifestBaseUrl: "" },
    { archiveRoot },
  );

  const packBytes = fs.readFileSync(outcome.packPath);
  const { plaintext } = decryptPack(packBytes, getAesKey(enc));
  const zip = readZipStrict(plaintext);
  assert.deepEqual(
    zip.entries.map((entry) => entry.name),
    ["lesson.json", "audio.wav", "story.wav"],
  );
  assert.equal(sha256Hex(zip.files["story.wav"]), media.storyAudioSha256, "the pack carries the exact story audio bytes");
  const packedLesson = JSON.parse(zip.files["lesson.json"].toString("utf8"));
  assert.equal(packedLesson.media.storyAudio.path, "story.wav");
  assert.equal(packedLesson.media.storyAudio.sha256, media.storyAudioSha256);
});

test("story audio validation rejects an impossible duration and a bad path", () => {
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  const broken = JSON.parse(JSON.stringify(lesson)) as typeof lesson;
  broken.media.storyAudio = { ...broken.media.storyAudio!, durationMs: 0 };
  assert.ok(
    validateLessonSemantics(broken, media.durationMs, media.audioSha256).some(
      (issue) => issue.path === "media.storyAudio.durationMs" && issue.severity === "error",
    ),
    "a zero story duration must fail",
  );
  broken.media.storyAudio = {
    ...broken.media.storyAudio!,
    durationMs: 3_600_000,
    path: "narration.ogg",
  } as unknown as NonNullable<typeof broken.media.storyAudio>;
  const issues = validateLessonSemantics(broken, media.durationMs, media.audioSha256);
  assert.ok(
    issues.some((issue) => issue.path === "media.storyAudio.path" && issue.severity === "error"),
    "a non-contract story path must fail",
  );
});

test("buildZip packs every entry at maximum DEFLATE, tighter than STORE", () => {
  assert.equal(MAX_DEFLATE_LEVEL, 9);
  const lessonBytes = Buffer.from(JSON.stringify({ text: "story ".repeat(5000) }), "utf8");
  const audioBytes = Buffer.alloc(4096, 0x41);
  const zipped = buildZip([
    { name: "lesson.json", data: lessonBytes, compress: true },
    { name: "audio.wav", data: audioBytes, compress: true },
    { name: "story.wav", data: audioBytes, compress: true },
  ]);
  const stored = buildZip([
    { name: "lesson.json", data: lessonBytes, compress: false },
    { name: "audio.wav", data: audioBytes, compress: false },
    { name: "story.wav", data: audioBytes, compress: false },
  ]);
  assert.ok(zipped.length < stored.length, "maximum DEFLATE must beat STORE");
  const reopened = readZipStrict(zipped);
  assert.deepEqual(
    reopened.entries.map((entry) => entry.name),
    ["lesson.json", "audio.wav", "story.wav"],
  );
  assert.ok(reopened.files["lesson.json"].equals(lessonBytes));
});

test("buildZip accepts the fourth entry (lesson + audio + cover + story audio) and rejects a fifth", () => {
  const lessonBytes = Buffer.from("{}", "utf8");
  const audioBytes = Buffer.alloc(16, 1);
  const zipped = buildZip([
    { name: "lesson.json", data: lessonBytes, compress: true },
    { name: "audio.wav", data: audioBytes, compress: true },
    { name: "cover.jpg", data: audioBytes, compress: true },
    { name: "story.wav", data: audioBytes, compress: true },
  ]);
  assert.equal(readZipStrict(zipped).entries.length, 4);
  assert.throws(
    () =>
      buildZip([
        { name: "lesson.json", data: lessonBytes, compress: true },
        { name: "audio.wav", data: audioBytes, compress: true },
        { name: "cover.jpg", data: audioBytes, compress: true },
        { name: "story.wav", data: audioBytes, compress: true },
        { name: "audio.mp3", data: audioBytes, compress: true },
      ]),
    /entries/,
  );
});

test("a pack without a story audio still re-opens and validates", () => {
  const stripped = { ...media };
  for (const key of [
    "storyAudioPath",
    "storyAudioFileName",
    "storyAudioSha256",
    "storyAudioMimeType",
    "storyAudioExtension",
    "storyAudioDurationMs",
    "storyAudioBytes",
  ] as const) {
    stripped[key] = undefined;
  }
  saveMedia(projectId, stripped, false);
  const lesson = assembleLesson({ content: draft, marks, media: stripped, rights });
  assert.equal(lesson.media.storyAudio, undefined);
  assert.deepEqual(validateLessonStructure(lesson), []);
  const enc = PACK_KEY_ID;
  const outcome = runExport(
    projectId,
    { encryptionKeyId: enc, signatureKeyId: SIGNING_KEY_ID, displayVersion: "1.0.1", manifestBaseUrl: "" },
    { archiveRoot },
  );
  const { plaintext } = decryptPack(fs.readFileSync(outcome.packPath), getAesKey(enc));
  const zip = readZipStrict(plaintext);
  assert.deepEqual(
    zip.entries.map((entry) => entry.name),
    ["lesson.json", "audio.wav"],
  );
  const header = parsePackHeader(fs.readFileSync(outcome.packPath));
  assert.ok(header.keyId === enc);
});
