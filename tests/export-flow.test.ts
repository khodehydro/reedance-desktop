import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { decryptPack, encryptPack, packFileName, sha256Hex } from "../src/main/crypto/pack";
import { generateSigningKeyPair, signManifest, verifyManifest, ed25519PrivateKeyFromSeed } from "../src/main/crypto/sign";
import { buildZip, readZipStrict } from "../src/main/crypto/zip";
import { assembleLesson } from "../src/main/lesson";
import { validateLessonSemantics, validateLessonStructure } from "../src/main/validation";
import type { DraftContent, LyricMark, MediaInfo, RightsChecklist } from "../src/shared/types";

const fixtures = path.join(__dirname, "..", "contracts", "fixtures");
const draft = JSON.parse(fs.readFileSync(path.join(fixtures, "quiet-step.rddraft.json"), "utf8")) as DraftContent;
const audio = fs.readFileSync(path.join(fixtures, "audio.wav"));

const media: MediaInfo = {
  audioPath: path.join(fixtures, "audio.wav"),
  audioFileName: "audio.wav",
  audioSha256: sha256Hex(audio),
  mimeType: "audio/wav",
  extension: "wav",
  durationMs: 4000,
  bytes: audio.length,
  importedAt: new Date().toISOString(),
  sourceName: "audio.wav",
};

const rights: RightsChecklist = {
  audioRights: true,
  lyricsRights: true,
  coverRights: false,
  offlineDownloadAllowed: true,
  demoAudioDisclosure: true,
  evidenceRef: "test-licence",
  notes: "",
  audioCredit: "Silent test audio",
  coverCredit: "",
};

const marks: LyricMark[] = [
  { lineId: "line-1", startMs: 0, endMs: null, reviewed: true, reviewedAudioSha: media.audioSha256 },
  { lineId: "line-2", startMs: 2000, endMs: null, reviewed: true, reviewedAudioSha: media.audioSha256 },
];

test("the studio turns a content-only draft into a timed lesson that validates", () => {
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  assert.equal(lesson.schemaVersion, 1);
  assert.deepEqual(
    lesson.lyrics.map((line) => line.startMs),
    [0, 2000],
  );
  assert.equal(lesson.media.audio.path, "audio.wav");
  assert.equal(lesson.media.audio.sha256, media.audioSha256);
  assert.equal(lesson.credits.audio, "Silent test audio");
  assert.deepEqual(validateLessonStructure(lesson), []);
  const semantics = validateLessonSemantics(lesson, media.durationMs, media.audioSha256);
  assert.deepEqual(semantics.filter((issue) => issue.severity === "error"), []);
});

test("a line without a start time cannot become a published lesson", () => {
  assert.throws(
    () => assembleLesson({ content: draft, marks: [marks[0]], media, rights }),
    /no start time/,
  );
});

test("out-of-order or out-of-range timings are blocking errors", () => {
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  const bad = {
    ...lesson,
    lyrics: [
      { ...lesson.lyrics[0], startMs: 3000 },
      { ...lesson.lyrics[1], startMs: 2000 },
    ],
  };
  const issues = validateLessonSemantics(bad, media.durationMs, media.audioSha256);
  assert.ok(issues.some((issue) => issue.message.includes("increase strictly")));

  const outside = {
    ...lesson,
    lyrics: [
      { ...lesson.lyrics[0], startMs: 0 },
      { ...lesson.lyrics[1], startMs: 9000 },
    ],
  };
  const outsideIssues = validateLessonSemantics(outside, media.durationMs, media.audioSha256);
  assert.ok(outsideIssues.some((issue) => issue.message.includes("outside the")));
});

test("end-to-end: pack, manifest and independent re-open like the Android client", () => {
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  const lessonBytes = Buffer.from(JSON.stringify(lesson, null, 2), "utf8");
  const zip = buildZip([
    { name: "lesson.json", data: lessonBytes, compress: true },
    { name: "audio.wav", data: audio, compress: false },
  ]);

  const aesKey = crypto.randomBytes(32);
  const encryptionKeyId = "enc-flow-test";
  const pack = encryptPack(zip, encryptionKeyId, aesKey);
  const packSha = sha256Hex(pack);
  const fileName = packFileName(7, packSha);
  assert.match(fileName, /^v000007-[a-f0-9]{64}\.rdpack$/);

  const versionCode = 7;
  const payloadBytes = Buffer.from(
    JSON.stringify({
      manifestVersion: 1,
      songId: lesson.songId,
      targetLanguage: lesson.targetLanguage,
      contentVersionCode: versionCode,
      displayVersion: "1.0.0",
      containerVersion: 1,
      lessonSchemaVersion: 1,
      releasedAt: new Date().toISOString(),
      package: {
        fileName,
        sizeBytes: pack.length,
        sha256: packSha,
        encryptionKeyId,
      },
    }),
    "utf8",
  );

  const { seed, publicRaw } = generateSigningKeyPair();
  const envelope = signManifest(payloadBytes, "sig-flow-test", ed25519PrivateKeyFromSeed(seed));
  const verdict = verifyManifest(envelope, publicRaw);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.payload?.package.sha256, packSha);

  // Consumer side: verify signature first, then decrypt, unzip and validate.
  const { plaintext } = decryptPack(pack, aesKey);
  const unpacked = readZipStrict(plaintext);
  const reopened = JSON.parse(unpacked.files["lesson.json"].toString("utf8"));
  assert.deepEqual(reopened, lesson);
  assert.equal(sha256Hex(unpacked.files["audio.wav"]), verdict.payload?.package.sha256 === packSha ? media.audioSha256 : "");
  assert.equal(unpacked.entries.length, 2);
  assert.ok(pack.length > zip.length);

  // A single flipped ciphertext byte must fail before any content is trusted.
  const tampered = Buffer.from(pack);
  tampered[Math.floor(tampered.length / 2)] = tampered[Math.floor(tampered.length / 2)] ^ 0x01;
  assert.throws(() => decryptPack(tampered, aesKey));
});

test("a story section is mapped to the Android story shape and validates", () => {
  const lesson = assembleLesson({ content: draft, marks, media, rights });
  assert.ok(lesson.story, "the draft story must reach the published lesson");
  const story = draft.story!;
  assert.equal(lesson.story.title, story.title);
  assert.equal(lesson.story.pages.length, story.pages.length);
  const firstLine = lesson.story.pages[0].lines[0];
  assert.equal(firstLine.text, story.pages[0].lines[0].text);
  assert.equal(firstLine.meaningFa, story.pages[0].lines[0].translationFa);
  assert.equal(firstLine.meaningEn, story.pages[0].lines[0].translationEn);
  assert.deepEqual(
    firstLine.words.map((word) => word.text),
    story.pages[0].lines[0].tokens.map((token) => token.surface),
  );
  assert.deepEqual(validateLessonStructure(lesson), []);
  assert.deepEqual(
    validateLessonSemantics(lesson, media.durationMs, media.audioSha256).filter((issue) => issue.severity === "error"),
    [],
  );
});

test("a draft without a story still exports a valid lesson", () => {
  const withoutStory = { ...draft, story: undefined };
  const lesson = assembleLesson({ content: withoutStory, marks, media, rights });
  assert.equal(lesson.story, undefined);
  assert.deepEqual(validateLessonStructure(lesson), []);
});
