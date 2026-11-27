/**
 * Offline validator for song drafts (`*.rddraft.json`) — for the content agent.
 *
 *   npm run validate:draft -- <file-or-dir> [...more] [--strict] [--json]
 *
 * Layer 1 (always blocking) runs the exact checks the studio runs on import:
 * UTF-8 without BOM, strict JSON (no duplicate keys), no media/timing keys,
 * the draft JSON schema (with the studio's tr extension and draft-only
 * grammar.lineIds) and every semantic rule (token reconstruction, lexeme
 * references, foreign-language lines that must not be taught, question
 * integrity, tables...).
 *
 * Layer 2 ("quality") encodes the editorial rules of
 * docs/prompts/SONG_DRAFT_AGENT_PROMPT_FA.md: no section labels in the
 * lyrics, a story of at least 25 lines plus its .story.txt twin, vocabulary
 * examples that are not copied from the song, pronunciation and part of
 * speech on every word, conjugation tables on verbs, noun gender/plural for
 * Spanish, lexeme coverage... These are warnings unless --strict is given.
 *
 * Exit code 0 = every file passes (in --strict mode: quality too), 1 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { findForbiddenKeys, normalizeKey, parseStrictJson, validateContentSemantics, validateDraftStructure } from "../src/main/validation";
import type { DraftContent, Issue } from "../src/shared/types";

process.env.REEDANCE_CONTRACTS_DIR ??= path.join(__dirname, "..", "contracts");

const DRAFT_MAX_BYTES = 4 * 1024 * 1024;
const MIN_STORY_LINES = 25;
const MIN_QUESTIONS = 12;
const MIN_LEXEME_COVERAGE = 0.85;

/** Structural labels that must never be part of the lyric text (en/es/ko/tr). */
const LABEL_WORDS =
  "intro|outro|verse|pre[- ]?chorus|post[- ]?chorus|chorus|hook|bridge|refrain|interlude|break|drop|rap|spoken|instrumental|coro|pre[- ]?coro|estribillo|verso|estrofa|puente|introducci[oó]n|nakarat|giri[sş]|k[oö]pr[uü]|후렴|벌스|브릿지|인트로|아웃트로|랩|훅|코러스";
/** A bare label ("Chorus", "Verse 2", "[Bridge]") or a label introducing text ("Coro: …"). */
const SECTION_LABEL = new RegExp(`^\\s*[\\[(（【{]?\\s*(?:${LABEL_WORDS})(?:\\s*\\d+)?\\s*[\\])）】}]?\\s*(?::.*)?$`, "iu");
const BRACKETED_ONLY = /^\s*[[(（【{][^\])）】}]*[\])）】}]\s*$/u;
const REPEAT_MARK = /(?:^|\s)[x×]\s?\d+\s*$|\(\s*[x×]\s?\d+\s*\)|\brepeat\b|\brepetir\b|\btekrar\b|반복/iu;
const LETTER = /\p{L}/u;

interface FileReport {
  file: string;
  errors: Issue[];
  warnings: Issue[];
  quality: Issue[];
  stats: Record<string, number | string>;
}

function collect(target: string, out: string[]): void {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      collect(path.join(target, name), out);
    }
  } else if (/\.rddraft\.json$/i.test(target) || (out.length === 0 && /\.json$/i.test(target))) {
    out.push(target);
  }
}

const norm = (value: string): string => normalizeKey(value).replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

function quality(file: string, draft: DraftContent): { issues: Issue[]; stats: Record<string, number | string> } {
  const issues: Issue[] = [];
  const q = (where: string, message: string): void => void issues.push({ path: where, message, severity: "warning" });
  const lang = draft.targetLanguage;
  const isForeign = (line: { language?: string }): boolean => !!line.language && line.language !== lang;

  // Lyrics: no structure labels / repeat markers; repeats must be written out.
  draft.lyrics.forEach((line, index) => {
    if (SECTION_LABEL.test(line.text) || BRACKETED_ONLY.test(line.text)) {
      q(`lyrics[${index}].text`, `looks like a section label ("${line.text}") — remove labels such as [Chorus]/Verse/Coro/후렴 and write the sung lines instead`);
    } else if (REPEAT_MARK.test(line.text)) {
      q(`lyrics[${index}].text`, `contains a repeat marker ("${line.text}") — write every repetition out as its own line, in sung order`);
    }
  });

  // Lexeme coverage on song-language lines.
  let wordTokens = 0;
  let linked = 0;
  const missing = new Set<string>();
  for (const line of draft.lyrics) {
    if (isForeign(line)) continue;
    for (const token of line.tokens) {
      if (!LETTER.test(token.surface)) continue;
      wordTokens += 1;
      if (token.lexemeId) linked += 1;
      else missing.add(token.surface);
    }
  }
  const coverage = wordTokens ? linked / wordTokens : 1;
  if (coverage < MIN_LEXEME_COVERAGE) {
    q("lyrics", `only ${(coverage * 100).toFixed(0)}% of song-language word tokens have a lexemeId (minimum ${MIN_LEXEME_COVERAGE * 100}%); without lexeme: ${[...missing].slice(0, 30).join(", ")}`);
  }

  // Vocabulary: pronunciation, part of speech, examples outside the song, verb tables, noun data.
  const lyricText = draft.lyrics.map((line) => norm(line.text));
  draft.vocabulary.forEach((word, index) => {
    const at = `vocabulary[${index}]`;
    for (const key of ["ipa", "faReading", "partFa", "partEn"] as const) {
      if (!word[key]?.trim()) q(`${at}.${key}`, `${key} is missing for "${word.lemma}"`);
    }
    const example = norm(word.example.text);
    if (example && lyricText.some((line) => line === example || (example.length > 12 && line.includes(example)))) {
      q(`${at}.example`, `the example of "${word.lemma}" is copied from the song — use a new sentence outside the lyrics`);
    }
    const part = (word.partEn ?? "").toLowerCase();
    if (/\bverb\b/.test(part) && !/auxiliary|modal/.test(part) && !(word.tables?.length)) {
      q(`${at}.tables`, `verb "${word.lemma}" has no conjugation table (all persons, in the tense used in the song)`);
    }
    if (lang === "es" && /\bnoun\b/.test(part) && !/proper/.test(part)) {
      for (const key of ["article", "genderFa", "genderEn", "plural"] as const) {
        if (!word[key]?.trim()) q(`${at}.${key}`, `Spanish noun "${word.lemma}" needs ${key}`);
      }
    }
  });

  // Phrases need context (this is where literal vs. real meaning is explained).
  (["idioms", "sentences"] as const).forEach((kind) =>
    draft[kind].forEach((phrase, index) => {
      if (!phrase.contextFa?.trim() || !phrase.contextEn?.trim()) q(`${kind}[${index}]`, `"${phrase.text}" needs contextFa and contextEn`);
    }),
  );

  // Questions.
  if (draft.questions.length < MIN_QUESTIONS) q("questions", `only ${draft.questions.length} questions (minimum ${MIN_QUESTIONS})`);
  draft.questions.forEach((question, index) => {
    if (question.type === "typing" && !/_{3,}/.test(question.context)) q(`questions[${index}].context`, "typing context must contain the gap as ____");
  });

  // Story: present, long enough, mirrored in <stem>.story.txt.
  const storyLines = draft.story?.pages.flatMap((page) => page.lines) ?? [];
  if (!draft.story) q("story", "story is missing");
  else if (storyLines.length < MIN_STORY_LINES) q("story", `story has ${storyLines.length} lines (minimum ${MIN_STORY_LINES})`);
  const stem = path.basename(file).replace(/\.rddraft\.json$/i, "").replace(/\.json$/i, "");
  const txt = path.join(path.dirname(file), `${stem}.story.txt`);
  if (draft.story) {
    if (!fs.existsSync(txt)) {
      q("story", `the story text file ${path.basename(txt)} is missing next to the draft`);
    } else {
      const body = fs.readFileSync(txt, "utf8").normalize("NFC");
      const absent = storyLines.filter((line) => !body.includes(line.text.normalize("NFC")));
      if (absent.length) q("story", `${absent.length} story line(s) are not in ${path.basename(txt)}, e.g. "${absent[0].text}"`);
      if (!body.includes(draft.story.title)) q("story.title", `${path.basename(txt)} does not contain the story title`);
    }
  }

  const foreignLines = draft.lyrics.filter(isForeign).length;
  return {
    issues,
    stats: {
      lines: draft.lyrics.length,
      foreignLines,
      vocabulary: draft.vocabulary.length,
      grammar: draft.grammar.length,
      idioms: draft.idioms.length,
      sentences: draft.sentences.length,
      questions: draft.questions.length,
      storyLines: storyLines.length,
      lexemeCoverage: `${(coverage * 100).toFixed(0)}%`,
    },
  };
}

function check(file: string): FileReport {
  const report: FileReport = { file, errors: [], warnings: [], quality: [], stats: {} };
  const fail = (message: string): FileReport => {
    report.errors.push({ path: "$", message, severity: "error" });
    return report;
  };
  const bytes = fs.readFileSync(file);
  if (bytes.length > DRAFT_MAX_BYTES) return fail(`file is ${bytes.length} bytes; the limit is 4 MiB`);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return fail("starts with a UTF-8 BOM; save as UTF-8 without BOM");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("not valid UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text);
  } catch (error) {
    return fail(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  report.errors.push(...findForbiddenKeys(parsed));
  const structural = validateDraftStructure(parsed);
  report.errors.push(...structural);
  if (structural.length) return report; // semantics assume a schema-valid draft
  const draft = parsed as DraftContent;
  for (const issue of validateContentSemantics(draft)) (issue.severity === "error" ? report.errors : report.warnings).push(issue);
  const result = quality(file, draft);
  report.quality = result.issues;
  report.stats = result.stats;
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const asJson = args.includes("--json");
  const targets = args.filter((arg) => !arg.startsWith("--"));
  if (targets.length === 0) {
    console.error("usage: npm run validate:draft -- <file-or-dir> [...] [--strict] [--json]");
    process.exit(2);
  }
  const files: string[] = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.error(`not found: ${target}`);
      process.exit(2);
    }
    const before = files.length;
    collect(path.resolve(target), files);
    if (files.length === before && fs.statSync(target).isFile()) files.push(path.resolve(target));
  }
  const reports = files.map(check);
  let failed = 0;
  for (const report of reports) {
    const blocking = report.errors.length + (strict ? report.quality.length : 0);
    if (blocking) failed += 1;
    if (asJson) continue;
    const rel = path.relative(process.cwd(), report.file) || report.file;
    console.log(`${blocking ? "✗" : "✓"} ${rel}  ${Object.entries(report.stats).map(([key, value]) => `${key}=${value}`).join(" ")}`);
    for (const issue of report.errors) console.log(`    ERROR    ${issue.path}: ${issue.message}`);
    for (const issue of report.quality) console.log(`    ${strict ? "QUALITY " : "quality "} ${issue.path}: ${issue.message}`);
    for (const issue of report.warnings) console.log(`    warning  ${issue.path}: ${issue.message}`);
  }
  if (asJson) console.log(JSON.stringify(reports, null, 2));
  else console.log(`\n${reports.length - failed}/${reports.length} draft(s) pass${strict ? " (strict)" : ""}.`);
  process.exit(failed ? 1 : 0);
}

main();
