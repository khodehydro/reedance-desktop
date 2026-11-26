import type {
  Issue,
  LyricMark,
  MediaInfo,
  ReetalkDraft,
  ReetalkDialogue,
  ReetalkTurn,
} from "../shared/types";
import { SUPPORTED_LANGUAGES } from "../shared/types";

/**
 * ReeTalk profile: validation and draft → dialogue.json assembly.
 *
 * A ReeTalk project is deliberately separate from the song lesson pipeline
 * (REETALK_PACKAGE_FA.md §3): its raw file never enters the lyric timeline
 * tools, its pack always ships exactly `dialogue.json + audio + cover`, and its
 * manifest is payload v2. Timings come only from the operator recording them
 * against the real audio — no TTS, no estimated text timings — so a turn keeps
 * a recorded end when there is one and otherwise derives it from the next
 * turn's start (silence between turns stays representable).
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

const AUDIO_PAIRS: Record<string, string> = {
  "audio.mp3": "audio/mpeg",
  "audio.m4a": "audio/mp4",
  "audio.wav": "audio/wav",
};
const COVER_PAIRS: Record<string, string> = {
  "cover.jpg": "image/jpeg",
  "cover.png": "image/png",
  "cover.webp": "image/webp",
};

export function isReeTalkDraft(value: unknown): value is ReetalkDraft {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { contentType?: unknown }).contentType === "reetalk" &&
    (value as { draftSchemaVersion?: unknown }).draftSchemaVersion === 1
  );
}

function str(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function localized(value: unknown): boolean {
  return !!value && typeof value === "object" && str((value as { fa?: unknown }).fa) && str((value as { en?: unknown }).en);
}

function exampleOf(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    str((value as { text?: unknown }).text) &&
    localized((value as { translation?: unknown }).translation)
  );
}

function pronunciationOf(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    str((value as { faReading?: unknown }).faReading) &&
    str((value as { ipa?: unknown }).ipa)
  );
}

function cellOk(cell: unknown): boolean {
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) return false;
  const record = cell as Record<string, unknown>;
  const hasText = "text" in record;
  const hasPair = "fa" in record || "en" in record;
  // Exactly one of {text} or {fa,en} — never both shapes at once.
  if (hasText && hasPair) return false;
  if (hasText) return str(record.text);
  return str(record.fa) && str(record.en);
}

function duplicateIds(prefix: string, items: { id?: unknown }[], issues: Issue[]): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const id = item?.id;
    if (typeof id !== "string" || !SLUG_RE.test(id)) {
      issues.push({ path: `${prefix}[${index}].id`, message: "id must be a lowercase slug", severity: "error" });
      return;
    }
    if (seen.has(id)) {
      issues.push({ path: `${prefix}[${index}].id`, message: `duplicate id "${id}"`, severity: "error" });
    }
    seen.add(id);
  });
}

/**
 * Turn-count limits for a ReeTalk dialogue. Lowered from the proposal's 10 / 5
 * to 8 / 4 so the authored scenario library in `reetalk-docs` (eight-turn,
 * four-per-speaker source dialogues) imports as-is. The Android validator and
 * `docs/interop/REETALK_PACKAGE_FA.md` must apply the same numbers before a
 * pack built from such a draft is published.
 */
export const REETALK_MIN_TURNS = 8;
export const REETALK_MAX_TURNS = 120;
export const REETALK_MIN_TURNS_PER_SPEAKER = 4;

/**
 * Structural + semantic validation of an imported `.reetalkdraft.json`.
 * Mirrors the contract tables in REETALK_PACKAGE_FA.md §2 and the semantic
 * rules both sides must enforce (§5.1).
 */
export function validateReeTalkDraft(value: unknown): Issue[] {
  const issues: Issue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: "$", message: "draft must be a JSON object", severity: "error" }];
  }
  const draft = value as Partial<ReetalkDraft>;

  if (draft.draftSchemaVersion !== 1) {
    issues.push({ path: "$.draftSchemaVersion", message: "draftSchemaVersion must be 1", severity: "error" });
  }
  if (draft.contentType !== "reetalk") {
    issues.push({ path: "$.contentType", message: 'contentType must be "reetalk"', severity: "error" });
  }
  if (typeof draft.dialogueId !== "string" || !SLUG_RE.test(draft.dialogueId) || draft.dialogueId.length > 64) {
    issues.push({ path: "$.dialogueId", message: "dialogueId must be a slug of at most 64 chars", severity: "error" });
  }
  if (typeof draft.categoryId !== "string" || !SLUG_RE.test(draft.categoryId) || draft.categoryId.length > 64) {
    issues.push({ path: "$.categoryId", message: "categoryId must be a slug of at most 64 chars", severity: "error" });
  }
  if (typeof draft.targetLanguage !== "string" || !(SUPPORTED_LANGUAGES as readonly string[]).includes(draft.targetLanguage)) {
    issues.push({
      path: "$.targetLanguage",
      message: `targetLanguage must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`,
      severity: "error",
    });
  }
  if (typeof draft.locale !== "string" || draft.locale.length < 5 || draft.locale.length > 32) {
    issues.push({ path: "$.locale", message: "locale is required (5–32 chars)", severity: "error" });
  } else if (typeof draft.targetLanguage === "string" && !draft.locale.startsWith(draft.targetLanguage)) {
    issues.push({ path: "$.locale", message: "locale must start with the target language", severity: "error" });
  }
  if (typeof draft.level !== "string" || !(LEVELS as readonly string[]).includes(draft.level)) {
    issues.push({ path: "$.level", message: "level must be A1..C2", severity: "error" });
  }
  if (!localized(draft.title)) {
    issues.push({ path: "$.title", message: "title needs non-empty fa and en", severity: "error" });
  }
  if (!localized(draft.objective)) {
    issues.push({ path: "$.objective", message: "objective needs non-empty fa and en", severity: "error" });
  }

  // Speakers: exactly two, unique ids, woman|man only.
  const speakers = Array.isArray(draft.speakers) ? draft.speakers : [];
  if (speakers.length !== 2) {
    issues.push({ path: "$.speakers", message: "a dialogue needs exactly two speakers", severity: "error" });
  }
  const speakerIds = new Set<string>();
  speakers.forEach((speaker, index) => {
    if (!speaker || typeof speaker !== "object") {
      issues.push({ path: `$speakers[${index}]`, message: "speaker must be an object", severity: "error" });
      return;
    }
    if (typeof speaker.id !== "string" || !SLUG_RE.test(speaker.id)) {
      issues.push({ path: `$.speakers[${index}].id`, message: "speaker id must be a lowercase slug", severity: "error" });
    } else if (speakerIds.has(speaker.id)) {
      issues.push({ path: `$.speakers[${index}].id`, message: `duplicate speaker id "${speaker.id}"`, severity: "error" });
    } else {
      speakerIds.add(speaker.id);
    }
    if (!str(speaker.name)) {
      issues.push({ path: `$.speakers[${index}].name`, message: "speaker name is required", severity: "error" });
    }
    if (speaker.gender !== "woman" && speaker.gender !== "man") {
      issues.push({ path: `$.speakers[${index}].gender`, message: 'gender must be "woman" or "man"', severity: "error" });
    }
  });

  // Turns: count, per-speaker minimum, references, token reconstruction.
  const turns = Array.isArray(draft.turns) ? draft.turns : [];
  if (turns.length < REETALK_MIN_TURNS || turns.length > REETALK_MAX_TURNS) {
    issues.push({
      path: "$.turns",
      message: `a dialogue needs ${REETALK_MIN_TURNS}–${REETALK_MAX_TURNS} turns, found ${turns.length}`,
      severity: "error",
    });
  }
  duplicateIds("$.turns", turns, issues);
  const perSpeaker = new Map<string, number>();
  const turnIds = new Set<string>();
  turns.forEach((turn, index) => {
    if (!turn || typeof turn !== "object") {
      issues.push({ path: `$.turns[${index}]`, message: "turn must be an object", severity: "error" });
      return;
    }
    if (typeof turn.id === "string") turnIds.add(turn.id);
    if (typeof turn.speakerId !== "string" || !speakerIds.has(turn.speakerId)) {
      issues.push({
        path: `$.turns[${index}].speakerId`,
        message: `unknown speaker "${String(turn.speakerId)}"`,
        severity: "error",
      });
    } else {
      perSpeaker.set(turn.speakerId, (perSpeaker.get(turn.speakerId) ?? 0) + 1);
    }
    if (!str(turn.text)) {
      issues.push({ path: `$.turns[${index}].text`, message: "turn text is required", severity: "error" });
    }
    if (!localized(turn.translation)) {
      issues.push({ path: `$.turns[${index}].translation`, message: "translation needs non-empty fa and en", severity: "error" });
    }
    const tokens = Array.isArray(turn.tokens) ? turn.tokens : [];
    if (tokens.length === 0) {
      issues.push({ path: `$.turns[${index}].tokens`, message: "a turn needs at least one token", severity: "error" });
      return;
    }
    tokens.forEach((token, tokenIndex) => {
      if (!token || typeof token !== "object" || !str(token.surface) || !localized(token.gloss)) {
        issues.push({
          path: `$.turns[${index}].tokens[${tokenIndex}]`,
          message: "token needs a surface and gloss {fa,en}",
          severity: "error",
        });
      }
    });
    // Token/text reconstruction is a hard semantic rule for ReeTalk (§5.1).
    const joined = tokens
      .map((token) => (token && typeof token === "object" ? String(token.surface ?? "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const text = str(turn.text) ? turn.text.replace(/\s+/g, " ").trim() : "";
    if (joined && text && joined.toLocaleLowerCase() !== text.toLocaleLowerCase()) {
      issues.push({
        path: `$.turns[${index}].tokens`,
        message: "token surfaces do not reconstruct the turn text",
        severity: "error",
      });
    }
  });
  for (const speakerId of speakerIds) {
    const count = perSpeaker.get(speakerId) ?? 0;
    if (turns.length >= REETALK_MIN_TURNS && count < REETALK_MIN_TURNS_PER_SPEAKER) {
      issues.push({
        path: "$.turns",
        message: `speaker "${speakerId}" has ${count} turns; at least ${REETALK_MIN_TURNS_PER_SPEAKER} are required`,
        severity: "error",
      });
    }
  }

  // Learning blocks: all four non-empty, ids unique, references connected.
  const learning = (draft.learning ?? {}) as Partial<ReetalkDraft["learning"]>;
  const words = Array.isArray(learning.words) ? learning.words : [];
  const grammar = Array.isArray(learning.grammar) ? learning.grammar : [];
  const phrases = Array.isArray(learning.phrases) ? learning.phrases : [];
  const questions = Array.isArray(learning.questions) ? learning.questions : [];
  if (words.length < 1) issues.push({ path: "$.learning.words", message: "at least one word is required", severity: "error" });
  if (grammar.length < 1) issues.push({ path: "$.learning.grammar", message: "at least one grammar card is required", severity: "error" });
  if (phrases.length < 1) issues.push({ path: "$.learning.phrases", message: "at least one phrase is required", severity: "error" });
  if (questions.length < 1) issues.push({ path: "$.learning.questions", message: "at least one question is required", severity: "error" });

  duplicateIds("$.learning.words", words, issues);
  words.forEach((word, index) => {
    if (!word || typeof word !== "object") return;
    if (!str(word.text)) issues.push({ path: `$.learning.words[${index}].text`, message: "word text is required", severity: "error" });
    if (!pronunciationOf(word.pronunciation)) {
      issues.push({ path: `$.learning.words[${index}].pronunciation`, message: "pronunciation needs faReading and ipa", severity: "error" });
    }
    if (!localized(word.meaning)) {
      issues.push({ path: `$.learning.words[${index}].meaning`, message: "meaning needs non-empty fa and en", severity: "error" });
    }
    if (!exampleOf(word.example)) {
      issues.push({ path: `$.learning.words[${index}].example`, message: "example needs text and translation {fa,en}", severity: "error" });
    }
  });

  duplicateIds("$.learning.grammar", grammar, issues);
  grammar.forEach((card, index) => {
    if (!card || typeof card !== "object") return;
    for (const key of ["title", "explanation", "takeaway"] as const) {
      if (!localized(card[key])) {
        issues.push({ path: `$.learning.grammar[${index}].${key}`, message: `${key} needs non-empty fa and en`, severity: "error" });
      }
    }
    if (!exampleOf(card.example)) {
      issues.push({ path: `$.learning.grammar[${index}].example`, message: "example needs text and translation {fa,en}", severity: "error" });
    }
    const tables = Array.isArray(card.tables) ? card.tables : [];
    if (tables.length < 1) {
      issues.push({ path: `$.learning.grammar[${index}].tables`, message: "a grammar card needs at least one table", severity: "error" });
    }
    tables.forEach((table, tableIndex) => validateTable(table, `$.learning.grammar[${index}].tables[${tableIndex}]`, issues));
  });

  duplicateIds("$.learning.phrases", phrases, issues);
  phrases.forEach((phrase, index) => {
    if (!phrase || typeof phrase !== "object") return;
    if (!str(phrase.text)) issues.push({ path: `$.learning.phrases[${index}].text`, message: "phrase text is required", severity: "error" });
    if (!pronunciationOf(phrase.pronunciation)) {
      issues.push({ path: `$.learning.phrases[${index}].pronunciation`, message: "pronunciation needs faReading and ipa", severity: "error" });
    }
    if (!localized(phrase.meaning)) {
      issues.push({ path: `$.learning.phrases[${index}].meaning`, message: "meaning needs non-empty fa and en", severity: "error" });
    }
    if (!localized(phrase.context)) {
      issues.push({ path: `$.learning.phrases[${index}].context`, message: "context needs non-empty fa and en", severity: "error" });
    }
    if (!exampleOf(phrase.example)) {
      issues.push({ path: `$.learning.phrases[${index}].example`, message: "example needs text and translation {fa,en}", severity: "error" });
    }
  });

  duplicateIds("$.learning.questions", questions, issues);
  const stages = new Set<string>();
  questions.forEach((question, index) => {
    if (!question || typeof question !== "object") return;
    const prefix = `$.learning.questions[${index}]`;
    if (question.stage !== "gist" && question.stage !== "detail" && question.stage !== "review") {
      issues.push({ path: `${prefix}.stage`, message: 'stage must be "gist", "detail" or "review"', severity: "error" });
    } else {
      stages.add(question.stage);
    }
    if (question.type !== "multiple_choice") {
      issues.push({ path: `${prefix}.type`, message: "v1 supports multiple_choice only", severity: "error" });
    }
    if (!localized(question.prompt)) {
      issues.push({ path: `${prefix}.prompt`, message: "prompt needs non-empty fa and en", severity: "error" });
    }
    if (!localized(question.explanation)) {
      issues.push({ path: `${prefix}.explanation`, message: "explanation needs non-empty fa and en", severity: "error" });
    }
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length < 2 || options.length > 6) {
      issues.push({ path: `${prefix}.options`, message: "a question needs 2–6 options", severity: "error" });
    }
    const optionIds = new Set<string>();
    options.forEach((option, optionIndex) => {
      if (!option || typeof option !== "object" || typeof option.id !== "string" || !SLUG_RE.test(option.id)) {
        issues.push({ path: `${prefix}.options[${optionIndex}].id`, message: "option id must be a lowercase slug", severity: "error" });
      } else if (optionIds.has(option.id)) {
        issues.push({ path: `${prefix}.options[${optionIndex}].id`, message: `duplicate option id "${option.id}"`, severity: "error" });
      } else {
        optionIds.add(option.id);
      }
      if (!option || typeof option !== "object" || !localized(option.text)) {
        issues.push({ path: `${prefix}.options[${optionIndex}].text`, message: "option text needs non-empty fa and en", severity: "error" });
      }
    });
    if (typeof question.correctOptionId !== "string" || !optionIds.has(question.correctOptionId)) {
      issues.push({ path: `${prefix}.correctOptionId`, message: "correctOptionId must reference one of the options", severity: "error" });
    }
    const evidence = Array.isArray(question.evidenceTurnIds) ? question.evidenceTurnIds : [];
    if (evidence.length < 1) {
      issues.push({ path: `${prefix}.evidenceTurnIds`, message: "at least one evidence turn is required", severity: "error" });
    }
    evidence.forEach((turnId, evidenceIndex) => {
      if (typeof turnId !== "string" || !turnIds.has(turnId)) {
        issues.push({
          path: `${prefix}.evidenceTurnIds[${evidenceIndex}]`,
          message: `unknown turn "${String(turnId)}"`,
          severity: "error",
        });
      }
    });
  });
  // At least one gist and one detail question (review is optional).
  if (questions.length > 0 && !stages.has("gist")) {
    issues.push({ path: "$.learning.questions", message: "at least one gist question is required", severity: "error" });
  }
  if (questions.length > 0 && !stages.has("detail")) {
    issues.push({ path: "$.learning.questions", message: "at least one detail question is required", severity: "error" });
  }

  return issues;
}

function validateTable(table: unknown, prefix: string, issues: Issue[]): void {
  if (!table || typeof table !== "object") {
    issues.push({ path: prefix, message: "table must be an object", severity: "error" });
    return;
  }
  const record = table as { title?: unknown; columns?: unknown; rows?: unknown };
  if (!localized(record.title)) {
    issues.push({ path: `${prefix}.title`, message: "table title needs non-empty fa and en", severity: "error" });
  }
  const columns = Array.isArray(record.columns) ? record.columns : [];
  const rows = Array.isArray(record.rows) ? record.rows : [];
  if (columns.length < 1) {
    issues.push({ path: `${prefix}.columns`, message: "a table needs at least one column", severity: "error" });
  }
  columns.forEach((column, index) => {
    if (!localized(column)) {
      issues.push({ path: `${prefix}.columns[${index}]`, message: "column header needs non-empty fa and en", severity: "error" });
    }
  });
  if (rows.length < 1) {
    issues.push({ path: `${prefix}.rows`, message: "a table needs at least one row", severity: "error" });
  }
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      issues.push({ path: `${prefix}.rows[${rowIndex}]`, message: "row must be an array", severity: "error" });
      return;
    }
    if (row.length !== columns.length) {
      issues.push({
        path: `${prefix}.rows[${rowIndex}]`,
        message: `row has ${row.length} cells but the header has ${columns.length}`,
        severity: "error",
      });
      return;
    }
    row.forEach((cell, cellIndex) => {
      if (!cellOk(cell)) {
        issues.push({
          path: `${prefix}.rows[${rowIndex}][${cellIndex}]`,
          message: "cell must be exactly {text} or {fa,en}",
          severity: "error",
        });
      }
    });
  });
}

/**
 * Draft → published `dialogue.json`.
 *
 * Every turn gets an explicit interval: the operator's recorded end when one
 * exists, otherwise the next turn's start, and for the last turn the audio
 * duration. A turn without a start cannot be published.
 */
export function assembleDialogue(input: {
  draft: ReetalkDraft;
  marks: LyricMark[];
  media: MediaInfo;
  contentVersionCode: number;
}): ReetalkDialogue {
  const { draft, marks, media, contentVersionCode } = input;
  if (!media.coverPath || !media.coverSha256 || !media.coverMimeType || !media.coverExtension) {
    throw new Error("a ReeTalk pack needs a cover image: select the cover before exporting");
  }
  const byTurn = new Map(marks.map((mark) => [mark.lineId, mark]));
  const durationMs = Math.round(media.durationMs);

  const turns = draft.turns.map((turn, index) => {
    const mark = byTurn.get(turn.id);
    if (!mark || mark.startMs === null) throw new Error(`turn "${turn.id}" has no start time`);
    const next = draft.turns[index + 1];
    const nextStart = next ? byTurn.get(next.id)?.startMs ?? null : null;
    const endMs = mark.endMs ?? nextStart ?? durationMs;
    return { ...turn, startMs: mark.startMs, endMs };
  });

  return {
    contentType: "reetalk",
    schemaVersion: 1,
    contentVersionCode,
    dialogueId: draft.dialogueId,
    categoryId: draft.categoryId,
    targetLanguage: draft.targetLanguage,
    locale: draft.locale,
    level: draft.level,
    title: draft.title,
    objective: draft.objective,
    speakers: draft.speakers,
    turns,
    learning: draft.learning,
    media: {
      audio: {
        path: `audio.${media.extension}` as ReetalkDialogue["media"]["audio"]["path"],
        mimeType: media.mimeType as ReetalkDialogue["media"]["audio"]["mimeType"],
        durationMs,
        sha256: media.audioSha256,
      },
      cover: {
        path: `cover.${media.coverExtension}` as ReetalkDialogue["media"]["cover"]["path"],
        mimeType: media.coverMimeType as ReetalkDialogue["media"]["cover"]["mimeType"],
        sha256: media.coverSha256,
      },
    },
  };
}

/**
 * Timing + media rules of the published dialogue (REETALK_PACKAGE_FA.md §3):
 * `0 <= startMs < endMs <= durationMs`, `previous.endMs <= current.startMs`
 * (silence is fine, overlap is not), and the declared media must match the
 * local copies.
 */
export function validateReeTalkDialogue(
  dialogue: ReetalkDialogue,
  mediaDurationMs: number,
  audioSha256: string,
): Issue[] {
  const issues: Issue[] = [];
  if (dialogue.contentType !== "reetalk") {
    issues.push({ path: "$.contentType", message: 'contentType must be "reetalk"', severity: "error" });
  }
  if (dialogue.schemaVersion !== 1) {
    issues.push({ path: "$.schemaVersion", message: "schemaVersion must be 1", severity: "error" });
  }
  if (!Number.isInteger(dialogue.contentVersionCode) || dialogue.contentVersionCode < 1) {
    issues.push({ path: "$.contentVersionCode", message: "contentVersionCode must be a positive integer", severity: "error" });
  }

  let previousEnd: number | null = null;
  dialogue.turns.forEach((turn, index) => {
    const prefix = `$.turns[${index}]`;
    if (!Number.isInteger(turn.startMs) || turn.startMs < 0) {
      issues.push({ path: `${prefix}.startMs`, message: "startMs must be a non-negative integer", severity: "error" });
      return;
    }
    if (!Number.isInteger(turn.endMs) || turn.endMs <= turn.startMs) {
      issues.push({ path: `${prefix}.endMs`, message: "endMs must be an integer after startMs", severity: "error" });
      return;
    }
    if (turn.startMs >= mediaDurationMs) {
      issues.push({
        path: `${prefix}.startMs`,
        message: `startMs ${turn.startMs} is outside the ${mediaDurationMs} ms audio`,
        severity: "error",
      });
    }
    if (turn.endMs > mediaDurationMs) {
      issues.push({ path: `${prefix}.endMs`, message: "endMs is after the end of the audio", severity: "error" });
    }
    if (previousEnd !== null && turn.startMs < previousEnd) {
      issues.push({
        path: `${prefix}.startMs`,
        message: `turn overlaps the previous one (previous end ${previousEnd} ms > start ${turn.startMs} ms)`,
        severity: "error",
      });
    }
    previousEnd = turn.endMs;
  });

  const { audio, cover } = dialogue.media;
  if (!AUDIO_PAIRS[audio.path] || AUDIO_PAIRS[audio.path] !== audio.mimeType) {
    issues.push({ path: "$.media.audio", message: "audio path/mimeType pair is not allowed", severity: "error" });
  }
  if (!SHA_RE.test(audio.sha256)) {
    issues.push({ path: "$.media.audio.sha256", message: "sha256 must be lowercase hex", severity: "error" });
  } else if (audio.sha256 !== audioSha256) {
    issues.push({ path: "$.media.audio.sha256", message: "media hash does not match the local audio copy", severity: "error" });
  }
  if (!Number.isInteger(audio.durationMs) || audio.durationMs < 1 || audio.durationMs > 86_400_000) {
    issues.push({ path: "$.media.audio.durationMs", message: "duration must be between 1 ms and 24 h", severity: "error" });
  } else if (Math.abs(audio.durationMs - mediaDurationMs) > 1000) {
    issues.push({
      path: "$.media.audio.durationMs",
      message: "declared duration differs from the audio by more than 1 s",
      severity: "error",
    });
  }
  if (!COVER_PAIRS[cover.path] || COVER_PAIRS[cover.path] !== cover.mimeType) {
    issues.push({ path: "$.media.cover", message: "cover path/mimeType pair is not allowed", severity: "error" });
  }
  if (!SHA_RE.test(cover.sha256)) {
    issues.push({ path: "$.media.cover.sha256", message: "sha256 must be lowercase hex", severity: "error" });
  }

  return issues;
}

/** Every turn id in conversation order (used by preflight gates). */
export function turnIds(draft: ReetalkDraft): string[] {
  return draft.turns.map((turn: ReetalkTurn) => turn.id);
}
