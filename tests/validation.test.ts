import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  findForbiddenKeys,
  normalizeAnswer,
  parseStrictJson,
  validateContentSemantics,
} from "../src/main/validation";
import type { DraftContent } from "../src/shared/types";

const fixture = path.join(__dirname, "..", "contracts", "fixtures", "quiet-step.rddraft.json");
const baseDraft = (): DraftContent => JSON.parse(fs.readFileSync(fixture, "utf8")) as DraftContent;

test("the fixture draft has no semantic errors", () => {
  const issues = validateContentSemantics(baseDraft());
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
});

test("duplicate line ids, broken references and bad table widths are reported with paths", () => {
  const draft = baseDraft();
  draft.lyrics[1].id = draft.lyrics[0].id;
  draft.questions[0].lineId = "line-does-not-exist";
  draft.grammar[0].tables![0].rows[0] = ["only-one-cell"];
  const issues = validateContentSemantics(draft);
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.some((value) => value === "lyrics[1].id"));
  assert.ok(paths.some((value) => value === "questions[0].lineId"));
  assert.ok(paths.some((value) => value.startsWith("grammar[0].tables[0].rows")));
});

test("token lexeme references must exist in the vocabulary", () => {
  const draft = baseDraft();
  draft.lyrics[0].tokens[0].lexemeId = "en:not-defined";
  const issues = validateContentSemantics(draft);
  assert.ok(issues.some((issue) => issue.path === "lyrics[0].tokens[0].lexemeId" && issue.severity === "error"));
});

test("quiz correctness and permutations are validated", () => {
  const draft = baseDraft();
  const choice = draft.questions.find((question) => question.type === "choice");
  if (choice?.type === "choice") choice.correctId = "missing-option";
  const match = draft.questions.find((question) => question.type === "match");
  if (match?.type === "match") match.meaningOrder = ["p1"];
  const issues = validateContentSemantics(draft);
  assert.ok(issues.some((issue) => issue.path.includes(".correctId")));
  assert.ok(issues.some((issue) => issue.path.includes(".meaningOrder")));
});

test("typing answers normalize NFC, case and trailing punctuation but keep accents", () => {
  assert.equal(normalizeAnswer("  Sí.  "), "sí");
  assert.equal(normalizeAnswer("QUIET!"), "quiet");
  assert.notEqual(normalizeAnswer("sí"), normalizeAnswer("si"));
});

test("media, timings and keys are rejected inside a raw draft", () => {
  const issues = findForbiddenKeys({
    media: { audio: "x" },
    lyrics: [{ startMs: 10, tokens: [{ surface: "data:audio/wav;base64,AAAA" }] }],
  });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes("$.media"));
  assert.ok(paths.includes("$.lyrics[0].startMs"));
  assert.ok(paths.some((value) => value.endsWith("surface")));
});

test("strict JSON parsing rejects duplicate keys and trailing data", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate object key/);
  assert.throws(() => parseStrictJson('{"a":1} extra'), /trailing data/);
  assert.throws(() => parseStrictJson('{"a":NaN}'), /unexpected token/);
  assert.deepEqual(parseStrictJson('{"a":[1,2,{"b":true}],"c":null}'), { a: [1, 2, { b: true }], c: null });
  assert.throws(() => parseStrictJson('\uFEFF{"a":1}'), /BOM/);
});

test("idAliases must be one-to-one and point at existing ids", () => {
  const draft = baseDraft();
  draft.idAliases = [
    { kind: "line", from: "old-line", to: "line-1" },
    { kind: "line", from: "old-line", to: "line-2" },
    { kind: "line", from: "same", to: "same" },
  ];
  const issues = validateContentSemantics(draft);
  assert.ok(issues.some((issue) => issue.message.includes("duplicate alias source")));
  assert.ok(issues.some((issue) => issue.message.includes("must differ")));
});
