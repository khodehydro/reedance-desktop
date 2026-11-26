import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { ReetalkDraft, ReetalkDialogue } from "../src/shared/types";
import { decryptPack } from "../src/main/crypto/pack";
import { verifyManifest } from "../src/main/crypto/sign";
import { readZipStrict, ZIP_MAX_TOTAL } from "../src/main/crypto/zip";
import { closeDatabase, openDatabase } from "../src/main/db";
import { runQuickExport, verifyExport } from "../src/main/exporter";
import { importDraftFile } from "../src/main/import";
import { ensureStudioKeys, getAesKey, getSigningPublicKey } from "../src/main/keys";
import { importAudio, importCover, withMeasuredDuration } from "../src/main/media";
import {
  distributeMarks,
  getProjectDetail,
  preflight,
  readPayload,
  saveContent,
  saveMarks,
  saveMedia,
} from "../src/main/projects";
import {
  REETALK_MIN_TURNS,
  REETALK_MIN_TURNS_PER_SPEAKER,
  validateReeTalkDraft,
  validateReeTalkDialogue,
} from "../src/main/reetalk";
import { computeStats } from "../src/main/stats";

const repo = path.join(__dirname, "..");
const fixtures = path.join(repo, "contracts", "fixtures");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "reedance-reetalk-test-"));
const archiveRoot = path.join(workspace, "archive");
process.env.REEDANCE_STUDIO_ROOT = workspace;
process.env.REEDANCE_SQL_WASM_DIR = path.join(repo, "node_modules", "sql.js", "dist");
process.env.REEDANCE_CONTRACTS_DIR = path.join(repo, "contracts");

/** A contract-valid two-speaker dialogue: 12 turns, 6 per speaker. */
function makeDraft(): ReetalkDraft {
  const words = [
    {
      id: "word-hello",
      text: "hello",
      pronunciation: { faReading: "هِلو", ipa: "həˈloʊ" },
      meaning: { fa: "سلام", en: "hello" },
      example: { text: "Hello there, my friend", translation: { fa: "سلام دوست من", en: "Hello there, my friend" } },
    },
  ];
  const turns = Array.from({ length: 12 }, (_, index) => {
    const speakerId = index % 2 === 0 ? "sp-ana" : "sp-ben";
    const text = `turn number ${index + 1} my friend`;
    return {
      id: `turn-${String(index + 1).padStart(2, "0")}`,
      speakerId,
      text,
      translation: { fa: `نوبت ${index + 1}`, en: `turn ${index + 1}` },
      tokens: ["turn", "number", String(index + 1), "my", "friend"].map((surface) => ({
        surface,
        gloss: { fa: surface, en: surface },
      })),
    };
  });
  const question = (id: string, stage: "gist" | "detail" | "review") => ({
    id,
    stage,
    type: "multiple_choice" as const,
    prompt: { fa: "سؤال فارسی", en: "The English question" },
    options: [
      { id: `${id}-a`, text: { fa: "گزینه یک", en: "first option" } },
      { id: `${id}-b`, text: { fa: "گزینه دو", en: "second option" } },
    ],
    correctOptionId: `${id}-a`,
    explanation: { fa: "توضیح", en: "because" },
    evidenceTurnIds: ["turn-01"],
  });
  return {
    draftSchemaVersion: 1,
    contentType: "reetalk",
    dialogueId: "greeting-dialogue",
    categoryId: "daily-life",
    targetLanguage: "en",
    locale: "en-US",
    level: "A2",
    title: { fa: "سلام و احوالپرسی", en: "Greetings" },
    objective: { fa: "یادگیری احوالپرسی", en: "Learn how to greet" },
    speakers: [
      { id: "sp-ana", name: "Ana", gender: "woman" },
      { id: "sp-ben", name: "Ben", gender: "man" },
    ],
    turns,
    learning: {
      words,
      grammar: [
        {
          id: "gram-present",
          title: { fa: "زمان حال ساده", en: "Present simple" },
          explanation: { fa: "توضیح دستوری", en: "grammar explanation" },
          example: { text: "I am Ana", translation: { fa: "من آنا هستم", en: "I am Ana" } },
          takeaway: { fa: "نکته", en: "takeaway" },
          tables: [
            {
              title: { fa: "جدول ضمایر", en: "Pronoun table" },
              columns: [{ fa: "ضمیر", en: "pronoun" }],
              rows: [[{ text: "I" }]],
            },
          ],
        },
      ],
      phrases: [
        {
          id: "phrase-how",
          text: "how are you",
          pronunciation: { faReading: "هاو آر یو", ipa: "haʊ ɑːr juː" },
          meaning: { fa: "حال تو چطور است", en: "how are you" },
          context: { fa: "در سلام", en: "when greeting" },
          example: { text: "How are you today", translation: { fa: "امروز حال تو چطور است", en: "How are you today" } },
        },
      ],
      questions: [question("q-gist", "gist"), question("q-detail", "detail")],
    },
  };
}

let projectId = "";
let draftBytes = Buffer.alloc(0);

before(async () => {
  await openDatabase();
});

after(() => {
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("a contract-valid ReeTalk draft passes validation; broken ones do not", () => {
  const draft = makeDraft();
  assert.deepEqual(validateReeTalkDraft(draft).filter((issue) => issue.severity === "error"), []);

  const badTokens = makeDraft();
  badTokens.turns[0].text = "something else entirely";
  assert.ok(validateReeTalkDraft(badTokens).some((issue) => issue.message.includes("do not reconstruct")));

  const oneSpeaker = makeDraft();
  oneSpeaker.speakers = [oneSpeaker.speakers[0]];
  assert.ok(validateReeTalkDraft(oneSpeaker).some((issue) => issue.message.includes("exactly two speakers")));

  const noGist = makeDraft();
  noGist.learning.questions = noGist.learning.questions.filter((question) => question.stage !== "gist");
  assert.ok(validateReeTalkDraft(noGist).some((issue) => issue.message.includes("gist question")));

  const tooFewTurns = makeDraft();
  tooFewTurns.turns = tooFewTurns.turns.slice(0, REETALK_MIN_TURNS - 1);
  assert.ok(validateReeTalkDraft(tooFewTurns).some((issue) => issue.message.includes("8–120 turns")));
});

test("turn limits: 8 turns with 4 per speaker is the accepted minimum", () => {
  assert.equal(REETALK_MIN_TURNS, 8);
  assert.equal(REETALK_MIN_TURNS_PER_SPEAKER, 4);

  // Alternating speakers → exactly 4 + 4.
  const eight = makeDraft();
  eight.turns = eight.turns.slice(0, 8);
  assert.deepEqual(validateReeTalkDraft(eight).filter((issue) => issue.severity === "error"), []);

  // Eight turns but split 5 + 3: the per-speaker floor still applies.
  const lopsided = makeDraft();
  lopsided.turns = lopsided.turns.slice(0, 8).map((turn, index) => ({
    ...turn,
    speakerId: index < 5 ? "sp-ana" : "sp-ben",
  }));
  const lopsidedIssues = validateReeTalkDraft(lopsided);
  assert.ok(lopsidedIssues.some((issue) => issue.message.includes('"sp-ben" has 3 turns; at least 4')));
  assert.ok(!lopsidedIssues.some((issue) => issue.message.includes("8–120 turns")));

  const tooMany = makeDraft();
  const template = tooMany.turns[0];
  tooMany.turns = Array.from({ length: 121 }, (_, index) => ({
    ...template,
    id: `turn-${index + 1}`,
    speakerId: index % 2 === 0 ? "sp-ana" : "sp-ben",
  }));
  assert.ok(validateReeTalkDraft(tooMany).some((issue) => issue.message.includes("found 121")));
});

test("the authored reetalk-docs scenario en-t01-s01 (8 turns) validates and imports", () => {
  // Byte-for-byte copy of reetalk-docs `سناریو/انگلیسی/01 - معرفی و آشنایی/01 - اولین سلام سارا و امیر.json`;
  // it used to fail with "a dialogue needs 10–120 turns, found 8".
  const source = path.join(repo, "tests", "fixtures", "reetalk-en-t01-s01.json");
  const draft = JSON.parse(fs.readFileSync(source, "utf8")) as ReetalkDraft;
  assert.equal(draft.turns.length, 8);
  assert.deepEqual(validateReeTalkDraft(draft), []);

  // Import exactly as the operator does: the file keeps its plain `.json` name.
  const target = path.join(workspace, "01 - اولین سلام سارا و امیر.json");
  fs.copyFileSync(source, target);
  const result = importDraftFile(target);
  assert.equal(result.songId, "en-t01-s01");
  const detail = getProjectDetail(result.projectId);
  assert.equal(detail.summary.kind, "reetalk");
  assert.equal(detail.summary.lineCount, 8);
  assert.equal(detail.summary.state, "raw-imported");
});

test("importing the draft creates a separate ReeTalk project", () => {
  const draft = makeDraft();
  draftBytes = Buffer.from(JSON.stringify(draft, null, 2), "utf8");
  const filePath = path.join(workspace, "greeting.reetalkdraft.json");
  fs.writeFileSync(filePath, draftBytes);

  const result = importDraftFile(filePath);
  projectId = result.projectId;
  assert.equal(result.songId, "greeting-dialogue");
  const detail = getProjectDetail(projectId);
  assert.equal(detail.summary.kind, "reetalk");
  assert.equal(detail.summary.songId, "greeting-dialogue");
  assert.equal(detail.summary.state, "raw-imported");
  assert.equal(detail.summary.lineCount, 12);
  assert.equal(detail.summary.title, "سلام و احوالپرسی");
  assert.equal((detail.content as ReetalkDraft).contentType, "reetalk");
  assert.ok(fs.existsSync(detail.rawJsonPath), "the original draft bytes are snapshotted");
});

test("ReeTalk content cannot be edited in the studio", () => {
  // The guard runs on the stored content before touching the payload, so any
  // payload shape must still be rejected for a ReeTalk project.
  assert.throws(() => saveContent(projectId, {} as never), /cannot be edited/);
});

test("marks only accept dialogue turn ids", () => {
  const detail = getProjectDetail(projectId);
  const audio = importAudio(projectId, path.join(fixtures, "audio.wav"), null);
  const media = audio.media.durationMs > 0 ? audio.media : withMeasuredDuration(audio.media, 4000);
  saveMedia(projectId, media, true);

  assert.throws(
    () => saveMarks(projectId, [{ lineId: "line-1", startMs: 0, endMs: null }], media, detail.content),
    /unknown dialogue turn/,
  );
});

test("state machine: timed turns flip sync-incomplete → review-ready", () => {
  let detail = getProjectDetail(projectId);
  assert.equal(detail.summary.state, "audio-selected");

  const turnIds = (detail.content as ReetalkDraft).turns.map((turn) => turn.id);
  saveMarks(
    projectId,
    turnIds.map((lineId, index) => ({ lineId, startMs: index < 6 ? index * 100 : null, endMs: null })),
    detail.media,
    detail.content,
  );
  detail = getProjectDetail(projectId);
  assert.equal(detail.summary.state, "sync-incomplete");

  detail = distributeMarks(projectId);
  assert.equal(detail.summary.state, "review-ready");
  assert.equal(detail.summary.timedCount, 12);
  assert.ok(detail.marks.every((mark) => mark.startMs !== null));
});

test("export stays locked until the mandatory cover is selected", () => {
  const before = preflight(projectId);
  const coverGate = before.gates.find((gate) => gate.key === "cover");
  assert.equal(coverGate?.ok, false);
  assert.equal(before.canExport, false);
  assert.throws(() => runQuickExport(projectId, {}, { archiveRoot }), /export is locked/);

  const coverSource = path.join(workspace, "cover.png");
  fs.writeFileSync(
    coverSource,
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]),
  );
  const detail = getProjectDetail(projectId);
  const withCover = importCover(projectId, coverSource, detail.media!);
  saveMedia(projectId, withCover, false);

  const after = preflight(projectId);
  assert.equal(after.gates.find((gate) => gate.key === "cover")?.ok, true);
  assert.equal(after.canExport, true, after.gates.filter((gate) => !gate.ok).map((gate) => gate.key).join(","));
});

test("an exportable ReeTalk pack holds exactly dialogue.json + audio + cover", () => {
  // Record one explicit end (a silence gap) and leave the rest to the fallback.
  const detail = getProjectDetail(projectId);
  const media = detail.media!;
  const first = detail.marks[0];
  const second = detail.marks[1];
  saveMarks(
    projectId,
    [
      { lineId: first.lineId, startMs: first.startMs, endMs: (first.startMs ?? 0) + 100 },
      { lineId: second.lineId, startMs: second.startMs, endMs: null },
    ],
    media,
    detail.content,
  );

  const outcome = runQuickExport(projectId, {}, { archiveRoot });
  assert.equal(outcome.versionCode, 1);
  const check = verifyExport(outcome.exportId);
  assert.ok(check.verified, check.detail.join(" | "));

  const { encryptionKeyId, signatureKeyId } = ensureStudioKeys();
  const packBytes = fs.readFileSync(outcome.packPath);
  const { plaintext } = decryptPack(packBytes, getAesKey(encryptionKeyId));
  const zip = readZipStrict(plaintext, ZIP_MAX_TOTAL, "reetalk");
  assert.deepEqual(
    zip.entries.map((entry) => entry.name),
    ["dialogue.json", "audio.wav", "cover.png"],
    "the pack ships exactly dialogue.json + audio + cover, dialogue first",
  );

  const dialogue = JSON.parse(zip.files["dialogue.json"].toString("utf8")) as ReetalkDialogue;
  assert.equal(dialogue.schemaVersion, 1);
  assert.equal(dialogue.dialogueId, "greeting-dialogue");
  assert.equal(dialogue.contentVersionCode, 1);

  // Recorded end is kept (the gap stays), missing ends fall back to the next
  // turn's start, and the last turn closes at the audio duration.
  const durationMs = media.durationMs;
  assert.equal(dialogue.turns[0].endMs, dialogue.turns[0].startMs + 100, "recorded end preserved");
  assert.ok(dialogue.turns[0].endMs <= dialogue.turns[1].startMs, "no overlap after the recorded end");
  for (let index = 1; index < dialogue.turns.length - 1; index += 1) {
    assert.equal(
      dialogue.turns[index].endMs,
      dialogue.turns[index + 1].startMs,
      `turn ${index + 1} end falls back to the next start`,
    );
  }
  assert.equal(dialogue.turns[dialogue.turns.length - 1].endMs, durationMs, "last turn closes at the audio end");
  assert.deepEqual(
    validateReeTalkDialogue(dialogue, durationMs, media.audioSha256).filter((issue) => issue.severity === "error"),
    [],
  );

  // Manifest payload v2: exactly the contract fields, no displayVersion.
  const payload = readPayload(outcome.exportId) as Record<string, unknown>;
  assert.equal(payload.manifestVersion, 2);
  assert.equal(payload.contentType, "reetalk");
  assert.equal(payload.dialogueId, "greeting-dialogue");
  assert.equal(payload.contentVersionCode, 1);
  assert.equal("displayVersion" in payload, false, "v2 has no displayVersion");
  assert.equal("releasedAt" in payload, false, "v2 has no releasedAt");
  assert.equal(payload.package && (payload.package as { sha256?: string }).sha256, outcome.packSha256);

  const envelope = JSON.parse(fs.readFileSync(outcome.manifestPath, "utf8"));
  const verdict = verifyManifest(envelope, getSigningPublicKey(signatureKeyId) ?? Buffer.alloc(0));
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.payload?.package.sha256, outcome.packSha256);
});

test("a recorded end that overlaps the next turn locks the export", () => {
  const detail = getProjectDetail(projectId);
  const [first, second] = detail.marks;
  saveMarks(
    projectId,
    [
      { lineId: first.lineId, startMs: first.startMs, endMs: (second.startMs ?? 0) + 500 },
      { lineId: second.lineId, startMs: second.startMs, endMs: second.endMs },
    ],
    detail.media,
    detail.content,
  );
  const report = preflight(projectId);
  assert.equal(report.gates.find((gate) => gate.key === "timing")?.ok, false);
  assert.equal(report.canExport, false);
  assert.throws(() => runQuickExport(projectId, {}, { archiveRoot }), /export is locked/);

  // Clear the bad ends again so later suites start from a clean slate.
  saveMarks(
    projectId,
    detail.marks.map((mark) => ({ lineId: mark.lineId, startMs: mark.startMs, endMs: null })),
    detail.media,
    detail.content,
  );
  assert.equal(preflight(projectId).canExport, true);
});

test("statistics count a ReeTalk project without crashing on missing song fields", () => {
  const report = computeStats({ scope: "drafts", targetLanguage: "en" });
  assert.equal(report.songs >= 1, true);
  const english = report.languages.find((entry) => entry.targetLanguage === "en");
  assert.ok(english, "the en language row exists");
  assert.equal(english.lyricLines >= 12, true, "dialogue turns are counted as lines");
  assert.ok(english.sentences >= 1, "phrases map onto the sentences column");
  assert.equal(english.uniqueLexemes, 0, "ReeTalk ships no lexeme entries");
});
