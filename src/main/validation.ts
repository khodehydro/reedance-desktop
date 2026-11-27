import fs from "node:fs";
import path from "node:path";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { SUPPORTED_LANGUAGES, type DraftContent, type Issue, type Lesson, type Question } from "../shared/types";

/**
 * JSON Schema + semantic validation for the v1 contract.
 *
 * Both local schemas are registered without network access:
 * `urn:reedance:lesson:v1` also supplies `$defs` for the draft schema.
 * JSON Schema only covers structure; the cross-field, timing and reference
 * rules from PACKAGE_V1.md are enforced here as well.
 */
let ajv: Ajv2020 | null = null;
let draftValidator: ValidateFunction | null = null;
let lessonValidator: ValidateFunction | null = null;

function contractsDir(): string {
  const override = process.env.REEDANCE_CONTRACTS_DIR;
  if (override) return override;
  return path.join(__dirname, "..", "..", "contracts");
}

function loadSchema(name: string): Record<string, unknown> {
  const file = path.join(contractsDir(), name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** `^(?:en|es|ko)` style prefix used by the locale and lexemeId patterns. */
const LANGUAGE_PREFIX_PATTERN = `(?:${SUPPORTED_LANGUAGES.join("|")})`;

/**
 * Widen the vendored v1 schemas to the languages the studio supports.
 *
 * The `contracts/` copies stay byte-identical to the upstream repository so
 * they can be diffed and audited; the (single) Turkish extension is applied in
 * memory instead, next to the validation code that owns it. Without this every
 * field of a `tr` draft fails with "must be equal to one of the allowed values".
 */
function extendContractLanguages(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === "enum" && Array.isArray(value) && value.length === 3 && ["en", "es", "ko"].every((lang) => value.includes(lang))) {
        record[key] = [...SUPPORTED_LANGUAGES];
        continue;
      }
      if (typeof value === "string" && value.includes("?:en|es|ko")) {
        record[key] = value.split("^(?:en|es|ko)").join(`^(?:${SUPPORTED_LANGUAGES.join("|")})`);
        continue;
      }
      visit(value);
    }
  };
  visit(schema);
  return schema;
}

function newAjv(): Ajv2020 {
  const instance = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: true,
  });
  addFormats(instance);
  return instance;
}

/**
 * Authoring-only fields the draft may carry on top of lesson v1. They link a
 * card to the song for playback in the studio and are stripped by
 * `assembleLesson`, so the published lesson.json stays exactly v1.
 */
export function extendDraftOnlyFields(lessonSchema: Record<string, unknown>): Record<string, unknown> {
  const defs = lessonSchema.$defs as Record<string, { properties?: Record<string, unknown> }>;
  const grammar = defs?.grammarItem;
  if (grammar?.properties) {
    grammar.properties.lineIds = {
      type: "array",
      maxItems: 20,
      uniqueItems: true,
      items: { $ref: "#/$defs/id" },
      description: "Studio-only: lyric lines this grammar card explains (played from the card). Not in lesson.json v1.",
    };
  }
  return lessonSchema;
}

function ensureAjv(): void {
  if (ajv) return;
  // Published lesson: the pinned v1 contract, nothing more.
  const lessonInstance = newAjv();
  const lessonSchema = extendContractLanguages(loadSchema("lesson.schema.json"));
  lessonInstance.addSchema(lessonSchema, "urn:reedance:lesson:v1");
  lessonValidator = lessonInstance.getSchema("urn:reedance:lesson:v1") ?? lessonInstance.compile(lessonSchema);
  // Draft: same definitions plus the authoring-only link fields.
  const draftInstance = newAjv();
  const draftLesson = extendDraftOnlyFields(extendContractLanguages(loadSchema("lesson.schema.json")));
  const draftSchema = extendContractLanguages(loadSchema("draft.schema.json"));
  draftInstance.addSchema(draftLesson, "urn:reedance:lesson:v1");
  draftInstance.addSchema(draftSchema, "urn:reedance:draft:v1");
  draftValidator = draftInstance.getSchema("urn:reedance:draft:v1") ?? draftInstance.compile(draftSchema);
  ajv = lessonInstance;
}

function ajvIssues(errors: ErrorObject[] | null | undefined, root: string): Issue[] {
  if (!errors) return [];
  return errors.map((error) => {
    const location = error.instancePath ? `${root}${error.instancePath}` : root;
    const extra = error.params && Object.keys(error.params).length ? ` (${JSON.stringify(error.params)})` : "";
    return {
      path: location,
      message: `${error.message ?? "is invalid"}${extra}`,
      severity: "error" as const,
    };
  });
}

/** Structural validation of an imported `.rddraft.json`. */
export function validateDraftStructure(value: unknown): Issue[] {
  ensureAjv();
  const ok = draftValidator!(value);
  if (ok) return [];
  return ajvIssues(draftValidator!.errors, "$");
}

/** Structural validation of the published `lesson.json`. */
export function validateLessonStructure(value: unknown): Issue[] {
  ensureAjv();
  const ok = lessonValidator!(value);
  if (ok) return [];
  return ajvIssues(lessonValidator!.errors, "$");
}

/** NFC + lowercase lemma key used for unique vocabulary counting. */
export function normalizeKey(value: string): string {
  return value.normalize("NFC").toLowerCase().trim();
}

/** Answer normalization for `typing` questions (accent/Hangul preserved). */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[.!?,…]+$/u, "")
    .trim();
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEXEME_RE = new RegExp(`^${LANGUAGE_PREFIX_PATTERN}:[a-z0-9]+(?:-[a-z0-9]+)*$`);

function duplicateIds(prefix: string, items: { id: string }[]): Issue[] {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      issues.push({ path: `${prefix}[${index}].id`, message: `duplicate id "${item.id}"`, severity: "error" });
    }
    seen.add(item.id);
  });
  return issues;
}

function isCellObject(value: unknown): value is { fa?: unknown; en?: unknown } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Cross-field rules shared by draft and published lesson content. */
export function validateContentSemantics(content: DraftContent): Issue[] {
  const issues: Issue[] = [];
  const lang = content.targetLanguage;
  const lineIds = new Set(content.lyrics.map((line) => line.id));
  const lexemeIds = new Set<string>();

  issues.push(...duplicateIds("lyrics", content.lyrics));
  issues.push(...duplicateIds("grammar", content.grammar));
  issues.push(...duplicateIds("idioms", content.idioms));
  issues.push(...duplicateIds("sentences", content.sentences));
  issues.push(...duplicateIds("questions", content.questions));

  // Lines sung in another language are shown with a badge and never taught.
  const foreignLines = new Map<string, string>();
  content.lyrics.forEach((line, index) => {
    if (line.language !== undefined) {
      if (typeof line.language !== "string" || !/^[a-z]{2,3}$/.test(line.language)) {
        issues.push({ path: `lyrics[${index}].language`, message: "language must be a 2–3 letter lowercase ISO code", severity: "error" });
      } else if (line.language === lang) {
        issues.push({
          path: `lyrics[${index}].language`,
          message: `language "${line.language}" equals the song language; omit the field`,
          severity: "warning",
        });
      } else {
        foreignLines.set(line.id, line.language);
      }
    }
  });
  const foreignLink = (path: string, lineId: string | undefined, what: string): void => {
    if (!lineId || !foreignLines.has(lineId)) return;
    issues.push({
      path,
      message: `${what} points to line "${lineId}", which is in another language (${foreignLines.get(lineId)}) and must not be taught`,
      severity: "error",
    });
  };

  content.lyrics.forEach((line, index) => {
    if (!ID_RE.test(line.id)) {
      issues.push({ path: `lyrics[${index}].id`, message: `line id "${line.id}" is not a valid slug`, severity: "error" });
    }
    if (line.tokens.length === 0) {
      issues.push({ path: `lyrics[${index}].tokens`, message: "a line needs at least one token", severity: "error" });
    }
    const joined = line.tokens
      .map((token) => token.surface)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const text = line.text.replace(/\s+/g, " ").trim();
    if (joined && text && joined.toLocaleLowerCase() !== text.toLocaleLowerCase()) {
      issues.push({
        path: `lyrics[${index}].tokens`,
        message: "token surfaces do not reconstruct the line text; check for a missing or extra token",
        severity: "warning",
      });
    }
  });

  if (content.story) {
    const draftPages = content.story.pages as { id?: string; lines: { id?: string; text: string; tokens?: { surface: string }[]; words?: { text: string }[] }[] }[];
    draftPages.forEach((page, pageIndex) => {
      if (page.id !== undefined && !ID_RE.test(page.id)) {
        issues.push({ path: `story.pages[${pageIndex}].id`, message: `page id "${page.id}" is not a valid slug`, severity: "error" });
      }
      const namedLines = page.lines.filter((line) => line.id !== undefined) as { id: string }[];
      issues.push(...duplicateIds(`story.pages[${pageIndex}].lines`, namedLines));
      page.lines.forEach((line, lineIndex) => {
        const path = `story.pages[${pageIndex}].lines[${lineIndex}]`;
        if (line.id !== undefined && !ID_RE.test(line.id)) {
          issues.push({ path: `${path}.id`, message: `story line id "${line.id}" is not a valid slug`, severity: "error" });
        }
        const glosses = (line.tokens ?? line.words ?? []) as { surface?: string; text?: string }[];
        const joined = glosses
          .map((gloss) => gloss.surface ?? gloss.text ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const text = line.text.replace(/\s+/g, " ").trim();
        if (joined && text && joined.toLocaleLowerCase() !== text.toLocaleLowerCase()) {
          issues.push({
            path: `${path}.tokens`,
            message: "token surfaces do not reconstruct the story line text; check for a missing or extra token",
            severity: "warning",
          });
        }
      });
    });
  }

  content.vocabulary.forEach((word, index) => {
    if (!LEXEME_RE.test(word.lexemeId)) {
      issues.push({ path: `vocabulary[${index}].lexemeId`, message: `lexemeId "${word.lexemeId}" must look like "${lang}:slug"`, severity: "error" });
    }
    if (!word.lexemeId.startsWith(`${lang}:`)) {
      issues.push({ path: `vocabulary[${index}].lexemeId`, message: `lexemeId prefix must match targetLanguage "${lang}"`, severity: "error" });
    }
    if (lexemeIds.has(word.lexemeId)) {
      issues.push({ path: `vocabulary[${index}].lexemeId`, message: `duplicate lexemeId "${word.lexemeId}"`, severity: "error" });
    }
    lexemeIds.add(word.lexemeId);
    const expected = normalizeKey(word.lemma);
    if (word.normalizedKey !== expected) {
      issues.push({
        path: `vocabulary[${index}].normalizedKey`,
        message: `normalizedKey should be NFC/lowercase of the lemma ("${expected}")`,
        severity: "warning",
      });
    }
    if (word.tables) {
      word.tables.forEach((table, tableIndex) => validateTable(table, `vocabulary[${index}].tables[${tableIndex}]`, issues));
    }
  });

  content.lyrics.forEach((line, lineIndex) => {
    line.tokens.forEach((token, tokenIndex) => {
      if (!token.lexemeId) return;
      if (foreignLines.has(line.id)) {
        issues.push({
          path: `lyrics[${lineIndex}].tokens[${tokenIndex}].lexemeId`,
          message: `line is in another language (${foreignLines.get(line.id)}): its words are not taught, remove the lexemeId`,
          severity: "error",
        });
      }
      if (!lexemeIds.has(token.lexemeId)) {
        issues.push({
          path: `lyrics[${lineIndex}].tokens[${tokenIndex}].lexemeId`,
          message: `token references "${token.lexemeId}" which is not in vocabulary[]`,
          severity: "error",
        });
      }
    });
  });

  content.grammar.forEach((item, index) => {
    if (item.conceptId && !LEXEME_RE.test(item.conceptId)) {
      issues.push({ path: `grammar[${index}].conceptId`, message: "conceptId must use the language-prefixed slug form", severity: "error" });
    }
    if (item.conceptId && !item.conceptId.startsWith(`${lang}:`)) {
      issues.push({ path: `grammar[${index}].conceptId`, message: `conceptId prefix must be "${lang}:"`, severity: "error" });
    }
    (item.tables ?? []).forEach((table, tableIndex) => validateTable(table, `grammar[${index}].tables[${tableIndex}]`, issues));
    (item.lineIds ?? []).forEach((lineId, linkIndex) => {
      if (!lineIds.has(lineId)) {
        issues.push({ path: `grammar[${index}].lineIds[${linkIndex}]`, message: `unknown line "${lineId}"`, severity: "error" });
      }
      foreignLink(`grammar[${index}].lineIds[${linkIndex}]`, lineId, "grammar card");
    });
  });

  content.vocabularyTables.forEach((table, index) => validateTable(table, `vocabularyTables[${index}]`, issues));

  const phrases: { prefix: string; list: typeof content.idioms }[] = [
    { prefix: "idioms", list: content.idioms },
    { prefix: "sentences", list: content.sentences },
  ];
  for (const { prefix, list } of phrases) {
    list.forEach((phrase, index) => {
      if (phrase.lineId && !lineIds.has(phrase.lineId)) {
        issues.push({ path: `${prefix}[${index}].lineId`, message: `unknown line "${phrase.lineId}"`, severity: "error" });
      }
      foreignLink(`${prefix}[${index}].lineId`, phrase.lineId, prefix === "idioms" ? "idiom" : "sentence");
    });
  }

  content.questions.forEach((question, index) => {
    issues.push(...validateQuestion(question, `questions[${index}]`, lineIds, lexemeIds));
    foreignLink(`questions[${index}].lineId`, question.lineId, "question");
  });

  if (content.idAliases) {
    const seen = new Set<string>();
    content.idAliases.forEach((alias, index) => {
      if (alias.from === alias.to) {
        issues.push({ path: `idAliases[${index}]`, message: "alias source and target must differ", severity: "error" });
      }
      const key = `${alias.kind}:${alias.from}`;
      if (seen.has(key)) {
        issues.push({ path: `idAliases[${index}]`, message: `duplicate alias source "${alias.from}"`, severity: "error" });
      }
      seen.add(key);
      const targetExists =
        alias.kind === "lexeme"
          ? lexemeIds.has(alias.to)
          : alias.kind === "line"
            ? lineIds.has(alias.to)
            : alias.kind === "grammar"
              ? content.grammar.some((item) => item.id === alias.to)
              : alias.kind === "idiom"
                ? content.idioms.some((item) => item.id === alias.to)
                : content.sentences.some((item) => item.id === alias.to);
      if (!targetExists) {
        issues.push({ path: `idAliases[${index}].to`, message: `alias target "${alias.to}" does not exist in this version`, severity: "warning" });
      }
    });
  }

  return issues;
}

function validateTable(
  table: { columns?: unknown[]; rows?: unknown[][]; titleFa?: string; titleEn?: string } | undefined,
  prefix: string,
  issues: Issue[],
): void {
  if (!table) {
    issues.push({ path: prefix, message: "table is missing", severity: "error" });
    return;
  }
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (columns.length < 1) issues.push({ path: `${prefix}.columns`, message: "a table needs at least one header cell", severity: "error" });
  if (rows.length < 1) issues.push({ path: `${prefix}.rows`, message: "a table needs at least one data row", severity: "error" });
  if (columns.length > 8) issues.push({ path: `${prefix}.columns`, message: "at most 8 columns are allowed", severity: "error" });
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      issues.push({
        path: `${prefix}.rows[${rowIndex}]`,
        message: `row has ${Array.isArray(row) ? row.length : 0} cells but the header has ${columns.length}`,
        severity: "error",
      });
      return;
    }
    row.forEach((cell, cellIndex) => {
      if (isCellObject(cell)) {
        if (typeof cell.fa !== "string" || typeof cell.en !== "string") {
          issues.push({ path: `${prefix}.rows[${rowIndex}][${cellIndex}]`, message: "bilingual cells need both fa and en", severity: "error" });
        }
      } else if (typeof cell !== "string") {
        issues.push({ path: `${prefix}.rows[${rowIndex}][${cellIndex}]`, message: "cell must be text or {fa,en}", severity: "error" });
      }
    });
  });
  if (!table.titleFa || !table.titleEn) {
    issues.push({ path: `${prefix}`, message: "table titleFa/titleEn are required", severity: "error" });
  }
}

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function isPermutation(order: string[] | undefined, ids: string[]): boolean {
  if (!order) return true;
  if (order.length !== ids.length || new Set(order).size !== order.length) return false;
  const set = new Set(ids);
  return order.every((id) => set.has(id));
}

function validateQuestion(question: Question, prefix: string, lineIds: Set<string>, lexemeIds: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (!ID_RE.test(question.id)) {
    issues.push({ path: `${prefix}.id`, message: "question id is not a valid slug", severity: "error" });
  }
  if (question.lineId && !lineIds.has(question.lineId)) {
    issues.push({ path: `${prefix}.lineId`, message: `unknown line "${question.lineId}"`, severity: "error" });
  }
  (question.relatedLexemeIds ?? []).forEach((lexemeId, index) => {
    if (!lexemeIds.has(lexemeId)) {
      issues.push({ path: `${prefix}.relatedLexemeIds[${index}]`, message: `unknown lexeme "${lexemeId}"`, severity: "error" });
    }
  });
  if (!question.explanationFa?.trim() || !question.explanationEn?.trim()) {
    issues.push({ path: prefix, message: "each question needs fa and en explanations", severity: "error" });
  }

  if (question.type === "choice") {
    if (question.options.length < 2) {
      issues.push({ path: `${prefix}.options`, message: "choice questions need at least two options", severity: "error" });
    }
    if (!uniqueIds(question.options)) {
      issues.push({ path: `${prefix}.options`, message: "option ids must be unique", severity: "error" });
    }
    if (!question.options.some((option) => option.id === question.correctId)) {
      issues.push({ path: `${prefix}.correctId`, message: `correctId "${question.correctId}" is not one of the options`, severity: "error" });
    }
  } else if (question.type === "match") {
    if (question.pairs.length < 2) {
      issues.push({ path: `${prefix}.pairs`, message: "match questions need at least two pairs", severity: "error" });
    }
    if (!uniqueIds(question.pairs)) {
      issues.push({ path: `${prefix}.pairs`, message: "pair ids must be unique", severity: "error" });
    }
    question.pairs.forEach((pair, index) => {
      if (!lexemeIds.has(pair.lexemeId)) {
        issues.push({ path: `${prefix}.pairs[${index}].lexemeId`, message: `unknown lexeme "${pair.lexemeId}"`, severity: "error" });
      }
    });
    if (question.meaningOrder && !isPermutation(question.meaningOrder, question.pairs.map((pair) => pair.id))) {
      issues.push({ path: `${prefix}.meaningOrder`, message: "meaningOrder must be a permutation of the pair ids", severity: "error" });
    }
  } else if (question.type === "order") {
    if (question.chunks.length < 2) {
      issues.push({ path: `${prefix}.chunks`, message: "order questions need at least two chunks", severity: "error" });
    }
    if (!uniqueIds(question.chunks)) {
      issues.push({ path: `${prefix}.chunks`, message: "chunk ids must be unique", severity: "error" });
    }
    if (question.presentationOrder && !isPermutation(question.presentationOrder, question.chunks.map((chunk) => chunk.id))) {
      issues.push({ path: `${prefix}.presentationOrder`, message: "presentationOrder must be a permutation of the chunk ids", severity: "error" });
    }
  } else if (question.type === "typing") {
    if (!question.context?.trim()) {
      issues.push({ path: `${prefix}.context`, message: "typing questions need a sentence with a gap", severity: "error" });
    }
    const normalized = question.accepted.map(normalizeAnswer);
    if (new Set(normalized).size !== normalized.length) {
      issues.push({ path: `${prefix}.accepted`, message: "accepted answers duplicate each other after normalization", severity: "error" });
    }
    if (normalized.some((answer) => answer.length === 0)) {
      issues.push({ path: `${prefix}.accepted`, message: "accepted answers cannot be empty", severity: "error" });
    }
  }
  return issues;
}

function contentErrorMessage(issue: Issue): string {
  return `${issue.path}: ${issue.message}`;
}

export function formatIssues(issues: Issue[]): string {
  return issues.map(contentErrorMessage).join("; ");
}

const FORBIDDEN_KEYS = new Set([
  "media",
  "startMs",
  "endMs",
  "audio",
  "audioPath",
  "audioBase64",
  "coverPath",
  "base64",
  "dataUrl",
  "encryptionKey",
  "signature",
]);

/** Reject media/timings/keys smuggled through the content-only draft. */
export function findForbiddenKeys(value: unknown, prefix = "$"): Issue[] {
  const issues: Issue[] = [];
  const walk = (node: unknown, location: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${location}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && /^data:(?:audio|image)\//i.test(node.trim())) {
        issues.push({ path: location, message: "embedded media data URLs are not allowed in a raw draft", severity: "error" });
      }
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) {
        issues.push({
          path: `${location}.${key}`,
          message: `"${key}" is not allowed in a content-only draft (Windows selects media and owns timing)`,
          severity: "error",
        });
      }
      walk(child, `${location}.${key}`);
    }
  };
  walk(value, prefix);
  return issues;
}

/** Timing + reference checks that only apply to the published lesson. */
export function validateLessonSemantics(lesson: Lesson, mediaDurationMs: number, audioSha256: string): Issue[] {
  const issues = validateContentSemantics(lesson as unknown as DraftContent);
  const seen = new Set<number>();
  lesson.lyrics.forEach((line, index) => {
    if (!Number.isInteger(line.startMs) || line.startMs < 0) {
      issues.push({ path: `lyrics[${index}].startMs`, message: "startMs must be a non-negative integer", severity: "error" });
      return;
    }
    if (line.startMs >= mediaDurationMs) {
      issues.push({
        path: `lyrics[${index}].startMs`,
        message: `startMs ${line.startMs} is outside the ${mediaDurationMs} ms audio`,
        severity: "error",
      });
    }
    if (seen.has(line.startMs)) {
      issues.push({ path: `lyrics[${index}].startMs`, message: `startMs ${line.startMs} is used by another line`, severity: "error" });
    }
    seen.add(line.startMs);
    if (index > 0 && line.startMs <= lesson.lyrics[index - 1].startMs) {
      issues.push({ path: `lyrics[${index}].startMs`, message: "lyric starts must increase strictly", severity: "error" });
    }
    if (line.endMs !== undefined) {
      if (line.endMs <= line.startMs) {
        issues.push({ path: `lyrics[${index}].endMs`, message: "endMs must be after startMs", severity: "error" });
      } else if (line.endMs > mediaDurationMs) {
        issues.push({ path: `lyrics[${index}].endMs`, message: "endMs is after the end of the audio", severity: "error" });
      } else {
        const next = lesson.lyrics[index + 1];
        if (next && line.endMs > next.startMs) {
          issues.push({ path: `lyrics[${index}].endMs`, message: "endMs overlaps the next line", severity: "warning" });
        }
      }
    }
  });
  if (lesson.media.audio.sha256 !== audioSha256) {
    issues.push({ path: "media.audio.sha256", message: "media hash does not match the local audio copy", severity: "error" });
  }
  if (Math.abs(lesson.media.audio.durationMs - mediaDurationMs) > 1000) {
    issues.push({ path: "media.audio.durationMs", message: "declared duration differs from the audio by more than 1 s", severity: "error" });
  }
  if (!lesson.artist?.trim()) issues.push({ path: "artist", message: "artist is required for export", severity: "error" });
  if (!lesson.credits?.audio?.trim()) issues.push({ path: "credits.audio", message: "audio credit is required", severity: "error" });
  if (!lesson.credits?.lyrics?.trim()) issues.push({ path: "credits.lyrics", message: "lyrics credit is required", severity: "error" });
  if (lesson.media.cover && !lesson.credits?.cover?.trim()) {
    issues.push({ path: "credits.cover", message: "a cover is included but credits.cover is empty", severity: "error" });
  }
  if (lesson.media.storyAudio) {
    const story = lesson.media.storyAudio;
    if (!Number.isInteger(story.durationMs) || story.durationMs < 1 || story.durationMs > 86400000) {
      issues.push({ path: "media.storyAudio.durationMs", message: "story audio duration must be between 1 ms and 24 h", severity: "error" });
    }
    if (!/^story\.(mp3|m4a|wav)$/.test(story.path)) {
      issues.push({ path: "media.storyAudio.path", message: "story audio path must be story.mp3, story.m4a or story.wav", severity: "error" });
    }
  }
  return issues;
}

/** Strict JSON parser: rejects duplicate keys, NaN/Infinity and trailing data. */
export function parseStrictJson(text: string): unknown {
  let index = 0;
  const length = text.length;
  const pathStack: string[] = [];

  const fail = (message: string): never => {
    throw new Error(`${message} at offset ${index}${pathStack.length ? ` (${pathStack.join("")})` : ""}`);
  };
  const skipWhitespace = (): void => {
    while (index < length) {
      const char = text[index];
      if (char === " " || char === "\t" || char === "\n" || char === "\r") index += 1;
      else break;
    }
  };
  const parseString = (): string => {
    const start = index;
    index += 1; // opening quote
    while (index < length) {
      const char = text[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          return fail("invalid string escape");
        }
      }
      if (char === "\n" || char === "\r") return fail("newline inside string");
      index += 1;
    }
    return fail("unterminated string");
  };
  const parseNumber = (): number => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) return fail("invalid number");
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return fail("number is not finite");
    return value;
  };
  const parseValue = (): unknown => {
    skipWhitespace();
    const char = text[index];
    if (char === "{") {
      index += 1;
      const object: Record<string, unknown> = {};
      const keys = new Set<string>();
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      for (;;) {
        skipWhitespace();
        if (text[index] !== '"') return fail("object key must be a string");
        const key = parseString();
        if (keys.has(key)) return fail(`duplicate object key "${key}"`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") return fail("expected ':' after object key");
        index += 1;
        pathStack.push(`.${key}`);
        object[key] = parseValue();
        pathStack.pop();
        skipWhitespace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "}") {
          index += 1;
          return object;
        }
        return fail("expected ',' or '}'");
      }
    }
    if (char === "[") {
      index += 1;
      const array: unknown[] = [];
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      for (;;) {
        pathStack.push(`[${array.length}]`);
        array.push(parseValue());
        pathStack.pop();
        skipWhitespace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "]") {
          index += 1;
          return array;
        }
        return fail("expected ',' or ']'");
      }
    }
    if (char === '"') return parseString();
    if (char === "-" || (char >= "0" && char <= "9")) return parseNumber();
    if (text.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (text.startsWith("null", index)) {
      index += 4;
      return null;
    }
    return fail("unexpected token");
  };

  if (text.charCodeAt(0) === 0xfeff) fail("UTF-8 BOM is not allowed");
  const value = parseValue();
  skipWhitespace();
  if (index !== length) fail("trailing data after JSON value");
  return value;
}
