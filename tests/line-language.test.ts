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

test("lesson.json keeps the line language and drops the studio-only grammar links", () => {
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
  assert.equal("lineIds" in lesson.grammar[0], false, "grammar links never reach lesson.json");
  assert.deepEqual(validateLessonStructure(lesson), [], "the lesson is exactly v1 (Android's strict reader accepts it)");

  const leaked = structuredClone(lesson) as unknown as { grammar: { lineIds?: string[] }[] };
  leaked.grammar[0].lineIds = ["line-1"];
  assert.ok(validateLessonStructure(leaked).length > 0, "the lesson schema itself would reject the link");
});
