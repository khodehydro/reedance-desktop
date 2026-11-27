import fs from "node:fs";
import path from "node:path";
import { SUPPORTED_LANGUAGES, isTargetLanguage, type DraftContent, type ImportOutcome, type Issue, type ReplaceDraftOutcome, type Level, type ReetalkDraft, type TargetLanguage } from "../shared/types";
import { audit, flushNow } from "./db";
import { readFileLimited } from "./paths";
import { createProject, replaceProjectDraft, saveRawSnapshot } from "./projects";
import { isReeTalkDraft, validateReeTalkDraft } from "./reetalk";
import { sha256Hex } from "./util";
import {
  findForbiddenKeys,
  formatIssues,
  parseStrictJson,
  validateContentSemantics,
  validateDraftStructure,
} from "./validation";

const DRAFT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Import of a content-only draft: a song `.rddraft.json` or a ReeTalk
 * `.reetalkdraft.json`.
 *
 * The draft is untrusted input: it is read as UTF-8 (BOM rejected), parsed with
 * a duplicate-key rejecting parser and scanned for media/timings/keys. The
 * profile is decided by `contentType` — a ReeTalk file never enters the song
 * pipeline (and vice versa) — then the matching validator runs. Only after all
 * of that is a local project created; the original bytes are kept as an
 * immutable snapshot.
 */
export type ParsedDraft =
  | { kind: "reetalk"; draft: ReetalkDraft; bytes: Buffer; sha: string; warnings: Issue[] }
  | { kind: "song"; draft: DraftContent; bytes: Buffer; sha: string; warnings: Issue[] };

/**
 * Read + fully validate a draft file without touching the database. Shared by
 * the first import and by "replace JSON" on an existing project.
 */
export function parseDraftFile(filePath: string): ParsedDraft {
  const bytes = readFileLimited(filePath, DRAFT_MAX_BYTES);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error("draft starts with a UTF-8 BOM; save it as UTF-8 without BOM");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("draft is not valid UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(text);
  } catch (error) {
    throw new Error(`draft is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const forbidden = findForbiddenKeys(parsed);
  if (forbidden.length) {
    throw new Error(`draft contains media/timing data that only Windows may add: ${formatIssues(forbidden.slice(0, 4))}`);
  }
  const sha = sha256Hex(bytes);

  if (isReeTalkDraft(parsed) || (parsed && typeof parsed === "object" && (parsed as { contentType?: unknown }).contentType === "reetalk")) {
    const issues = validateReeTalkDraft(parsed);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length) {
      throw new Error(`ReeTalk draft failed validation: ${formatIssues(errors.slice(0, 6))}`);
    }
    return { kind: "reetalk", draft: parsed as ReetalkDraft, bytes, sha, warnings: issues.filter((issue) => issue.severity === "warning") };
  }

  const structural = validateDraftStructure(parsed);
  if (structural.length) {
    throw new Error(`draft failed schema validation: ${formatIssues(structural.slice(0, 6))}`);
  }
  const draft = parsed as DraftContent;
  const semantic = validateContentSemantics(draft);
  const errors = semantic.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new Error(`draft has blocking content errors: ${formatIssues(errors.slice(0, 6))}`);
  }
  return { kind: "song", draft, bytes, sha, warnings: semantic.filter((issue) => issue.severity === "warning") };
}

export function importDraftFile(filePath: string): ImportOutcome {
  const parsed = parseDraftFile(filePath);
  const snapshotPath = saveRawSnapshot(parsed.sha, parsed.bytes);
  const projectId = createProject({ draft: parsed.draft, rawPath: snapshotPath, rawSha256: parsed.sha });
  audit(projectId, "raw-snapshot-stored", "system", { rawPath: snapshotPath, rawSha256: parsed.sha });
  if (parsed.kind === "reetalk") {
    audit(projectId, "reetalk-draft-imported", "operator", { dialogueId: parsed.draft.dialogueId, turns: parsed.draft.turns.length });
  }
  flushNow();
  return parsed.kind === "reetalk"
    ? { projectId, songId: parsed.draft.dialogueId, title: parsed.draft.title.fa, issues: [], warnings: parsed.warnings }
    : { projectId, songId: parsed.draft.songId, title: parsed.draft.title, issues: [], warnings: parsed.warnings };
}

/**
 * Replace the content of an existing project with a new draft file (same id,
 * same language, same profile). Audio, cover and the timings of every line or
 * turn whose id survives are kept; the next export gets a new version.
 */
export function replaceDraftFile(projectId: string, filePath: string): ReplaceDraftOutcome {
  const parsed = parseDraftFile(filePath);
  const snapshotPath = saveRawSnapshot(parsed.sha, parsed.bytes);
  const outcome = replaceProjectDraft(projectId, parsed.draft, { rawPath: snapshotPath, rawSha256: parsed.sha });
  return { ...outcome, warnings: parsed.warnings.length };
}

const SONG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCALE = new RegExp(`^(?:${SUPPORTED_LANGUAGES.join("|")})(?:-[A-Za-z0-9]{2,8}){1,3}$`);

export function createEmptyDraft(input: {
  songId: string;
  title: string;
  artist: string;
  targetLanguage: TargetLanguage;
  locale: string;
  level: Level;
}): ImportOutcome {
  const songId = input.songId.trim().toLowerCase();
  if (!SONG_ID.test(songId)) throw new Error("songId must be lowercase letters, digits and dashes (slug)");
  if (!input.title.trim()) throw new Error("title is required");
  if (!LOCALE.test(input.locale)) throw new Error("locale must look like en-GB, es-ES or ko-KR");
  if (!input.locale.startsWith(input.targetLanguage)) throw new Error("locale must start with the target language");

  const draft: DraftContent = {
    draftSchemaVersion: 1,
    songId,
    targetLanguage: input.targetLanguage,
    locale: input.locale,
    title: input.title.trim(),
    artist: input.artist.trim(),
    level: input.level,
    createdAt: new Date().toISOString(),
    generator: "Reedance Studio — blank project",
    notes: "Blank project created inside the studio. Fill lines, vocabulary, grammar and questions, then select audio from the system.",
    sources: {
      lyrics: { description: "Operator-created content", rightsStatus: "unverified" },
      lesson: { description: "Operator-created content", rightsStatus: "unverified" },
    },
    credits: { lyrics: "", noticeFa: "", noticeEn: "" },
    lyrics: [{ id: "line-1", text: "", translationFa: "", translationEn: "", tokens: [] }],
    vocabulary: [],
    grammar: [],
    idioms: [],
    sentences: [],
    vocabularyTables: [],
    questions: [],
  };
  const bytes = Buffer.from(JSON.stringify(draft, null, 2), "utf8");
  const sha = sha256Hex(bytes);
  const snapshotPath = saveRawSnapshot(sha, bytes);
  const projectId = createProject({ draft, rawPath: snapshotPath, rawSha256: sha });
  return { projectId, songId, title: draft.title, issues: [], warnings: [] };
}

export function readDraftPreview(filePath: string): { songId: string; title: string; targetLanguage: TargetLanguage; lines: number } {
  const bytes = readFileLimited(filePath, DRAFT_MAX_BYTES);
  const draft = JSON.parse(bytes.toString("utf8")) as DraftContent;
  return {
    songId: draft.songId,
    title: draft.title,
    targetLanguage: draft.targetLanguage,
    lines: draft.lyrics?.length ?? 0,
  };
}

export function draftFileName(songId: string): string {
  return `${songId}.rddraft.json`;
}

export function pickExisting(target: string): boolean {
  try {
    return fs.statSync(path.resolve(target)).isFile();
  } catch {
    return false;
  }
}
