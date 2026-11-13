import fs from "node:fs";
import { SUPPORTED_LANGUAGES, type ExportSummary, type LanguageStats, type StatsReport, type StatsScope, type TargetLanguage } from "../shared/types";
import { all, get } from "./db";
import { exportSummaries, readContent, type ProjectRow } from "./projects";
import { canonicalJson, nowIso, sha256Hex } from "./util";

/**
 * Reporting rules from WINDOWS_AGENT.md:
 * - unique vocabulary is `DISTINCT normalized_key` per target language from the
 *   selected version set (never tokens, cards or senses),
 * - sentences are `sentences[]`, not lyric lines; grammar cards are `grammar[]`,
 * - the default scope is the latest published pack per song, so superseded
 *   versions cannot inflate the numbers,
 * - lexeme rows and counts are aggregated separately to avoid joins that
 *   multiply sums.
 */
const LANGUAGES: TargetLanguage[] = [...SUPPORTED_LANGUAGES];

interface CountRow {
  export_id: string;
  sentence_count: number;
  grammar_count: number;
  lyric_line_count: number;
  idiom_count: number;
  question_count: number;
  vocab_table_count: number;
}

interface LexemeRow {
  export_id: string;
  lexeme_id: string;
  normalized_key: string;
  target_language: string;
}

function emptyStats(language: TargetLanguage): LanguageStats {
  return {
    targetLanguage: language,
    songs: 0,
    versions: 0,
    uniqueLexemes: 0,
    lexemeEntries: 0,
    sentences: 0,
    grammarCards: 0,
    idioms: 0,
    lyricLines: 0,
    questions: 0,
    vocabTables: 0,
    published: 0,
    missingFiles: 0,
  };
}

function pickExportIds(scope: StatsScope["scope"], language: TargetLanguage | "all"): ExportSummary[] {
  const exports = exportSummaries();
  const filtered = exports.filter((item) => language === "all" || item.targetLanguage === language);
  if (scope === "all-versions") return filtered;
  if (scope === "latest-published") {
    const best = new Map<string, ExportSummary>();
    for (const item of filtered) {
      if (!item.publication) continue;
      const current = best.get(item.songId);
      if (!current || item.versionCode > current.versionCode) best.set(item.songId, item);
    }
    return [...best.values()];
  }
  if (scope === "latest-exported") {
    const best = new Map<string, ExportSummary>();
    for (const item of filtered) {
      const current = best.get(item.songId);
      if (!current || item.versionCode > current.versionCode) best.set(item.songId, item);
    }
    return [...best.values()];
  }
  return [];
}

function computeDraftStats(language: TargetLanguage | "all"): { languages: LanguageStats[]; notices: string[]; songIds: Set<string>; hashes: string[] } {
  const rows = all<ProjectRow>("SELECT * FROM projects");
  const languages = new Map<TargetLanguage, LanguageStats>();
  const songIds = new Set<string>();
  const hashes: string[] = [];
  for (const row of rows) {
    const content = readContent(row);
    if (language !== "all" && content.targetLanguage !== language) continue;
    const entry = languages.get(content.targetLanguage) ?? emptyStats(content.targetLanguage);
    entry.versions += 1; // for drafts this column counts projects
    entry.lexemeEntries += content.vocabulary.length;
    entry.sentences += content.sentences.length;
    entry.grammarCards += content.grammar.length;
    entry.idioms += content.idioms.length;
    entry.lyricLines += content.lyrics.length;
    entry.questions += content.questions.length;
    entry.vocabTables += content.vocabularyTables.length;
    languages.set(content.targetLanguage, entry);
    songIds.add(content.songId);
    hashes.push(`${content.songId}:${sha256Hex(canonicalJson(content)).slice(0, 16)}`);
  }
  for (const entry of languages.values()) {
    const rowsForLanguage = rows.filter((row) => readContent(row).targetLanguage === entry.targetLanguage);
    const uniqueKeys = new Set<string>();
    const uniqueLexemes = new Set<string>();
    for (const row of rowsForLanguage) {
      for (const word of readContent(row).vocabulary) {
        uniqueKeys.add(word.normalizedKey.normalize("NFC").toLowerCase());
        uniqueLexemes.add(word.lexemeId);
      }
    }
    entry.uniqueLexemes = uniqueKeys.size;
    entry.lexemeEntries = uniqueLexemes.size;
    entry.songs = new Set(rowsForLanguage.map((row) => readContent(row).songId)).size;
  }
  const notices = [
    "Draft scope counts the editable projects in the studio, not published packs; lyric lines are reported separately from sentences.",
  ];
  return { languages: [...languages.values()], notices, songIds, hashes };
}

export function computeStats(scope: StatsScope): StatsReport {
  const language = scope.targetLanguage ?? "all";
  const generatedAt = nowIso();
  if (scope.scope === "drafts") {
    const draft = computeDraftStats(language);
    const order = new Map(LANGUAGES.map((item, index) => [item, index]));
    const languages = draft.languages.sort((a, b) => (order.get(a.targetLanguage) ?? 9) - (order.get(b.targetLanguage) ?? 9));
    return {
      generatedAt,
      scope: scope.scope,
      targetLanguage: language,
      sourcesHash: sha256Hex(canonicalJson({ scope: scope.scope, language, hashes: draft.hashes.sort() })),
      songs: draft.songIds.size,
      versions: languages.reduce((total, item) => total + item.versions, 0),
      languages,
      notices: draft.notices,
    };
  }

  const selected = pickExportIds(scope.scope, language);
  const ids = selected.map((item) => item.exportId);
  const lexemeRows = ids.length
    ? all<LexemeRow>("SELECT export_id, lexeme_id, normalized_key, target_language FROM export_lexemes WHERE export_id IN (" + ids.map(() => "?").join(",") + ")", ids)
    : [];
  const countRows = ids.length
    ? all<CountRow>(
        "SELECT export_id, sentence_count, grammar_count, lyric_line_count, idiom_count, question_count, vocab_table_count FROM export_counts WHERE export_id IN (" +
          ids.map(() => "?").join(",") +
          ")",
        ids,
      )
    : [];
  const countsById = new Map(countRows.map((row) => [row.export_id, row]));
  const languages = new Map<TargetLanguage, LanguageStats>();
  const keysByLanguage = new Map<TargetLanguage, Set<string>>();
  const lexemesByLanguage = new Map<TargetLanguage, Set<string>>();
  const songsByLanguage = new Map<TargetLanguage, Set<string>>();

  for (const item of selected) {
    const entry = languages.get(item.targetLanguage) ?? emptyStats(item.targetLanguage);
    entry.versions += 1;
    entry.published += item.publication ? 1 : 0;
    entry.missingFiles += item.fileState === "missing" ? 1 : 0;
    languages.set(item.targetLanguage, entry);
    const songSet = songsByLanguage.get(item.targetLanguage) ?? new Set<string>();
    songSet.add(item.songId);
    songsByLanguage.set(item.targetLanguage, songSet);
    const counts = countsById.get(item.exportId);
    if (counts) {
      entry.sentences += counts.sentence_count;
      entry.grammarCards += counts.grammar_count;
      entry.lyricLines += counts.lyric_line_count;
      entry.idioms += counts.idiom_count;
      entry.questions += counts.question_count;
      entry.vocabTables += counts.vocab_table_count;
    }
  }
  for (const row of lexemeRows) {
    const lang = row.target_language as TargetLanguage;
    const keys = keysByLanguage.get(lang) ?? new Set<string>();
    keys.add(row.normalized_key);
    keysByLanguage.set(lang, keys);
    const lexemes = lexemesByLanguage.get(lang) ?? new Set<string>();
    lexemes.add(row.lexeme_id);
    lexemesByLanguage.set(lang, lexemes);
  }
  for (const entry of languages.values()) {
    entry.uniqueLexemes = keysByLanguage.get(entry.targetLanguage)?.size ?? 0;
    entry.lexemeEntries = lexemesByLanguage.get(entry.targetLanguage)?.size ?? 0;
    entry.songs = songsByLanguage.get(entry.targetLanguage)?.size ?? 0;
  }

  const notices: string[] = [];
  if (scope.scope === "latest-published") {
    const publishedCount = selected.filter((item) => item.publication).length;
    if (publishedCount === 0) {
      notices.push(
        "No pack has been verified on its HTTPS host yet. Publication is recorded only after the remote pack hash is re-downloaded and checked; use the latest-exported scope meanwhile.",
      );
    } else {
      notices.push("Default scope: for every song the newest published, hash-verified pack is counted once.");
    }
  }
  if (selected.some((item) => item.fileState === "missing")) {
    notices.push("Some selected packs are missing from the archive folder; the report is incomplete until the rescan finds them again.");
  }
  if (selected.some((item) => item.usedTestKeys)) {
    notices.push("Some counted exports were produced with TEST-ONLY keys and must never be published.");
  }

  const order = new Map(LANGUAGES.map((item, index) => [item, index]));
  const ordered = [...languages.values()].sort(
    (a, b) => (order.get(a.targetLanguage) ?? 9) - (order.get(b.targetLanguage) ?? 9),
  );
  return {
    generatedAt,
    scope: scope.scope,
    targetLanguage: language,
    sourcesHash: sha256Hex(
      canonicalJson({
        scope: scope.scope,
        language,
        packs: selected.map((item) => [item.songId, item.versionCode, item.packSha256]),
      }),
    ),
    songs: selected.length ? new Set(selected.map((item) => item.songId)).size : 0,
    versions: selected.length,
    languages: ordered,
    notices,
  };
}

export function statsToCsv(report: StatsReport): string {
  const lines: string[] = [
    `# generatedAt: ${report.generatedAt}`,
    `# scope: ${report.scope}`,
    `# targetLanguage: ${report.targetLanguage}`,
    `# songs: ${report.songs}`,
    `# versions: ${report.versions}`,
    `# sourcesHash: ${report.sourcesHash}`,
  ];
  for (const notice of report.notices) lines.push(`# notice: ${notice.replace(/\s+/g, " ")}`);
  lines.push(
    "targetLanguage,songs,versions,uniqueLexemes,lexemeEntries,sentences,grammarCards,idioms,lyricLines,questions,vocabTables,published,missingFiles",
  );
  for (const item of report.languages) {
    lines.push(
      [
        item.targetLanguage,
        item.songs,
        item.versions,
        item.uniqueLexemes,
        item.lexemeEntries,
        item.sentences,
        item.grammarCards,
        item.idioms,
        item.lyricLines,
        item.questions,
        item.vocabTables,
        item.published,
        item.missingFiles,
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function statsJson(report: StatsReport): string {
  return JSON.stringify(report, null, 2);
}

export function fileExists(target: string): boolean {
  try {
    return fs.statSync(target).size > 0;
  } catch {
    return false;
  }
}

export function exportRowById(exportId: string) {
  return get<{ pack_path: string }>("SELECT pack_path FROM exports WHERE export_id = ?", [exportId]);
}
