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
  text: string;
  translationFa: string;
  translationEn: string;
  tokens: Token[];
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
  vocabulary: Word[];
  grammar: GrammarItem[];
  idioms: Phrase[];
  sentences: Phrase[];
  vocabularyTables: LearningTable[];
  questions: Question[];
  idAliases?: IdAlias[];
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
}

export interface LessonCredits {
  audio: string;
  lyrics: string;
  cover?: string;
  noticeFa: string;
  noticeEn: string;
}

export interface LessonAudio {
  path: "audio.mp3" | "audio.m4a" | "audio.wav";
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
  media: { audio: LessonAudio; cover?: LessonCover };
  lyrics: (Omit<LyricLine, never> & { startMs: number; endMs?: number })[];
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
  content: DraftContent;
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
  keyCount: number;
  testKeysOnly: boolean;
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

export interface Settings {
  archiveDir: string;
  lang: "fa" | "en";
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
    saveContent(projectId: string, content: DraftContent): Promise<ProjectDetail>;
    saveRights(projectId: string, rights: RightsChecklist): Promise<ProjectDetail>;
    remove(projectId: string): Promise<void>;
  };
  media: {
    selectAudio(projectId: string): Promise<MediaOutcome | null>;
    selectCover(projectId: string): Promise<MediaOutcome | null>;
    removeCover(projectId: string): Promise<MediaOutcome>;
    reportDuration(projectId: string, durationMs: number): Promise<MediaOutcome>;
    playUrl(projectId: string, kind: "audio" | "cover"): Promise<string | null>;
    bytes(projectId: string, kind: "audio" | "cover"): Promise<ArrayBuffer | null>;
  };
  marks: {
    save(projectId: string, marks: { lineId: string; startMs: number | null; endMs: number | null }[]): Promise<ProjectDetail>;
    setReviewed(projectId: string, lineIds: string[], reviewed: boolean): Promise<ProjectDetail>;
  };
  review: {
    approve(projectId: string, input: { approver: string; note: string }): Promise<ProjectDetail>;
    revoke(projectId: string): Promise<ProjectDetail>;
  };
  exports: {
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
  keys: {
    list(): Promise<KeyRecord[]>;
    generateTest(): Promise<KeyRecord[]>;
    importFromFile(): Promise<KeyRecord[]>;
    backup(passphrase: string): Promise<string | null>;
  };
  stats: {
    get(scope: StatsScope): Promise<StatsReport>;
    save(scope: StatsScope, format: "csv" | "json"): Promise<string | null>;
  };
}
