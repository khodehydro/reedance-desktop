import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { DraftContent, ExportOutcome, MediaInfo, RightsChecklist } from "../src/shared/types";
import { decryptPack, sha256Hex } from "../src/main/crypto/pack";
import { verifyManifest } from "../src/main/crypto/sign";
import { readZipStrict } from "../src/main/crypto/zip";
import { closeDatabase, openDatabase } from "../src/main/db";
import { runExport, runQuickExport, verifyExport } from "../src/main/exporter";
import { importDraftFile } from "../src/main/import";
import { generateTestKeys, getAesKey, getSigningPublicKey, listKeys } from "../src/main/keys";
import { importAudio, withMeasuredDuration } from "../src/main/media";
import {
  approveProject,
  buildLessonForExport,
  getProjectDetail,
  preflight,
  saveContent,
  distributeMarks,
  saveMarks,
  saveMedia,
  saveRights,
  setReviewed,
} from "../src/main/projects";
import { computeStats, statsJson as statsToCsvJson, statsToCsv } from "../src/main/stats";
import { validateLessonSemantics, validateLessonStructure } from "../src/main/validation";

const repo = path.join(__dirname, "..");
const fixtures = path.join(repo, "contracts", "fixtures");
const draftBytes = fs.readFileSync(path.join(fixtures, "quiet-step.rddraft.json"));
const draft = JSON.parse(draftBytes.toString("utf8")) as DraftContent;

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-studio-test-"));
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
let audio: MediaInfo;
let outcome: ExportOutcome;
let encKeyId = "";
let sigKeyId = "";

before(async () => {
  await openDatabase();
});

after(() => {
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("importing the content-only draft creates a raw-imported project", () => {
  const result = importDraftFile(path.join(fixtures, "quiet-step.rddraft.json"));
  projectId = result.projectId;
  const detail = getProjectDetail(projectId);
  assert.equal(detail.summary.songId, "quiet-step");
  assert.equal(detail.summary.state, "raw-imported");
  assert.equal(detail.summary.lineCount, 2);
  assert.ok(fs.existsSync(detail.rawJsonPath), "the original draft bytes are snapshotted");
  assert.equal(sha256Hex(fs.readFileSync(detail.rawJsonPath)), sha256Hex(draftBytes));
  assert.equal(detail.summary.timedCount, 0);
});

test("the export gate refuses to run before the audio is chosen", () => {
  const report = preflight(projectId);
  assert.equal(report.canExport, false);
  const audioGate = report.gates.find((gate) => gate.key === "audio");
  assert.equal(audioGate?.ok, false);
});

test("choosing audio copies it into the project and moves the state forward", () => {
  const imported = importAudio(projectId, path.join(fixtures, "audio.wav"), null);
  audio = imported.media.durationMs > 0 ? imported.media : withMeasuredDuration(imported.media, 4000);
  saveMedia(projectId, audio, true);
  const detail = getProjectDetail(projectId);
  assert.equal(detail.summary.state, "audio-selected");
  assert.equal(detail.media?.audioSha256, sha256Hex(fs.readFileSync(path.join(fixtures, "audio.wav"))));
  assert.ok(fs.existsSync(audio.audioPath), "the immutable copy lives inside the project folder");
  if (process.platform !== "win32") assert.equal(fs.statSync(audio.audioPath).mode & 0o777, 0o444);
});

test("marks must be inside the audio and increase strictly", () => {
  assert.throws(
    () => saveMarks(projectId, [{ lineId: "line-1", startMs: 5000, endMs: null }], audio, draft),
    /outside the audio/,
  );
  saveMarks(
    projectId,
    [
      { lineId: "line-1", startMs: 0, endMs: null },
      { lineId: "line-2", startMs: 2000, endMs: null },
    ],
    audio,
    draft,
  );
  const marks = getProjectDetail(projectId).marks;
  assert.deepEqual(
    marks.map((mark) => mark.startMs),
    [0, 2000],
  );
  assert.ok(marks.every((mark) => mark.reviewed === false), "new marks are unreviewed");
});

test("rights evidence and per-line review are required before approval", () => {
  const detail = saveRights(projectId, rights);
  assert.equal(detail.summary.state, "sync-incomplete");
  assert.throws(() => approveProject(projectId, "QA", "first pass"), /approval blocked/);
  const report = preflight(projectId);
  const reviewGate = report.gates.find((gate) => gate.key === "reviewed");
  assert.equal(reviewGate?.ok, false);
  const rightsGate = report.gates.find((gate) => gate.key === "rights");
  assert.equal(rightsGate?.ok, true, JSON.stringify(rightsGate));
});

test("full pipeline: approve, export, verify, statistics", () => {
  setReviewed(projectId, ["line-1", "line-2"], true);
  const approved = approveProject(projectId, "QA operator", "Timings checked by ear");
  assert.equal(approved.summary.state, "approved");

  const report = preflight(projectId);
  assert.equal(report.canExport, true, JSON.stringify(report.gates.filter((gate) => !gate.ok)));

  const keys = generateTestKeys();
  encKeyId = keys.find((key) => key.kind === "enc")!.keyId;
  sigKeyId = keys.find((key) => key.kind === "sig")!.keyId;
  assert.ok(listKeys().length >= 2);

  const options = {
    encryptionKeyId: encKeyId,
    signatureKeyId: sigKeyId,
    displayVersion: "1.0.0",
    manifestBaseUrl: "https://content.example.com/reedance",
    useTestKeys: true,
  };

  assert.throws(() => runExport(projectId, { ...options, useTestKeys: false }, { archiveRoot }), /test/i);

  outcome = runExport(projectId, options, { archiveRoot });
  assert.equal(outcome.versionCode, 1);
  assert.match(path.basename(outcome.packPath), /^v000001-[a-f0-9]{64}\.rdpack$/);
  assert.ok(fs.existsSync(outcome.packPath));
  assert.ok(fs.existsSync(outcome.manifestPath));
  assert.equal(outcome.usedTestKeys, true);
  if (process.platform !== "win32") assert.equal(fs.statSync(outcome.packPath).mode & 0o777, 0o444);

  const { lesson } = buildLessonForExport(projectId);
  assert.deepEqual(validateLessonStructure(lesson), []);
  assert.deepEqual(
    validateLessonSemantics(lesson, audio.durationMs, audio.audioSha256).filter((issue) => issue.severity === "error"),
    [],
  );

  const pack = fs.readFileSync(outcome.packPath);
  assert.equal(sha256Hex(pack), outcome.packSha256);
  const { plaintext } = decryptPack(pack, getAesKey(encKeyId));
  const unpacked = readZipStrict(plaintext);
  assert.deepEqual(Object.keys(unpacked.files).sort(), ["audio.wav", "lesson.json"]);
  assert.deepEqual(JSON.parse(unpacked.files["lesson.json"].toString("utf8")), lesson);
  assert.equal(sha256Hex(unpacked.files["audio.wav"]), audio.audioSha256);

  const envelope = JSON.parse(fs.readFileSync(outcome.manifestPath, "utf8"));
  const signature = getSigningPublicKey(sigKeyId);
  assert.ok(signature);
  const verdict = verifyManifest(envelope, signature as Buffer);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.payload?.package.sha256, outcome.packSha256);
  assert.equal(verdict.payload?.package.fileName, path.basename(outcome.packPath));
  assert.equal(verdict.payload?.package.encryptionKeyId, encKeyId);

  const verification = verifyExport(outcome.exportId);
  assert.equal(verification.verified, true, verification.detail.join("; "));

  const exported = computeStats({ scope: "latest-exported", targetLanguage: "all" });
  assert.equal(exported.versions, 1);
  assert.equal(exported.songs, 1);
  const language = exported.languages.find((entry) => entry.targetLanguage === "en");
  assert.ok(language, "an English row is reported");
  assert.equal(language?.uniqueLexemes, new Set(lesson.vocabulary.map((word) => word.normalizedKey)).size);
  assert.equal(language?.lyricLines, 2);
  assert.equal(language?.sentences, lesson.sentences.length);
  assert.equal(language?.grammarCards, lesson.grammar.length);
  assert.equal(language?.published, 0);

  const published = computeStats({ scope: "latest-published", targetLanguage: "all" });
  assert.equal(published.versions, 0, "test-key exports are never published");

  const csv = statsToCsv(exported);
  const csvLines = csv.split("\n");
  const header = csvLines.find((line) => line.startsWith("targetLanguage,"));
  assert.ok(header, "the CSV has an explicit header row");
  assert.ok(header?.includes("uniqueLexemes"));
  assert.ok(csvLines.some((line) => line.startsWith("en,")), "an English data row is written");
  assert.ok(csvLines[0].startsWith("# generatedAt:"), "metadata is kept in comments, not columns");
  const json = JSON.parse(statsToCsvJson(exported));
  assert.equal(json.languages.length, exported.languages.length);
});

test("a second export reserves the next version code and keeps the first pack", () => {
  const second = runExport(
    projectId,
    {
      encryptionKeyId: encKeyId,
      signatureKeyId: sigKeyId,
      displayVersion: "1.0.1",
      manifestBaseUrl: "https://content.example.com/reedance",
      useTestKeys: true,
    },
    { archiveRoot },
  );
  assert.equal(second.versionCode, 2);
  assert.notEqual(second.packPath, outcome.packPath);
  assert.ok(fs.existsSync(outcome.packPath), "older versions stay on disk");
  const manifests = fs.readdirSync(path.dirname(second.manifestPath));
  assert.ok(manifests.length >= 2);
});

test("editing content keeps export possible but revokes the recorded approval and the review flags", () => {
  const content = getProjectDetail(projectId).content;
  const edited: DraftContent = {
    ...content,
    lyrics: content.lyrics.map((line) =>
      line.id === "line-1" ? { ...line, translationEn: `${line.translationEn} (edited)` } : line,
    ),
  };
  saveContent(projectId, edited);
  const detail = getProjectDetail(projectId);
  assert.notEqual(detail.summary.state, "approved");
  assert.equal(detail.summary.approvedAt, null);
  const report = preflight(projectId);
  const approvalGate = report.gates.find((gate) => gate.key === "approved");
  assert.equal(approvalGate?.ok, false, "the recorded approval no longer matches");

  // Export itself only depends on the technical gates, so the edit does not
  // lock the file; a missing timing does.
  assert.equal(report.canExport, true);
  saveMarks(projectId, [{ lineId: "line-1", startMs: null, endMs: null }], audio, edited);
  const blocked = preflight(projectId);
  assert.equal(blocked.canExport, false);
  assert.equal(blocked.gates.find((gate) => gate.key === "timed")?.ok, false);
  assert.throws(
    () =>
      runExport(
        projectId,
        {
          encryptionKeyId: encKeyId,
          signatureKeyId: sigKeyId,
          displayVersion: "1.0.2",
          manifestBaseUrl: "https://content.example.com/reedance",
          useTestKeys: true,
        },
        { archiveRoot },
      ),
    /export is locked/i,
  );
});

test("an untimed project reports only the reasons that actually block the file", () => {
  const content = getProjectDetail(projectId).content;
  saveMarks(
    projectId,
    content.lyrics.map((line) => ({ lineId: line.id, startMs: null, endMs: null })),
    audio,
    content,
  );
  assert.throws(
    () => runQuickExport(projectId, {}, { archiveRoot }),
    (error: Error) => {
      assert.match(error.message, /export is locked/);
      assert.ok(!/reviewed|approval/i.test(error.message), `irrelevant gates leaked: ${error.message}`);
      assert.match(error.message, /timed/i);
      return true;
    },
  );
});

test("the timeline can distribute every line evenly and export immediately", () => {
  const detail = distributeMarks(projectId);
  assert.equal(detail.marks.length, detail.content.lyrics.length);
  assert.ok(detail.marks.every((mark) => mark.startMs !== null));
  assert.ok(detail.marks.every((mark) => (mark.startMs ?? 0) < audio.durationMs));
  assert.ok(detail.preflight.canExport);
  const outcome = runQuickExport(projectId, {}, { archiveRoot });
  assert.ok(fs.existsSync(outcome.packPath));
});

test("one-click export needs nothing from the operator: keys and version are automatic", () => {
  const content = getProjectDetail(projectId).content;
  saveMarks(
    projectId,
    [
      { lineId: "line-1", startMs: 0, endMs: null },
      { lineId: "line-2", startMs: 2000, endMs: null },
    ],
    audio,
    content,
  );
  const outcome = runQuickExport(projectId, {}, { archiveRoot });
  assert.equal(outcome.usedTestKeys, false, "the app provisions its own studio keys");
  assert.ok(fs.existsSync(outcome.packPath));
  assert.equal(outcome.manifestUrlHint, "", "no hosting URL is required to export");
  const row = getProjectDetail(projectId).exports.find((item) => item.exportId === outcome.exportId);
  assert.match(row?.encryptionKeyId ?? "", /^enc-studio-/, "an app-provisioned AES key is used");
  assert.match(row?.signatureKeyId ?? "", /^sig-studio-/);
  assert.equal(verifyExport(outcome.exportId).verified, true);

  const next = runQuickExport(projectId, {}, { archiveRoot });
  const nextRow = getProjectDetail(projectId).exports.find((item) => item.exportId === next.exportId);
  assert.equal(nextRow?.encryptionKeyId, row?.encryptionKeyId, "the studio key is reused, not regenerated");
});

test("replacing the audio clears every mark and the approval", () => {
  const before = getProjectDetail(projectId);
  assert.ok(before.marks.length > 0);

  // A second, slightly longer WAV proves the replacement path.
  const sampleRate = 8000;
  const samples = Buffer.alloc(sampleRate * 5, 128);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  const body = Buffer.concat([header, samples]);
  const replacement = path.join(workspace, "replacement.wav");
  fs.writeFileSync(replacement, body);

  const next = importAudio(projectId, replacement, before.media ?? null);
  saveMedia(projectId, next.media, true);
  const detailAfter = getProjectDetail(projectId);
  assert.equal(detailAfter.media?.audioSha256, sha256Hex(body));
  assert.equal(detailAfter.media?.durationMs, 5000);
  assert.equal(detailAfter.marks.length, 0, "marks for the previous audio are dropped");
  assert.equal(detailAfter.summary.state, "audio-selected");
  assert.equal(detailAfter.summary.approvedAt, null);
  assert.equal(preflight(projectId).canExport, false);
});
