import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assembleLesson } from "../src/main/lesson";
import { validateContentSemantics, validateDraftStructure, validateLessonStructure } from "../src/main/validation";
import { alternateLineLanguage, type DraftContent, type LyricMark, type MediaInfo, type RightsChecklist } from "../src/shared/types";

process.env.REEDANCE_CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const fixture = path.join(__dirname, "..", "contracts", "fixtures", "quiet-step.rddraft.json");
const baseDraft = (): DraftContent => JSON.parse(fs.readFileSync(fixture, "utf8")) as DraftContent;
const errors = (draft: DraftContent) => validateContentSemantics(draft).filter((issue) => issue.severity === "error");

/** Make line-2 a Spanish line with no learning attached (the fixture song is English). */
function withSpanishLine(): DraftContent {
  const draft = baseDraft();
  draft.lyrics[1].language = "es";
  draft.lyrics[1].tokens = draft.lyrics[1].tokens.map(({ lexemeId: _lexemeId, ...token }) => token);
  draft.sentences = draft.sentences.map((item) => (item.lineId === "line-2" ? { ...item, lineId: undefined } : item));
  draft.questions = draft.questions.map((question) => (question.lineId === "line-2" ? { ...question, lineId: undefined } : question));
  return draft;
}

test("a line may declare another language; the badge rule matches Android", () => {
  assert.equal(alternateLineLanguage("es", { language: "en" }), "en");
  assert.equal(alternateLineLanguage("es", { language: "es" }), null, "same as the song = no badge");
  assert.equal(alternateLineLanguage("es", {}), null, "missing = inherits the song language");
  assert.equal(alternateLineLanguage("es", { language: "EN" }), null, "only lowercase ISO codes");

  const draft = withSpanishLine();
  assert.deepEqual(validateDraftStructure(draft), [], "the draft schema accepts lyrics[].language");
  assert.deepEqual(errors(draft), []);
  const bad = baseDraft();
  bad.lyrics[0].language = "English";
  assert.ok(validateDraftStructure(bad).some((issue) => issue.path === "$/lyrics/0/language"));
});

test("a foreign-language line is never taught", () => {
  const lexeme = baseDraft();
  lexeme.lyrics[1].language = "es";
  const lexemeErrors = errors(lexeme).map((issue) => issue.path);
  assert.ok(lexemeErrors.some((p) => p.startsWith("lyrics[1].tokens[") && p.endsWith(".lexemeId")), "no lexemes on the line");
  assert.ok(lexemeErrors.includes("sentences[0].lineId"), "no sentence card from it");
  assert.ok(lexemeErrors.some((p) => /^questions\[\d+\]\.lineId$/.test(p)), "no question from it");

  const grammar = withSpanishLine();
  grammar.grammar[0].lineIds = ["line-2"];
  assert.ok(errors(grammar).some((issue) => issue.path === "grammar[0].lineIds[0]" && /another language/.test(issue.message)));
  grammar.grammar[0].lineIds = ["line-404"];
  assert.ok(errors(grammar).some((issue) => issue.path === "grammar[0].lineIds[0]" && /unknown line/.test(issue.message)));
});

test("lesson.json keeps the line language and publishes grammar links (Android 0.1.1)", () => {
  const draft = withSpanishLine();
  draft.grammar[0].lineIds = ["line-1"];
  assert.deepEqual(validateDraftStructure(draft), [], "grammar lineIds are valid in a draft");
  const sameLanguage = structuredClone(draft);
  sameLanguage.lyrics[0].language = "en";

  const marks: LyricMark[] = [
    { lineId: "line-1", startMs: 0, endMs: null, reviewed: true, reviewedAudioSha: null },
    { lineId: "line-2", startMs: 2000, endMs: null, reviewed: true, reviewedAudioSha: null },
  ];
  const media: MediaInfo = {
    audioPath: "audio.wav", audioFileName: "audio.wav", audioSha256: "a".repeat(64), mimeType: "audio/wav", extension: "wav",
    durationMs: 4000, bytes: 10, importedAt: new Date().toISOString(), sourceName: "audio.wav",
  };
  const rights = { audioCredit: "me", coverCredit: "", evidenceRef: "x" } as RightsChecklist;
  const lesson = assembleLesson({ content: sameLanguage, marks, media, rights });
  assert.equal(lesson.lyrics[1].language, "es", "the alternate language is published");
  assert.equal("language" in lesson.lyrics[0], false, "a language equal to the song is omitted");
  assert.deepEqual(lesson.grammar[0].lineIds, ["line-1"], "grammar links are published for card playback");
  assert.deepEqual(validateLessonStructure(lesson), [], "the lesson is v1 as Android 0.1.1 reads it");

  const reordered = structuredClone(sameLanguage);
  reordered.lyrics[1].language = undefined;
  reordered.grammar[0].lineIds = ["line-2", "line-1"];
  const ordered = assembleLesson({ content: reordered, marks, media, rights });
  assert.deepEqual(ordered.grammar[0].lineIds, ["line-1", "line-2"], "links follow the lyric order");

  const emptied = structuredClone(sameLanguage);
  emptied.grammar[0].lineIds = [];
  assert.deepEqual(validateDraftStructure(emptied), [], "an emptied link list is fine while editing");
  const withoutLinks = assembleLesson({ content: emptied, marks, media, rights });
  assert.equal("lineIds" in withoutLinks.grammar[0], false, "an empty list never reaches lesson.json");
  assert.deepEqual(validateLessonStructure(withoutLinks), []);

  const broken = structuredClone(lesson) as unknown as { grammar: { lineIds?: string[] }[] };
  broken.grammar[0].lineIds = [];
  assert.ok(validateLessonStructure(broken).length > 0, "the published contract requires 1–50 ids");
});

test("the vendored lesson schema is Android 0.1.1's file, widened idempotently", () => {
  const raw = fs.readFileSync(path.join(__dirname, "..", "contracts", "lesson.schema.json"), "utf8");
  const schema = JSON.parse(raw) as { $defs: Record<string, { pattern?: string; enum?: string[]; properties?: Record<string, unknown> }> };
  assert.deepEqual(schema.$defs.language.enum, ["en", "es", "ko", "tr"]);
  assert.ok(schema.$defs.grammarItem.properties?.lineIds, "grammar lineIds is in the contract");
});
