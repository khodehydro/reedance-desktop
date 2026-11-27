/**
 * Shared contract between the Electron main process, the preload bridge and the
 * React renderer. Everything here is data only: no Node APIs are exposed to the
 * renderer and every IPC payload is validated again in the main process.
 *
 * The content shapes mirror `contracts/v1/*.schema.json` (Reedance v1).
 */

/**
 * Languages the studio can build packs for.
 *
 * `tr` is a studio-side extension: the pinned v1 contract
 * (`contracts/v1/lesson.schema.json`) only lists `en`, `es`, `ko`, while the
 * content pipeline already ships Turkish drafts. Turkish projects are therefore
 * accepted and exported, but flagged with a warning everywhere so nobody
 * publishes them to an Android build that still pins the older enum.
 */
export const SUPPORTED_LANGUAGES = ["en", "es", "ko", "tr"] as const;
export type TargetLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface LanguageMeta {
  fa: string;
  en: string;
  native: string;
  locale: string;
  flag: string;
  experimental?: boolean;
}

export const LANGUAGE_META: Record<TargetLanguage, LanguageMeta> = {
  en: { fa: "انگلیسی", en: "English", native: "English", locale: "en-GB", flag: "EN" },
  es: { fa: "اسپانیایی", en: "Spanish", native: "Español", locale: "es-ES", flag: "ES" },
  ko: { fa: "کره‌ای", en: "Korean", native: "한국어", locale: "ko-KR", flag: "KO" },
  tr: {
    fa: "ترکی استانبولی",
    en: "Turkish",
    native: "Türkçe",
    locale: "tr-TR",
    flag: "TR",
    experimental: true,
  },
};

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type Tone = "blue" | "mint" | "amber" | "coral" | "rose" | "apricot";
export type CellDir = "auto" | "ltr" | "rtl";

export interface Example {
  text: string;
  translationFa: string;
  translationEn: string;
}

export interface Token {
  surface: string;
  translationFa: string;
  translationEn: string;
  lexemeId?: string;
}

export interface LyricLine {
  id: string;
  /**
   * Optional ISO code (`^[a-z]{2,3}$`) for a line sung in another language than
   * the song (e.g. `en` in an `es` song). Android shows it as a language badge;
   * the studio keeps such a line out of the lesson (no lexemes, no links from
   * cards or questions). Omitted = inherits `targetLanguage`.
   */
  language?: string;
  text: string;
  translationFa: string;
  translationEn: string;
  tokens: Token[];
}

/** The line's language when it differs from the song language, else null. */
export function alternateLineLanguage(songLanguage: string, line: { language?: string }): string | null {
  const code = line.language;
  return code && /^[a-z]{2,3}$/.test(code) && code !== songLanguage ? code : null;
}

/**
 * A story is a second, shorter text that ships with every song. It mirrors the
 * Android story reader (`SongStory.kt`): title + pages, and every line carries
 * its own line translation plus word-by-word glosses. The studio edits the
 * same four things a lyric line has (text / translation FA / translation EN /
 * tokens) and additionally can speak the page text with the OS voice.
 */
export interface StoryLine {
  id: string;
  text: string;
  translationFa: string;
  translationEn: string;
  tokens: Token[];
}

export interface StoryPage {
  id: string;
  lines: StoryLine[];
}

export interface StoryDraft {
  title: string;
  pages: StoryPage[];
}

/** Story shape written into the published `lesson.json` (read by Android). */
export interface LessonStoryGloss {
  text: string;
  meaningFa: string;
  meaningEn: string;
}

export interface LessonStoryLine {
  text: string;
  meaningFa: string;
  meaningEn: string;
  words: LessonStoryGloss[];
}

export interface LessonStoryPage {
  lines: LessonStoryLine[];
}

export interface LessonStory {
  title: string;
  pages: LessonStoryPage[];
}

export interface CellObject {
  fa: string;
  en: string;
  dir?: CellDir;
  locale?: string;
}

export type TableCell = string | CellObject;

export interface LearningTable {
  titleFa: string;
  titleEn: string;
  introFa?: string;
  introEn?: string;
  footerFa?: string;
  footerEn?: string;
  rowHeader?: boolean;
  columns: TableCell[];
  rows: TableCell[][];
}

export interface Word {
  lexemeId: string;
  lemma: string;
  normalizedKey: string;
  translationFa: string;
  translationEn: string;
  ipa?: string;
  faReading?: string;
  partFa?: string;
  partEn?: string;
  article?: string;
  genderFa?: string;
  genderEn?: string;
  plural?: string;
  tone?: Tone;
  example: Example;
  tables?: LearningTable[];
}

export interface GrammarCheck {
  promptFa: string;
  promptEn: string;
  answerFa: string;
  answerEn: string;
}

export interface GrammarItem {
  id: string;
  conceptId?: string;
  tagFa: string;
  tagEn: string;
  titleFa: string;
  titleEn: string;
  bodyFa: string;
  bodyEn: string;
  example: Example;
  tone?: Tone;
  tables?: LearningTable[];
  takeawayFa?: string;
  takeawayEn?: string;
  check?: GrammarCheck;
  /**
   * Studio link to the lyric line(s) the card explains, used to play that part
   * of the song. Draft-only: not part of lesson.json v1, stripped at export.
   */
  lineIds?: string[];
}

export interface Phrase {
  id: string;
  text: string;
  translationFa: string;
  translationEn: string;
  contextFa?: string;
  contextEn?: string;
  lineId?: string;
  tone?: Tone;
}

export interface QuestionBase {
  id: string;
  type: "choice" | "match" | "order" | "typing";
  skillFa: string;
  skillEn: string;
  promptFa: string;
  promptEn: string;
  explanationFa: string;
  explanationEn: string;
  context?: string;
  lineId?: string;
  speech?: string;
  relatedLexemeIds?: string[];
}

export interface ChoiceOption {
  id: string;
  fa: string;
  en: string;
}

export interface ChoiceQuestion extends QuestionBase {
  type: "choice";
  options: ChoiceOption[];
  correctId: string;
}

export interface MatchPair {
  id: string;
  text: string;
  fa: string;
  en: string;
  lexemeId: string;
}

export interface MatchQuestion extends QuestionBase {
  type: "match";
  pairs: MatchPair[];
  meaningOrder?: string[];
}

export interface OrderChunk {
  id: string;
  text: string;
}

export interface OrderQuestion extends QuestionBase {
  type: "order";
  chunks: OrderChunk[];
  presentationOrder?: string[];
}

export interface TypingQuestion extends QuestionBase {
  type: "typing";
  context: string;
  accepted: string[];
}

export type Question = ChoiceQuestion | MatchQuestion | OrderQuestion | TypingQuestion;

export interface SourceClaim {
  description: string;
  rightsStatus: "unverified" | "documented";
  sourceReference?: string;
  permissionRef?: string;
  attribution?: string;
}

export interface IdAlias {
  kind: "lexeme" | "line" | "grammar" | "idiom" | "sentence";
  from: string;
  to: string;
}

export interface DraftCredits {
  lyrics?: string;
  noticeFa?: string;
  noticeEn?: string;
}

/** Content-only `.rddraft.json` (v1). No media, no timings, no keys. */
export interface DraftContent {
  draftSchemaVersion: 1;
  songId: string;
  targetLanguage: TargetLanguage;
  locale: string;
  title: string;
  artist?: string;
  level?: Level;
  createdAt: string;
  generator: string;
  notes?: string;
  sources: { lyrics: SourceClaim; lesson: SourceClaim };
  credits?: DraftCredits;
  disclaimerFa?: string;
  disclaimerEn?: string;
  lyrics: LyricLine[];
  story?: StoryDraft;
  vocabulary: Word[];
  grammar: GrammarItem[];
  idioms: Phrase[];
  sentences: Phrase[];
  vocabularyTables: LearningTable[];
  questions: Question[];
  idAliases?: IdAlias[];
}

/* ------------------------------------------------------------------ */
/* ReeTalk — timed two-speaker dialogue packages (manifest v2).        */
/* Contract: reedance-android docs/interop/REETALK_PACKAGE_FA.md.      */
/* ------------------------------------------------------------------ */

/** Localized text carried by every ReeTalk content field. */
export interface ReetalkLocalized {
  fa: string;
  en: string;
}

export interface ReetalkSpeaker {
  id: string;
  name: string;
  gender: "woman" | "man";
}

export interface ReetalkToken {
  surface: string;
  gloss: ReetalkLocalized;
}

/** One dialogue turn as authored (no timings). */
export interface ReetalkTurn {
  id: string;
  speakerId: string;
  text: string;
  translation: ReetalkLocalized;
  tokens: ReetalkToken[];
}

/** A published turn carries its recorded interval against the final audio. */
export type ReetalkTimedTurn = ReetalkTurn & { startMs: number; endMs: number };

export interface ReetalkWord {
  id: string;
  text: string;
  pronunciation: { faReading: string; ipa: string };
  meaning: ReetalkLocalized;
  example: { text: string; translation: ReetalkLocalized };
  /** Turns where the word is heard; the card plays them like a question's evidence. */
  evidenceTurnIds?: string[];
}

/** A table cell is target-language text ({text}) or a localized pair ({fa,en}). */
export type ReetalkTableCell = { text: string } | { fa: string; en: string };

export interface ReetalkTable {
  title: ReetalkLocalized;
  columns: ReetalkLocalized[];
  rows: ReetalkTableCell[][];
}

export interface ReetalkGrammar {
  id: string;
  title: ReetalkLocalized;
  explanation: ReetalkLocalized;
  example: { text: string; translation: ReetalkLocalized };
  takeaway: ReetalkLocalized;
  tables: ReetalkTable[];
  evidenceTurnIds?: string[];
}

export interface ReetalkPhrase {
  id: string;
  text: string;
  pronunciation: { faReading: string; ipa: string };
  meaning: ReetalkLocalized;
  context: ReetalkLocalized;
  example: { text: string; translation: ReetalkLocalized };
  evidenceTurnIds?: string[];
}

export interface ReetalkOption {
  id: string;
  text: ReetalkLocalized;
}

export interface ReetalkQuestion {
  id: string;
  stage: "gist" | "detail" | "review";
  /** v1 supports multiple choice only. */
  type: "multiple_choice";
  prompt: ReetalkLocalized;
  options: ReetalkOption[];
  correctOptionId: string;
  explanation: ReetalkLocalized;
  evidenceTurnIds: string[];
}

export interface ReetalkLearning {
  words: ReetalkWord[];
  grammar: ReetalkGrammar[];
  phrases: ReetalkPhrase[];
  questions: ReetalkQuestion[];
}

/** Content-only `.reetalkdraft.json` (draftSchemaVersion 1). No media, no timings. */
export interface ReetalkDraft {
  draftSchemaVersion: 1;
  contentType: "reetalk";
  dialogueId: string;
  categoryId: string;
  targetLanguage: TargetLanguage;
  locale: string;
  level: Level;
  title: ReetalkLocalized;
  objective: ReetalkLocalized;
  /** Exactly two speakers. */
  speakers: ReetalkSpeaker[];
  /** 8–120 turns, at least 4 per speaker, array order is conversation order. */
  turns: ReetalkTurn[];
  learning: ReetalkLearning;
}

export interface ReetalkMediaAudio {
  path: "audio.mp3" | "audio.m4a" | "audio.wav";
  mimeType: "audio/mpeg" | "audio/mp4" | "audio/wav";
  durationMs: number;
  sha256: string;
}

export interface ReetalkMediaCover {
  path: "cover.jpg" | "cover.png" | "cover.webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
}

/** Published `dialogue.json` inside a ReeTalk `.rdpack`. */
export interface ReetalkDialogue {
  contentType: "reetalk";
  schemaVersion: 1;
  contentVersionCode: number;
  dialogueId: string;
  categoryId: string;
  targetLanguage: TargetLanguage;
  locale: string;
  level: Level;
  title: ReetalkLocalized;
  objective: ReetalkLocalized;
  speakers: ReetalkSpeaker[];
  turns: ReetalkTimedTurn[];
  learning: ReetalkLearning;
  media: { audio: ReetalkMediaAudio; cover: ReetalkMediaCover };
}

/** Signed `latest.json` payload for ReeTalk (manifestVersion 2). */
export interface ReetalkManifestPayload {
  manifestVersion: 2;
  contentType: "reetalk";
  dialogueId: string;
  targetLanguage: TargetLanguage;
  dialogueSchemaVersion: 1;
  contentVersionCode: number;
  package: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
    encryptionKeyId: string;
  };
}

/** Either the song lesson draft or a ReeTalk dialogue draft. */
export type ProjectContent = DraftContent | ReetalkDraft;

export function isReeTalkContent(value: unknown): value is ReetalkDraft {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { contentType?: unknown }).contentType === "reetalk" &&
    (value as { draftSchemaVersion?: unknown }).draftSchemaVersion === 1
  );
}

export type ContentKind = "song" | "reetalk";

export function contentKindOf(value: unknown): ContentKind {
  return isReeTalkContent(value) ? "reetalk" : "song";
}

export interface MediaInfo {
  audioPath: string;
  audioFileName: string;
  audioSha256: string;
  mimeType: string;
  extension: "mp3" | "m4a" | "wav";
  durationMs: number;
  bytes: number;
  importedAt: string;
  sourceName: string;
  coverPath?: string;
  coverSha256?: string;
  coverMimeType?: string;
  coverExtension?: "jpg" | "png" | "webp";
  coverBytes?: number;
  storyAudioPath?: string;
  storyAudioFileName?: string;
  storyAudioSha256?: string;
  storyAudioMimeType?: string;
  storyAudioExtension?: "mp3" | "m4a" | "wav";
  storyAudioDurationMs?: number;
  storyAudioBytes?: number;
}

export interface LessonCredits {
  audio: string;
  lyrics: string;
  cover?: string;
  noticeFa: string;
  noticeEn: string;
}

export interface LessonAudio {
  path: "audio.mp3" | "audio.m4a" | "audio.wav" | "story.mp3" | "story.m4a" | "story.wav";
  mimeType: "audio/mpeg" | "audio/mp4" | "audio/wav";
  durationMs: number;
  sha256: string;
}

export interface LessonCover {
  path: "cover.jpg" | "cover.png" | "cover.webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
}

/** Published lesson (v1) that lives inside the encrypted `.rdpack`. */
export interface Lesson {
  schemaVersion: 1;
  songId: string;
  targetLanguage: TargetLanguage;
  locale: string;
  title: string;
  artist: string;
  level: Level;
  disclaimerFa?: string;
  disclaimerEn?: string;
  credits: LessonCredits;
  media: { audio: LessonAudio; cover?: LessonCover; storyAudio?: LessonAudio };
  lyrics: (Omit<LyricLine, never> & { startMs: number; endMs?: number })[];
  story?: LessonStory;
  vocabulary: Word[];
  grammar: GrammarItem[];
  idioms: Phrase[];
  sentences: Phrase[];
  vocabularyTables: LearningTable[];
  questions: Question[];
  idAliases?: IdAlias[];
}

export interface ManifestPayload {
  manifestVersion: 1;
  songId: string;
  targetLanguage: TargetLanguage;
  contentVersionCode: number;
  displayVersion: string;
  containerVersion: 1;
  lessonSchemaVersion: 1;
  releasedAt: string;
  package: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
    encryptionKeyId: string;
  };
}

export interface ManifestEnvelope {
  signatureKeyId: string;
  payload: string;
  signature: string;
}

/** Either the song payload (v1) or the ReeTalk payload (v2) inside an envelope. */
export type SignedPayload = ManifestPayload | ReetalkManifestPayload;

/** Operator rights checklist recorded in the local project (never in the pack). */
export interface RightsChecklist {
  audioRights: boolean;
  lyricsRights: boolean;
  coverRights: boolean;
  offlineDownloadAllowed: boolean;
  demoAudioDisclosure: boolean;
  evidenceRef: string;
  notes: string;
  /**
   * Audio/cover credits are operator-owned project fields: the content-only
   * draft schema forbids `credits.audio` and `credits.cover` (there is no media
   * yet when the agent writes the draft), while `lesson.json` requires them.
   */
  audioCredit: string;
  coverCredit: string;
  completedAt?: string;
  completedBy?: string;
}

export interface LyricMark {
  lineId: string;
  startMs: number | null;
  endMs: number | null;
  /** true when this mark was reviewed against the current audio and line text. */
  reviewed: boolean;
  reviewedAudioSha: string | null;
  reviewedLineSha?: string | null;
}

export interface Issue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export type ProjectState =
  | "raw-imported"
  | "audio-selected"
  | "sync-incomplete"
  | "review-ready"
  | "approved";

export interface ExportSummary {
  exportId: string;
  projectId: string;
  songId: string;
  targetLanguage: TargetLanguage;
  title: string;
  versionCode: number;
  displayVersion: string;
  packPath: string;
  packSha256: string;
  packSize: number;
  manifestPath: string;
  manifestSha256: string;
  encryptionKeyId: string;
  signatureKeyId: string;
  exportedAt: string;
  usedTestKeys: boolean;
  fileState: "present" | "missing";
  superseded: boolean;
  publication: {
    manifestUrl: string;
    verifiedAt: string;
    publishedAt: string;
    remotePackSha256: string;
  } | null;
}

export interface ProjectSummary {
  projectId: string;
  /** Content profile: a song lesson or a ReeTalk dialogue. */
  kind: ContentKind;
  songId: string;
  targetLanguage: TargetLanguage;
  locale: string;
  title: string;
  artist: string;
  level: string;
  state: ProjectState;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  audio: {
    fileName: string;
    sha256: string;
    durationMs: number;
    bytes: number;
    mimeType: string;
    hasCover: boolean;
  } | null;
  lineCount: number;
  timedCount: number;
  reviewedCount: number;
  exportCount: number;
  latestExportVersion: number | null;
  issueCount: number;
  warningCount: number;
}

export interface PreflightGate {
  key: string;
  labelFa: string;
  labelEn: string;
  ok: boolean;
  detail: string;
}

export interface PreflightReport {
  projectId: string;
  canExport: boolean;
  gates: PreflightGate[];
  issues: Issue[];
  nextVersionCode: number;
  contentHash: string;
  timelineHash: string;
  audioSha256: string | null;
}

export interface ProjectDetail {
  summary: ProjectSummary;
  /** The stored draft: a song lesson or a ReeTalk dialogue (see `summary.kind`). */
  content: ProjectContent;
  marks: LyricMark[];
  media: MediaInfo | null;
  rights: RightsChecklist;
  rawSha256: string;
  rawJsonPath: string;
  contentEditedAt: string;
  revisionCount: number;
  issues: Issue[];
  warnings: Issue[];
  exports: ExportSummary[];
  preflight: PreflightReport;
}

export interface LibraryData {
  projects: ProjectSummary[];
  exports: ExportSummary[];
  archiveDir: string;
  dataDir: string;
  counts: { songs: number; projects: number; exports: number; published: number; missing: number };
}

export interface ImportOutcome {
  projectId: string;
  songId: string;
  title: string;
  issues: Issue[];
  warnings: Issue[];
}

/** Result of replacing a project's JSON with a new draft file. */
export interface ReplaceDraftOutcome {
  detail: ProjectDetail;
  /** Lines (song) or turns (ReeTalk) in the new draft. */
  total: number;
  added: number;
  removed: number;
  /** Same id, different text/translation/tokens: timing kept, review reset. */
  changed: number;
  timingsKept: number;
  nextVersionCode: number;
  warnings: number;
}

export interface MediaOutcome {
  media: MediaInfo;
  warnings: Issue[];
  durationSource: "container" | "decoder" | "unknown";
}

export interface KeyRecord {
  keyId: string;
  kind: "enc" | "sig";
  createdAt: string;
  testOnly: boolean;
  protection: "safeStorage" | "none" | "passphrase";
  publicKeyBase64url?: string;
  fingerprint?: string;
}

/** Where the `.rdpack` AES-256 key comes from; never carries key bytes. */
export type PackKeySource = "env" | "file" | "keystore" | "test";

export interface PackKeyInfo {
  keyId: string;
  source: PackKeySource;
  testOnly: boolean;
  /** First 16 hex chars of SHA-256 over the key, for support/debugging only. */
  fingerprint: string;
  keyFile: string;
  error?: string;
}

export interface ExportOutcome {
  exportId: string;
  versionCode: number;
  displayVersion: string;
  packPath: string;
  packSha256: string;
  packSize: number;
  manifestPath: string;
  manifestSha256: string;
  manifestUrlHint: string;
  usedTestKeys: boolean;
  verification: {
    packLength: number;
    packSha256: string;
    audioSha256: string;
    lessonSchemaOk: boolean;
    signatureVerified: boolean;
    zipEntries: string[];
    nonceBase64url: string;
  };
}

export interface RescanReport {
  scanned: number;
  present: number;
  missing: string[];
  orphans: string[];
  warnings: string[];
}

export interface StatsScope {
  scope: "latest-published" | "latest-exported" | "drafts" | "all-versions";
  targetLanguage?: TargetLanguage | "all";
}

export interface LanguageStats {
  targetLanguage: TargetLanguage;
  songs: number;
  versions: number;
  uniqueLexemes: number;
  lexemeEntries: number;
  sentences: number;
  grammarCards: number;
  idioms: number;
  lyricLines: number;
  questions: number;
  vocabTables: number;
  published: number;
  missingFiles: number;
}

export interface StatsReport {
  generatedAt: string;
  scope: StatsScope["scope"];
  targetLanguage: TargetLanguage | "all";
  sourcesHash: string;
  songs: number;
  versions: number;
  languages: LanguageStats[];
  notices: string[];
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  dataDir: string;
  archiveDir: string;
  safeStorage: boolean;
}

export interface StagedBundle {
  folder: string;
  packPath: string;
  manifestPath: string;
  packSha256: string;
}

export interface PublicationOutcome {
  exportId: string;
  manifestUrl: string;
  remotePackSha256: string;
  remoteManifestSha256: string;
  verifiedAt: string;
  publishedAt: string;
}

export type ThemeMode = "dark" | "light" | "system";

export interface Settings {
  archiveDir: string;
  lang: "fa" | "en";
  theme: ThemeMode;
  reducedMotion: boolean;
  allowTestKeys: boolean;
  lastProjectId?: string;
  defaultManifestBaseUrl: string;
  complianceAckAt?: string;
}

export interface StudioApi {
  app: {
    info(): Promise<AppInfo>;
    rescan(): Promise<RescanReport>;
    openExternal(url: string): Promise<void>;
    showItemInFolder(target: string): Promise<void>;
    saveTextFile(options: {
      defaultName: string;
      contents: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<string | null>;
    onLibraryChanged(cb: () => void): () => void;
    onCommand(cb: (command: "import-draft" | "new-project" | "open-settings" | "open-stats") => void): () => void;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    pickFolder(title: string): Promise<string | null>;
  };
  library: {
    list(): Promise<LibraryData>;
  };
  projects: {
    importDraft(): Promise<ImportOutcome | null>;
    createEmpty(input: {
      songId: string;
      title: string;
      artist: string;
      targetLanguage: TargetLanguage;
      locale: string;
      level: Level;
    }): Promise<ImportOutcome>;
    get(projectId: string): Promise<ProjectDetail>;
    saveContent(projectId: string, content: ProjectContent): Promise<ProjectDetail>;
    /** Pick a new draft file for this project (same id + profile); null when cancelled. */
    replaceDraft(projectId: string): Promise<ReplaceDraftOutcome | null>;
    saveRights(projectId: string, rights: RightsChecklist): Promise<ProjectDetail>;
    remove(projectId: string): Promise<void>;
  };
  media: {
    selectAudio(projectId: string): Promise<MediaOutcome | null>;
    selectCover(projectId: string): Promise<MediaOutcome | null>;
    removeCover(projectId: string): Promise<MediaOutcome>;
    selectStoryAudio(projectId: string): Promise<MediaOutcome | null>;
    removeStoryAudio(projectId: string): Promise<MediaOutcome>;
    reportDuration(projectId: string, durationMs: number, kind?: "audio" | "story-audio"): Promise<MediaOutcome>;
    playUrl(projectId: string, kind: "audio" | "cover" | "story-audio"): Promise<string | null>;
    bytes(projectId: string, kind: "audio" | "cover" | "story-audio"): Promise<ArrayBuffer | null>;
    /**
     * Speak `text` with the OS voice. Used by the story editor to preview the
     * narration of a story page; never writes or transmits anything.
     */
    speak(input: { text: string; lang: string }): Promise<boolean>;
  };
  marks: {
    save(projectId: string, marks: { lineId: string; startMs: number | null; endMs: number | null }[]): Promise<ProjectDetail>;
    distribute(projectId: string): Promise<ProjectDetail>;
    setReviewed(projectId: string, lineIds: string[], reviewed: boolean): Promise<ProjectDetail>;
  };
  review: {
    approve(projectId: string, input: { approver: string; note: string }): Promise<ProjectDetail>;
    revoke(projectId: string): Promise<ProjectDetail>;
  };
  exports: {
    /** One-click export: keys, version and manifest URL are resolved by the app. */
    quick(projectId: string, input?: { displayVersion?: string; manifestBaseUrl?: string }): Promise<ExportOutcome>;
    preflight(projectId: string): Promise<PreflightReport>;
    run(
      projectId: string,
      options: {
        encryptionKeyId: string;
        signatureKeyId: string;
        displayVersion: string;
        manifestBaseUrl: string;
        useTestKeys: boolean;
      },
    ): Promise<ExportOutcome>;
    verify(exportId: string): Promise<PreflightReport & { verified: boolean; detail: string[] }>;
    stage(exportId: string): Promise<StagedBundle | null>;
    publish(exportId: string, manifestUrl: string): Promise<PublicationOutcome>;
    openFolder(exportId: string): Promise<void>;
  };
  stats: {
    get(scope: StatsScope): Promise<StatsReport>;
    save(scope: StatsScope, format: "csv" | "json"): Promise<string | null>;
  };
}
