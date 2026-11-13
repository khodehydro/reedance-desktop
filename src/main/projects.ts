import fs from "node:fs";
import path from "node:path";
import type {
  DraftContent,
  ExportSummary,
  Issue,
  Lesson,
  LibraryData,
  LyricMark,
  MediaInfo,
  PreflightGate,
  PreflightReport,
  ProjectDetail,
  ProjectState,
  ProjectSummary,
  RightsChecklist,
  TargetLanguage,
} from "../shared/types";
import { all, audit, flushNow, get, run, scalar, transaction } from "./db";
import { projectDir, rawDraftPath, revisionsDir, writeFileAtomic } from "./paths";
import { hashJson, nowIso, sha256Hex } from "./util";
import { assembleLesson } from "./lesson";
import { validateContentSemantics, validateDraftStructure, validateLessonStructure } from "./validation";

export interface ProjectRow {
  project_id: string;
  song_id: string;
  raw_json_path: string;
  raw_sha256: string;
  draft_json: string;
  content_json: string;
  content_hash: string;
  state: string;
  rights_json: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
}

export interface MediaRow {
  project_id: string;
  audio_copy_path: string;
  audio_source_name: string;
  audio_sha256: string;
  mime_type: string;
  extension: string;
  duration_ms: number;
  bytes: number;
  cover_copy_path: string | null;
  cover_sha256: string | null;
  cover_mime_type: string | null;
  cover_extension: string | null;
  cover_bytes: number | null;
  imported_at: string;
}

interface ExportRow {
  export_id: string;
  project_id: string;
  revision_id: string | null;
  song_id: string;
  version_code: number;
  display_version: string;
  pack_path: string;
  pack_sha256: string;
  pack_size: number;
  manifest_path: string;
  manifest_sha256: string;
  payload_json: string;
  encryption_key_id: string;
  signature_key_id: string;
  used_test_keys: number;
  exported_at: string;
  file_state: string;
}

export const EMPTY_RIGHTS: RightsChecklist = {
  audioRights: false,
  lyricsRights: false,
  coverRights: false,
  offlineDownloadAllowed: false,
  demoAudioDisclosure: false,
  evidenceRef: "",
  notes: "",
  audioCredit: "",
  coverCredit: "",
};

export function lineHash(line: DraftContent["lyrics"][number]): string {
  return hashJson({
    text: line.text,
    translationFa: line.translationFa,
    translationEn: line.translationEn,
    tokens: line.tokens,
  });
}

export function contentHash(content: DraftContent): string {
  return hashJson(content);
}

export function timelineHash(marks: LyricMark[]): string {
  return hashJson(
    [...marks]
      .sort((a, b) => a.lineId.localeCompare(b.lineId))
      .map((mark) => ({ lineId: mark.lineId, startMs: mark.startMs, endMs: mark.endMs })),
  );
}

export function loadProject(projectId: string): ProjectRow {
  const row = get<ProjectRow>("SELECT * FROM projects WHERE project_id = ?", [projectId]);
  if (!row) throw new Error("project not found");
  return row;
}

export function readContent(row: ProjectRow): DraftContent {
  return JSON.parse(row.content_json) as DraftContent;
}

export function readRights(row: ProjectRow): RightsChecklist {
  try {
    return { ...EMPTY_RIGHTS, ...(JSON.parse(row.rights_json) as Partial<RightsChecklist>) };
  } catch {
    return { ...EMPTY_RIGHTS };
  }
}

export function readMedia(projectId: string): { media: MediaInfo; row: MediaRow } | null {
  const row = get<MediaRow>("SELECT * FROM project_media WHERE project_id = ?", [projectId]);
  if (!row) return null;
  return {
    row,
    media: {
      audioPath: row.audio_copy_path,
      audioFileName: path.basename(row.audio_copy_path),
      audioSha256: row.audio_sha256,
      mimeType: row.mime_type,
      extension: row.extension as MediaInfo["extension"],
      durationMs: row.duration_ms,
      bytes: row.bytes,
      importedAt: row.imported_at,
      sourceName: row.audio_source_name,
      coverPath: row.cover_copy_path ?? undefined,
      coverSha256: row.cover_sha256 ?? undefined,
      coverMimeType: row.cover_mime_type ?? undefined,
      coverExtension: (row.cover_extension as MediaInfo["coverExtension"]) ?? undefined,
      coverBytes: row.cover_bytes ?? undefined,
    },
  };
}

export function readMarks(projectId: string): LyricMark[] {
  const rows = all<{ line_id: string; start_ms: number | null; end_ms: number | null; reviewed_audio_sha: string | null; reviewed_line_sha: string | null }>(
    "SELECT line_id, start_ms, end_ms, reviewed_audio_sha, reviewed_line_sha FROM lyric_marks WHERE project_id = ?",
    [projectId],
  );
  return rows.map((row) => ({
    lineId: row.line_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    reviewed: false,
    reviewedAudioSha: row.reviewed_audio_sha,
    reviewedLineSha: row.reviewed_line_sha,
  }));
}


export function markIsReviewed(mark: LyricMark, lineSha: string, audioSha: string | null): boolean {
  return mark.reviewedAudioSha === audioSha && mark.reviewedAudioSha !== null && audioSha !== null;
}

/** Attach the current review verdict to every mark (audio hash + line hash). */
export function withReviewState(marks: LyricMark[], content: DraftContent, media: MediaInfo | null): LyricMark[] {
  const lineShas = new Map(content.lyrics.map((line) => [line.id, lineHash(line)]));
  return marks.map((mark) => ({
    ...mark,
    reviewed:
      mark.startMs !== null &&
      !!media &&
      mark.reviewedAudioSha === media.audioSha256 &&
      !!mark.reviewedLineSha &&
      mark.reviewedLineSha === lineShas.get(mark.lineId),
  }));
}

function stateFor(content: DraftContent, marks: LyricMark[], media: MediaInfo | null, approvedAt: string | null): ProjectState {
  if (approvedAt) return "approved";
  if (!media) return "raw-imported";
  const timed = marks.filter((mark) => mark.startMs !== null);
  if (timed.length === 0) return "audio-selected";
  const reviewable = withReviewState(marks, content, media);
  const reviewed = reviewable.filter((mark) => mark.reviewed);
  if (timed.length === content.lyrics.length && reviewed.length === content.lyrics.length) return "review-ready";
  return "sync-incomplete";
}

export function refreshState(projectId: string): ProjectState {
  const row = loadProject(projectId);
  const content = readContent(row);
  const marks = readMarks(projectId);
  const media = readMedia(projectId)?.media ?? null;
  const state = stateFor(content, marks, media, row.approved_at);
  run("UPDATE projects SET state = ? WHERE project_id = ?", [state, projectId]);
  return state;
}

function parseRowList<T>(json: string): T[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function exportSummaries(projectId?: string, songId?: string): ExportSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (projectId) {
    where.push("e.project_id = ?");
    params.push(projectId);
  }
  if (songId) {
    where.push("e.song_id = ?");
    params.push(songId);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = all<ExportRow & { target_language: TargetLanguage; title: string; published_at: string | null; manifest_url: string | null; verified_at: string | null; remote_pack_sha256: string | null }>(
    `SELECT e.*, s.target_language, s.title, p.published_at, p.manifest_url, p.verified_at, p.remote_pack_sha256
     FROM exports e
     JOIN songs s ON s.song_id = e.song_id
     LEFT JOIN publications p ON p.export_id = e.export_id
     ${clause}
     ORDER BY e.song_id, e.version_code DESC`,
    params,
  );
  const maxBySong = new Map<string, number>();
  for (const row of rows) {
    maxBySong.set(row.song_id, Math.max(maxBySong.get(row.song_id) ?? 0, row.version_code));
  }
  return rows.map((row) => {
    let present = false;
    try {
      present = fs.statSync(row.pack_path).size > 0 && fs.existsSync(row.manifest_path);
    } catch {
      present = false;
    }
    const maxVersion = maxBySong.get(row.song_id) ?? row.version_code;
    return {
      exportId: row.export_id,
      projectId: row.project_id,
      songId: row.song_id,
      targetLanguage: row.target_language,
      title: row.title,
      versionCode: row.version_code,
      displayVersion: row.display_version,
      packPath: row.pack_path,
      packSha256: row.pack_sha256,
      packSize: row.pack_size,
      manifestPath: row.manifest_path,
      manifestSha256: row.manifest_sha256,
      encryptionKeyId: row.encryption_key_id,
      signatureKeyId: row.signature_key_id,
      exportedAt: row.exported_at,
      usedTestKeys: row.used_test_keys === 1,
      fileState: present ? "present" : "missing",
      superseded: row.version_code < maxVersion,
      publication:
        row.published_at && row.manifest_url
          ? {
              manifestUrl: row.manifest_url,
              verifiedAt: row.verified_at ?? "",
              publishedAt: row.published_at,
              remotePackSha256: row.remote_pack_sha256 ?? "",
            }
          : null,
    };
  });
}

export function nextVersionCode(songId: string): number {
  const max = scalar<number>("SELECT COALESCE(MAX(version_code), 0) FROM exports WHERE song_id = ?", [songId]) ?? 0;
  return Number(max) + 1;
}

function projectIssues(row: ProjectRow, content: DraftContent, media: MediaInfo | null): { errors: Issue[]; warnings: Issue[] } {
  const structural = validateDraftStructure(content);
  const semantic = validateContentSemantics(content);
  const all_ = [...structural, ...semantic];
  const warnings = all_.filter((issue) => issue.severity === "warning");
  const errors = all_.filter((issue) => issue.severity === "error");
  if (!content.artist?.trim()) {
    errors.push({ path: "artist", message: "artist is required before export", severity: "error" });
  }
  if (!content.level) {
    errors.push({ path: "level", message: "level is required before export", severity: "error" });
  }
  if (!media) {
    warnings.push({ path: "media", message: "no audio selected yet; timeline sync and export are locked", severity: "warning" });
  }
  void row;
  return { errors, warnings };
}

export function preflight(projectId: string): PreflightReport {
  const row = loadProject(projectId);
  const content = readContent(row);
  const media = readMedia(projectId)?.media ?? null;
  const marks = withReviewState(readMarks(projectId), content, media);
  const rights = readRights(row);
  const { errors, warnings } = projectIssues(row, content, media);
  const issues = [...errors, ...warnings];

  const lineShas = new Map(content.lyrics.map((line) => [line.id, lineHash(line)]));
  const timed = marks.filter((mark) => mark.startMs !== null);
  const sorted = [...timed].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  const strictlyIncreasing = sorted.every((mark, index) => index === 0 || (mark.startMs ?? 0) > (sorted[index - 1].startMs ?? 0));
  const withinAudio = media ? sorted.every((mark) => (mark.startMs ?? 0) < media.durationMs) : false;
  const reviewedCount = withReviewState(marks, content, media).filter((mark) => mark.reviewed).length;
  void lineShas;

  const rightsComplete =
    rights.audioRights &&
    rights.lyricsRights &&
    (media?.coverPath ? rights.coverRights : true) &&
    rights.offlineDownloadAllowed &&
    rights.evidenceRef.trim().length > 0;

  const revision = get<{ revision_id: string; content_hash: string; timeline_sha256: string; media_sha256: string | null }>(
    "SELECT revision_id, content_hash, timeline_sha256, media_sha256 FROM revisions WHERE project_id = ? ORDER BY imported_at DESC LIMIT 1",
    [projectId],
  );
  const currentContentHash = contentHash(content);
  const currentTimelineHash = timelineHash(marks);
  const approvalMatchesRevision =
    !!row.approved_at &&
    !!revision &&
    revision.content_hash === currentContentHash &&
    revision.timeline_sha256 === currentTimelineHash &&
    revision.media_sha256 === (media?.audioSha256 ?? null);

  const gates: PreflightGate[] = [
    {
      key: "audio",
      labelFa: "فایل صوتی انتخاب و کپی شده است",
      labelEn: "Audio selected and copied into the project",
      ok: !!media,
      detail: media ? `${media.audioFileName} · ${Math.round(media.durationMs / 1000)}s · ${media.audioSha256.slice(0, 12)}…` : "صوتی انتخاب نشده",
    },
    {
      key: "duration",
      labelFa: "مدت صوت اندازه‌گیری شده است",
      labelEn: "Audio duration measured",
      ok: !!media && media.durationMs > 0,
      detail: media ? `${media.durationMs} ms` : "—",
    },
    {
      key: "timed",
      labelFa: "همهٔ سطرها زمان دارند",
      labelEn: "Every lyric line is timed",
      ok: content.lyrics.length > 0 && timed.length === content.lyrics.length,
      detail: `${timed.length}/${content.lyrics.length}`,
    },
    {
      key: "timing",
      labelFa: "زمان‌ها صعودی و داخل مدت صوت‌اند",
      labelEn: "Timings increase strictly and stay inside the audio",
      ok: timed.length === content.lyrics.length && strictlyIncreasing && withinAudio,
      detail: `${timed.length}/${content.lyrics.length} · ${strictlyIncreasing ? "ascending" : "out of order"}${withinAudio ? "" : " · outside audio"}`,
    },
    {
      key: "reviewed",
      labelFa: "همهٔ سطرها با همین صوت بازبینی شده‌اند",
      labelEn: "Every line reviewed against the current audio",
      ok: content.lyrics.length > 0 && reviewedCount === content.lyrics.length,
      detail: `${reviewedCount}/${content.lyrics.length}`,
    },
    {
      key: "content",
      labelFa: "محتوای آموزشی بدون خطاست",
      labelEn: "Lesson content has no blocking errors",
      ok: errors.length === 0,
      detail: errors.length ? `${errors.length} خطا` : "بدون خطا",
    },
    {
      key: "rights",
      labelFa: "چک‌لیست حقوق کامل است",
      labelEn: "Rights checklist is complete",
      ok: rightsComplete,
      detail: rightsComplete ? rights.evidenceRef : "مدرک/تأیید ناقص",
    },
    {
      key: "approved",
      labelFa: "تأیید نهایی انسانی ثبت شده است",
      labelEn: "Human approval recorded",
      ok: !!row.approved_at,
      detail: row.approved_at ? `${row.approved_by ?? ""} · ${row.approved_at.slice(0, 19)}` : "تأیید نشده",
    },
    {
      key: "approval-current",
      labelFa: "تأیید با نسخهٔ فعلی محتوا/صوت/زمان‌ها می‌خواند",
      labelEn: "Approval still matches content, audio and timeline",
      ok: approvalMatchesRevision,
      detail: approvalMatchesRevision ? "هم‌خوان" : "پس از تأیید تغییر کرده است",
    },
  ];

  return {
    projectId,
    canExport: gates.every((gate) => gate.ok),
    gates,
    issues,
    nextVersionCode: nextVersionCode(row.song_id),
    contentHash: currentContentHash,
    timelineHash: currentTimelineHash,
    audioSha256: media?.audioSha256 ?? null,
  };
}

export function projectSummary(row: ProjectRow): ProjectSummary {
  const content = readContent(row);
  const marks = readMarks(row.project_id);
  const media = readMedia(row.project_id)?.media ?? null;
  const exports = exportSummaries(row.project_id);
  const { errors, warnings } = projectIssues(row, content, media);
  const timed = marks.filter((mark) => mark.startMs !== null).length;
  const reviewed = withReviewState(marks, content, media).filter((mark) => mark.reviewed).length;
  const latest = exports.reduce((max, item) => Math.max(max, item.versionCode), 0);
  return {
    projectId: row.project_id,
    songId: row.song_id,
    targetLanguage: content.targetLanguage,
    locale: content.locale,
    title: content.title,
    artist: content.artist ?? "",
    level: content.level ?? "",
    state: (row.state as ProjectState) ?? "raw-imported",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    audio: media
      ? {
          fileName: media.audioFileName,
          sha256: media.audioSha256,
          durationMs: media.durationMs,
          bytes: media.bytes,
          mimeType: media.mimeType,
          hasCover: !!media.coverPath,
        }
      : null,
    lineCount: content.lyrics.length,
    timedCount: timed,
    reviewedCount: reviewed,
    exportCount: exports.length,
    latestExportVersion: latest || null,
    issueCount: errors.length,
    warningCount: warnings.length,
  };
}

export function listLibrary(archiveDir: string, dataDir: string): LibraryData {
  const rows = all<ProjectRow>("SELECT * FROM projects ORDER BY updated_at DESC");
  const projects = rows.map(projectSummary);
  const exports = exportSummaries();
  for (const row of rows) refreshState(row.project_id);
  for (const item of exports) {
    const present = item.fileState === "present";
    run("UPDATE exports SET file_state = ? WHERE export_id = ?", [present ? "present" : "missing", item.exportId]);
  }
  return {
    projects,
    exports,
    archiveDir,
    dataDir,
    counts: {
      songs: new Set(projects.map((project) => project.songId)).size,
      projects: projects.length,
      exports: exports.length,
      published: exports.filter((item) => item.publication).length,
      missing: exports.filter((item) => item.fileState === "missing").length,
    },
  };
}

export interface CreateProjectInput {
  draft: DraftContent;
  rawPath: string;
  rawSha256: string;
}

export function createProject(input: CreateProjectInput): string {
  const { draft } = input;
  const existing = get<{ project_id: string }>("SELECT project_id FROM projects WHERE song_id = ? AND target_language = ?", [
    draft.songId,
    draft.targetLanguage,
  ]);
  if (existing) {
    throw new Error(`a project for songId "${draft.songId}" (${draft.targetLanguage}) already exists; open it instead of importing twice`);
  }
  // A song identity is immutable once created, so reuse the row if it exists.
  const song = get<{ song_id: string }>("SELECT song_id FROM songs WHERE song_id = ?", [draft.songId]);
  const projectId = `prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = nowIso();

  transaction(() => {
    if (!song) {
      run("INSERT INTO songs(song_id, target_language, title, artist, created_at) VALUES (?, ?, ?, ?, ?)", [
        draft.songId,
        draft.targetLanguage,
        draft.title,
        draft.artist ?? "",
        timestamp,
      ]);
    } else {
      const songRow = get<{ target_language: string }>("SELECT target_language FROM songs WHERE song_id = ?", [draft.songId]);
      if (songRow && songRow.target_language !== draft.targetLanguage) {
        throw new Error(`songId "${draft.songId}" is already pinned to targetLanguage "${songRow.target_language}"`);
      }
    }
    run(
      `INSERT INTO projects(project_id, song_id, raw_json_path, raw_sha256, draft_json, content_json, content_hash, state, rights_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'raw-imported', ?, ?, ?)`,
      [
        projectId,
        draft.songId,
        input.rawPath,
        input.rawSha256,
        JSON.stringify(draft),
        JSON.stringify(draft),
        contentHash(draft),
        JSON.stringify(EMPTY_RIGHTS),
        timestamp,
        timestamp,
      ],
    );
    audit(projectId, "draft-imported", "operator", { songId: draft.songId, rawSha256: input.rawSha256 });
  });
  flushNow();
  return projectId;
}

export function saveRawSnapshot(sha256: string, bytes: Buffer): string {
  const target = rawDraftPath(sha256);
  if (!fs.existsSync(target)) writeFileAtomic(target, bytes, 0o444);
  return target;
}

export function getProjectDetail(projectId: string): ProjectDetail {
  const row = loadProject(projectId);
  const content = readContent(row);
  const media = readMedia(projectId)?.media ?? null;
  const marks = withReviewState(readMarks(projectId), content, media);
  const rights = readRights(row);
  const { errors, warnings } = projectIssues(row, content, media);
  const revisionCount =
    scalar<number>("SELECT COUNT(*) FROM revisions WHERE project_id = ?", [projectId]) ?? 0;
  return {
    summary: projectSummary(row),
    content,
    marks,
    media,
    rights,
    rawSha256: row.raw_sha256,
    rawJsonPath: row.raw_json_path,
    contentEditedAt: row.updated_at,
    revisionCount: Number(revisionCount),
    issues: errors,
    warnings,
    exports: exportSummaries(projectId),
    preflight: preflight(projectId),
  };
}

function invalidateApproval(projectId: string, reason: string): void {
  const row = loadProject(projectId);
  if (!row.approved_at) return;
  run("UPDATE projects SET approved_at = NULL, approved_by = NULL WHERE project_id = ?", [projectId]);
  audit(projectId, "approval-invalidated", "system", { reason });
}

export function saveContent(projectId: string, content: DraftContent): ProjectDetail {
  const row = loadProject(projectId);
  const previous = readContent(row);
  if (!content || typeof content !== "object") throw new Error("content must be an object");
  if (content.songId !== previous.songId) throw new Error("songId is immutable");
  if (content.targetLanguage !== previous.targetLanguage) throw new Error("targetLanguage is immutable for a songId");
  if (!Array.isArray(content.lyrics) || content.lyrics.length === 0) throw new Error("a project needs at least one lyric line");

  const previousShas = new Map(previous.lyrics.map((line) => [line.id, lineHash(line)]));
  const changedLines = content.lyrics
    .filter((line) => previousShas.get(line.id) !== lineHash(line))
    .map((line) => line.id);
  const removedLines = previous.lyrics.filter((line) => !content.lyrics.some((line) => line.id === line.id)).map((line) => line.id);
  const nextContentHash = contentHash(content);

  transaction(() => {
    run("UPDATE projects SET content_json = ?, content_hash = ?, updated_at = ? WHERE project_id = ?", [
      JSON.stringify(content),
      nextContentHash,
      nowIso(),
      projectId,
    ]);
    run("UPDATE songs SET title = ?, artist = ? WHERE song_id = ?", [
      content.title,
      content.artist ?? "",
      row.song_id,
    ]);
    for (const lineId of [...changedLines, ...removedLines]) {
      run("UPDATE lyric_marks SET reviewed_audio_sha = NULL, reviewed_line_sha = NULL WHERE project_id = ? AND line_id = ?", [
        projectId,
        lineId,
      ]);
    }
    for (const lineId of removedLines) {
      run("DELETE FROM lyric_marks WHERE project_id = ? AND line_id = ?", [projectId, lineId]);
    }
    if (changedLines.length || removedLines.length) {
      invalidateApproval(projectId, "content changed");
    }
    audit(projectId, "content-saved", "operator", { changedLines: changedLines.length, removedLines: removedLines.length });
  });
  refreshState(projectId);
  return getProjectDetail(projectId);
}

export function saveRights(projectId: string, rights: RightsChecklist): ProjectDetail {
  const row = loadProject(projectId);
  const previous = readRights(row);
  const merged: RightsChecklist = { ...EMPTY_RIGHTS, ...rights };
  if (JSON.stringify(previous) !== JSON.stringify(merged)) {
    invalidateApproval(projectId, "rights checklist changed");
  }
  run("UPDATE projects SET rights_json = ?, updated_at = ? WHERE project_id = ?", [
    JSON.stringify(merged),
    nowIso(),
    projectId,
  ]);
  refreshState(projectId);
  return getProjectDetail(projectId);
}

export function saveMedia(projectId: string, media: MediaInfo, resetReview: boolean): void {
  const timestamp = nowIso();
  transaction(() => {
    run(
      `INSERT INTO project_media(project_id, audio_copy_path, audio_source_name, audio_sha256, mime_type, extension, duration_ms, bytes,
        cover_copy_path, cover_sha256, cover_mime_type, cover_extension, cover_bytes, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         audio_copy_path = excluded.audio_copy_path,
         audio_source_name = excluded.audio_source_name,
         audio_sha256 = excluded.audio_sha256,
         mime_type = excluded.mime_type,
         extension = excluded.extension,
         duration_ms = excluded.duration_ms,
         bytes = excluded.bytes,
         cover_copy_path = excluded.cover_copy_path,
         cover_sha256 = excluded.cover_sha256,
         cover_mime_type = excluded.cover_mime_type,
         cover_extension = excluded.cover_extension,
         cover_bytes = excluded.cover_bytes,
         imported_at = excluded.imported_at`,
      [
        projectId,
        media.audioPath,
        media.sourceName,
        media.audioSha256,
        media.mimeType,
        media.extension,
        Math.round(media.durationMs),
        media.bytes,
        media.coverPath ?? null,
        media.coverSha256 ?? null,
        media.coverMimeType ?? null,
        media.coverExtension ?? null,
        media.coverBytes ?? null,
        media.importedAt,
      ],
    );
    if (resetReview) {
      run("UPDATE lyric_marks SET reviewed_audio_sha = NULL, reviewed_line_sha = NULL WHERE project_id = ?", [projectId]);
      invalidateApproval(projectId, "audio replaced");
    }
    run("UPDATE projects SET updated_at = ? WHERE project_id = ?", [timestamp, projectId]);
    audit(projectId, resetReview ? "audio-imported" : "media-updated", "operator", {
      sha256: media.audioSha256,
      durationMs: media.durationMs,
      sourceName: media.sourceName,
    });
  });
  refreshState(projectId);
}

export function saveMarks(
  projectId: string,
  patch: { lineId: string; startMs: number | null; endMs: number | null }[],
  media: MediaInfo | null,
  content: DraftContent,
): void {
  const validIds = new Set(content.lyrics.map((line) => line.id));
  transaction(() => {
    for (const mark of patch) {
      if (!validIds.has(mark.lineId)) throw new Error(`unknown lyric line "${mark.lineId}"`);
      if (mark.startMs !== null && (!Number.isInteger(mark.startMs) || mark.startMs < 0)) {
        throw new Error(`invalid startMs for ${mark.lineId}`);
      }
      if (mark.endMs !== null && (!Number.isInteger(mark.endMs) || mark.endMs < 0)) {
        throw new Error(`invalid endMs for ${mark.lineId}`);
      }
      if (media && mark.startMs !== null && mark.startMs >= media.durationMs) {
        throw new Error(`startMs for ${mark.lineId} is outside the audio`);
      }
      if (mark.startMs !== null && mark.endMs !== null && mark.endMs <= mark.startMs) {
        throw new Error(`endMs for ${mark.lineId} must be after startMs`);
      }
      const existing = get<{ start_ms: number | null; end_ms: number | null }>(
        "SELECT start_ms, end_ms FROM lyric_marks WHERE project_id = ? AND line_id = ?",
        [projectId, mark.lineId],
      );
      if (!existing) {
        run("INSERT INTO lyric_marks(project_id, line_id, start_ms, end_ms) VALUES (?, ?, ?, ?)", [
          projectId,
          mark.lineId,
          mark.startMs,
          mark.endMs,
        ]);
      } else if (existing.start_ms !== mark.startMs || existing.end_ms !== mark.endMs) {
        run(
          "UPDATE lyric_marks SET start_ms = ?, end_ms = ?, reviewed_audio_sha = NULL, reviewed_line_sha = NULL WHERE project_id = ? AND line_id = ?",
          [mark.startMs, mark.endMs, projectId, mark.lineId],
        );
        invalidateApproval(projectId, `timing changed for ${mark.lineId}`);
      }
    }
    run("UPDATE projects SET updated_at = ? WHERE project_id = ?", [nowIso(), projectId]);
  });
  refreshState(projectId);
}

export function setReviewed(projectId: string, lineIds: string[], reviewed: boolean): ProjectDetail {
  const row = loadProject(projectId);
  const content = readContent(row);
  const media = readMedia(projectId)?.media ?? null;
  if (reviewed && !media) throw new Error("select the audio before reviewing lines");
  const lineShas = new Map(content.lyrics.map((line) => [line.id, lineHash(line)]));
  transaction(() => {
    for (const lineId of lineIds) {
      const mark = get<{ start_ms: number | null }>("SELECT start_ms FROM lyric_marks WHERE project_id = ? AND line_id = ?", [
        projectId,
        lineId,
      ]);
      if (!mark || mark.start_ms === null) {
        if (reviewed) throw new Error(`line "${lineId}" has no start time yet`);
        continue;
      }
      if (reviewed && media) {
        run(
          "UPDATE lyric_marks SET reviewed_audio_sha = ?, reviewed_line_sha = ? WHERE project_id = ? AND line_id = ?",
          [media.audioSha256, lineShas.get(lineId) ?? "", projectId, lineId],
        );
      } else {
        run("UPDATE lyric_marks SET reviewed_audio_sha = NULL, reviewed_line_sha = NULL WHERE project_id = ? AND line_id = ?", [
          projectId,
          lineId,
        ]);
        invalidateApproval(projectId, "timeline review reset");
      }
    }
    run("UPDATE projects SET updated_at = ? WHERE project_id = ?", [nowIso(), projectId]);
  });
  refreshState(projectId);
  return getProjectDetail(projectId);
}

export function approveProject(projectId: string, approver: string, note: string): ProjectDetail {
  const report = preflight(projectId);
  const blocking = report.gates.filter((gate) => !gate.ok);
  if (blocking.length) {
    throw new Error(`approval blocked: ${blocking.map((gate) => `${gate.labelEn} (${gate.detail})`).join("; ")}`);
  }
  if (!approver.trim()) throw new Error("approver name is required");
  const row = loadProject(projectId);
  const content = readContent(row);
  const marks = readMarks(projectId);
  const media = readMedia(projectId)?.media ?? null;
  const rights = readRights(row);
  const revisionId = `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshot = {
    revisionId,
    projectId,
    songId: row.song_id,
    approvedAt: nowIso(),
    approver,
    note,
    content,
    marks,
    media,
    rights,
  };
  const snapshotBytes = Buffer.from(JSON.stringify(snapshot, null, 2), "utf8");
  const snapshotPath = path.join(revisionsDir(), `${revisionId}.json`);
  writeFileAtomic(snapshotPath, snapshotBytes, 0o444);
  const snapshotSha = sha256Hex(snapshotBytes);
  const timestamp = nowIso();

  transaction(() => {
    run(
      `INSERT INTO revisions(revision_id, project_id, song_id, snapshot_path, snapshot_sha256, media_sha256, timeline_sha256,
        content_hash, status, imported_at, approved_at, approver, rights_checklist_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
      [
        revisionId,
        projectId,
        row.song_id,
        snapshotPath,
        snapshotSha,
        media?.audioSha256 ?? null,
        report.timelineHash,
        report.contentHash,
        timestamp,
        timestamp,
        approver,
        rights.evidenceRef,
      ],
    );
    run("UPDATE projects SET approved_at = ?, approved_by = ?, updated_at = ? WHERE project_id = ?", [
      timestamp,
      approver,
      timestamp,
      projectId,
    ]);
    run("UPDATE projects SET state = 'approved' WHERE project_id = ?", [projectId]);
    audit(projectId, "approved", approver, { revisionId, note, contentHash: report.contentHash, timelineHash: report.timelineHash });
  });
  flushNow();
  return getProjectDetail(projectId);
}

export function revokeApproval(projectId: string, actor: string): ProjectDetail {
  loadProject(projectId);
  transaction(() => {
    run("UPDATE projects SET approved_at = NULL, approved_by = NULL, updated_at = ? WHERE project_id = ?", [nowIso(), projectId]);
    audit(projectId, "approval-revoked", actor, {});
  });
  refreshState(projectId);
  return getProjectDetail(projectId);
}

export function removeProject(projectId: string): void {
  const row = loadProject(projectId);
  const exportsForProject = scalar<number>("SELECT COUNT(*) FROM exports WHERE project_id = ?", [projectId]) ?? 0;
  if (Number(exportsForProject) > 0) {
    throw new Error("this project already produced exports; archive the project instead of deleting it");
  }
  transaction(() => {
    run("DELETE FROM lyric_marks WHERE project_id = ?", [projectId]);
    run("DELETE FROM project_media WHERE project_id = ?", [projectId]);
    run("DELETE FROM revisions WHERE project_id = ?", [projectId]);
    run("DELETE FROM projects WHERE project_id = ?", [projectId]);
    audit(projectId, "project-deleted", "operator", { songId: row.song_id });
  });
  try {
    fs.rmSync(projectDir(projectId), { recursive: true, force: true });
  } catch {
    /* the database record is gone; stale files are harmless */
  }
  const remaining = scalar<number>("SELECT COUNT(*) FROM projects WHERE song_id = ?", [row.song_id]) ?? 0;
  if (Number(remaining) === 0) run("DELETE FROM songs WHERE song_id = ?", [row.song_id]);
  flushNow();
}

export function latestRevision(projectId: string) {
  return get<{ revision_id: string; snapshot_path: string; content_hash: string; timeline_sha256: string; media_sha256: string | null }>(
    "SELECT revision_id, snapshot_path, content_hash, timeline_sha256, media_sha256 FROM revisions WHERE project_id = ? ORDER BY imported_at DESC LIMIT 1",
    [projectId],
  );
}

export function buildLessonForExport(projectId: string): { lesson: Lesson; media: MediaInfo; content: DraftContent } {
  const row = loadProject(projectId);
  const content = readContent(row);
  const media = readMedia(projectId)?.media ?? null;
  if (!media) throw new Error("select audio from the system before exporting");
  const marks = readMarks(projectId);
  const lesson = assembleLesson({ content, marks, media, rights: readRights(row) });
  const structural = validateLessonStructure(lesson);
  if (structural.length) {
    throw new Error(
      `lesson.json failed schema validation: ${structural
        .map((issue) => `${issue.path} ${issue.message}`)
        .slice(0, 5)
        .join("; ")}`,
    );
  }
  return { lesson, media, content };
}

export function readPayload(exportId: string): unknown {
  const row = get<{ payload_json: string }>("SELECT payload_json FROM exports WHERE export_id = ?", [exportId]);
  if (!row) throw new Error("export not found");
  return JSON.parse(row.payload_json);
}

export function exportRow(exportId: string) {
  return get<ExportRow>("SELECT * FROM exports WHERE export_id = ?", [exportId]);
}

export { parseRowList };
