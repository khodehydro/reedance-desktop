import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import type {
  AppInfo,
  DraftContent,
  RightsChecklist,
  Settings,
  StatsScope,
  TargetLanguage,
} from "../shared/types";
import { SUPPORTED_LANGUAGES, isTargetLanguage } from "../shared/types";
import { CH } from "../shared/ipc";
import { all, audit, flushNow } from "./db";
import { rescanArchive, stageExport } from "./archive";
import { runExport, runQuickExport, verifyExportReport } from "./exporter";
import { createEmptyDraft, importDraftFile } from "./import";
import { ensureStudioKeys } from "./keys";
import { importAudio, importCover, importStoryAudio, reconcileDecodedDuration } from "./media";
import { publishExport } from "./publication";
import {
  approveProject,
  getProjectDetail,
  listLibrary,
  loadProject,
  readProjectContent,
  readMarks,
  readMedia,
  removeProject,
  revokeApproval,
  saveContent,
  distributeMarks,
  saveMarks,
  saveRights,
  saveMedia,
  setReviewed,
} from "./projects";
import { getSettings, updateSettings } from "./settings";
import { computeStats, statsJson, statsToCsv } from "./stats";
import { ensureDirs } from "./paths";

const DRAFT_MAX = 4 * 1024 * 1024;

function str(value: unknown, name: string, max = 4000): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.length > max) throw new Error(`${name} is too long`);
  return value;
}

function id(value: unknown, name = "id"): string {
  const text = str(value, name, 200);
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${name} has invalid characters`);
  return text;
}

function num(value: unknown, name: string, min = -1, max = 86_400_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} is out of range`);
  }
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function obj(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function notifyChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CH.appLibraryChanged);
  }
}

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

/**
 * Speak `text` with the OS voice through Chromium's speech synthesis, which
 * is available as a global in the Electron main process. The voice list is
 * loaded asynchronously, so an exact language match is tried first and the
 * default voice is used as a fallback.
 */
function speak(text: string, lang: string): boolean {
  try {
    speechSynthesis.cancel();
    const wanted = lang.toLowerCase();
    const voices = speechSynthesis.getVoices();
    const match =
      voices.find((voice) => voice.lang.toLowerCase().startsWith(wanted)) ??
      voices.find((voice) => wanted.startsWith(voice.lang.toLowerCase())) ??
      null;
    const utterance = new SpeechSynthesisUtterance(text);
    if (match) utterance.voice = match;
    utterance.lang = lang;
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

async function pickFile(filters: Electron.FileFilter[], title: string): Promise<string | null> {
  const parent = mainWindow();
  const result = parent
    ? await dialog.showOpenDialog(parent, { title, filters, properties: ["openFile"] })
    : await dialog.showOpenDialog({ title, filters, properties: ["openFile"] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

async function pickFolder(title: string): Promise<string | null> {
  const parent = mainWindow();
  const result = parent
    ? await dialog.showOpenDialog(parent, { title, properties: ["openDirectory", "createDirectory"] })
    : await dialog.showOpenDialog({ title, properties: ["openDirectory", "createDirectory"] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

async function saveTextFile(options: { defaultName: string; contents: string; filters?: Electron.FileFilter[] }): Promise<string | null> {
  const parent = mainWindow();
  const result = parent
    ? await dialog.showSaveDialog(parent, { defaultPath: options.defaultName, filters: options.filters })
    : await dialog.showSaveDialog({ defaultPath: options.defaultName, filters: options.filters });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, options.contents, "utf8");
  return result.filePath;
}

export function registerIpc(): void {
  ensureDirs();

  ipcMain.handle(CH.appInfo, (): AppInfo => {
    const settings = getSettings();
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${os.release()}`,
      dataDir: app.getPath("userData"),
      archiveDir: settings.archiveDir,
      safeStorage: safeStorage.isEncryptionAvailable(),
    };
  });

  ipcMain.handle(CH.appRescan, (): ReturnType<typeof rescanArchive> => {
    const report = rescanArchive(getSettings().archiveDir);
    notifyChanged();
    return report;
  });

  ipcMain.handle(CH.appOpenExternal, async (_event, url: unknown) => {
    const target = str(url, "url", 2000);
    if (!/^https?:\/\//.test(target)) throw new Error("only http(s) links can be opened externally");
    await shell.openExternal(target);
  });

  ipcMain.handle(CH.appShowItem, (_event, target: unknown) => {
    const file = str(target, "path", 4000);
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(path.dirname(file));
  });

  ipcMain.handle(CH.appSaveText, (_event, options: unknown) => {
    const value = obj(options, "options");
    return saveTextFile({
      defaultName: str(value.defaultName, "defaultName", 300),
      contents: str(value.contents, "contents", 20 * 1024 * 1024),
      filters: Array.isArray(value.filters) ? (value.filters as Electron.FileFilter[]) : undefined,
    });
  });

  ipcMain.handle(CH.settingsGet, (): Settings => getSettings());
  ipcMain.handle(CH.settingsSet, (_event, patch: unknown): Settings => {
    const next = updateSettings(obj(patch, "settings") as Partial<Settings>);
    notifyChanged();
    return next;
  });

  ipcMain.handle(CH.settingsPickFolder, async (_event, title: unknown) => pickFolder(str(title, "title", 200)));

  ipcMain.handle(CH.libraryList, () => {
    const settings = getSettings();
    return listLibrary(settings.archiveDir, app.getPath("userData"));
  });

  ipcMain.handle(CH.projectImport, () => {
    return (async () => {
      const file = await pickFile([{ name: "Reedance draft", extensions: ["json"] }], "Import *.rddraft.json");
      if (!file) return null;
      const stat = fs.statSync(file);
      if (stat.size > DRAFT_MAX) throw new Error("draft is larger than 4 MiB");
      const outcome = importDraftFile(file);
      notifyChanged();
      return outcome;
    })();
  });

  ipcMain.handle(CH.projectCreate, (_event, input: unknown) => {
    const value = obj(input, "input");
    const language = str(value.targetLanguage, "targetLanguage", 2);
    if (!isTargetLanguage(language)) throw new Error(`targetLanguage must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`);
    if (!["A1", "A2", "B1", "B2", "C1", "C2"].includes(str(value.level, "level", 2))) {
      throw new Error("level must be A1..C2");
    }
    const outcome = createEmptyDraft({
      songId: str(value.songId, "songId", 80),
      title: str(value.title, "title", 300),
      artist: str(value.artist, "artist", 300),
      targetLanguage: language as TargetLanguage,
      locale: str(value.locale, "locale", 32),
      level: str(value.level, "level", 2) as "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
    });
    notifyChanged();
    return outcome;
  });

  ipcMain.handle(CH.projectGet, (_event, projectId: unknown) => getProjectDetail(id(projectId, "projectId")));

  ipcMain.handle(CH.projectSaveContent, (_event, projectId: unknown, content: unknown) => {
    const detail = saveContent(id(projectId, "projectId"), obj(content, "content") as unknown as DraftContent);
    notifyChanged();
    return detail;
  });

  ipcMain.handle(CH.projectSaveRights, (_event, projectId: unknown, rights: unknown) => {
    const detail = saveRights(id(projectId, "projectId"), obj(rights, "rights") as unknown as RightsChecklist);
    notifyChanged();
    return detail;
  });

  ipcMain.handle(CH.projectRemove, (_event, projectId: unknown) => {
    removeProject(id(projectId, "projectId"));
    notifyChanged();
  });

  ipcMain.handle(CH.mediaSelectAudio, async (_event, projectId: unknown) => {
    const project = id(projectId, "projectId");
    const file = await pickFile(
      [{ name: "Audio", extensions: ["mp3", "m4a", "wav"] }],
      "Select the song audio from this computer",
    );
    if (!file) return null;
    loadProject(project);
    const previous = readMedia(project)?.media ?? null;
    const { media, outcome } = importAudio(project, file, previous);
    saveMedia(project, media, true);
    audit(project, "audio-import", "operator", { file: path.basename(file) });
    flushNow();
    notifyChanged();
    return outcome;
  });

  ipcMain.handle(CH.mediaSelectCover, async (_event, projectId: unknown) => {
    const project = id(projectId, "projectId");
    const file = await pickFile(
      [{ name: "Cover image", extensions: ["jpg", "jpeg", "png", "webp"] }],
      "Select the cover art from this computer",
    );
    if (!file) return null;
    const media = readMedia(project)?.media;
    if (!media) throw new Error("select the audio before the cover");
    const updated = importCover(project, file, media);
    saveMedia(project, updated, false);
    notifyChanged();
    return { media: updated, warnings: [], durationSource: "container" as const };
  });

  ipcMain.handle(CH.mediaSelectStoryAudio, async (_event, projectId: unknown) => {
    const project = id(projectId, "projectId");
    const media = readMedia(project)?.media;
    if (!media) throw new Error("select the song audio before the story audio");
    const file = await pickFile(
      [{ name: "Story audio", extensions: ["mp3", "m4a", "wav"] }],
      "Select the story narration audio from this computer",
    );
    if (!file) return null;
    loadProject(project);
    const updated = importStoryAudio(project, file, media);
    saveMedia(project, updated, false);
    audit(project, "story-audio-import", "operator", { file: path.basename(file) });
    flushNow();
    notifyChanged();
    return { media: updated, warnings: [], durationSource: "container" as const };
  });

  ipcMain.handle(CH.mediaRemoveCover, (_event, projectId: unknown) => {
    const project = id(projectId, "projectId");
    const media = readMedia(project)?.media;
    if (!media) throw new Error("this project has no media yet");
    if (media.coverPath && fs.existsSync(media.coverPath)) fs.rmSync(media.coverPath, { force: true });
    const updated = { ...media, coverPath: undefined, coverSha256: undefined, coverMimeType: undefined, coverExtension: undefined, coverBytes: undefined };
    saveMedia(project, updated, false);
    notifyChanged();
    return { media: updated, warnings: [], durationSource: "container" as const };
  });

  ipcMain.handle(CH.mediaRemoveStoryAudio, (_event, projectId: unknown) => {
    const project = id(projectId, "projectId");
    const media = readMedia(project)?.media;
    if (!media) throw new Error("this project has no media yet");
    if (media.storyAudioPath && fs.existsSync(media.storyAudioPath)) fs.rmSync(media.storyAudioPath, { force: true });
    const updated = {
      ...media,
      storyAudioPath: undefined,
      storyAudioFileName: undefined,
      storyAudioSha256: undefined,
      storyAudioMimeType: undefined,
      storyAudioExtension: undefined,
      storyAudioDurationMs: undefined,
      storyAudioBytes: undefined,
    };
    saveMedia(project, updated, false);
    notifyChanged();
    return { media: updated, warnings: [], durationSource: "container" as const };
  });

  ipcMain.handle(CH.mediaReportDuration, (_event, projectId: unknown, durationMs: unknown, kind: unknown) => {
    const project = id(projectId, "projectId");
    const media = readMedia(project)?.media;
    if (!media) throw new Error("no audio selected");
    const which = kind === "story-audio" ? "story-audio" : "audio";
    // The decoder measurement wins over a wrong container header (see
    // reconcileDecodedDuration); within tolerance nothing changes.
    const updated = reconcileDecodedDuration(media, num(durationMs, "durationMs", 1), which);
    if (!updated) return { media, warnings: [], durationSource: "container" as const };
    saveMedia(project, updated, false);
    notifyChanged();
    return { media: updated, warnings: [], durationSource: "decoder" as const };
  });

  ipcMain.handle(CH.mediaPlayUrl, (_event, projectId: unknown, kind: unknown) => {
    const project = id(projectId, "projectId");
    const media = readMedia(project)?.media;
    if (!media) return null;
    if (kind === "cover") return media.coverPath ? `rdmedia://media/cover/${project}` : null;
    if (kind === "story-audio") return media.storyAudioPath ? `rdmedia://media/story-audio/${project}` : null;
    return `rdmedia://media/audio/${project}`;
  });

  ipcMain.handle(CH.mediaBytes, (_event, projectId: unknown, kind: unknown) => {
    const project = id(projectId, "projectId");
    const media = readMedia(project)?.media;
    if (!media) return null;
    if (kind === "cover") {
      if (!media.coverPath || !fs.existsSync(media.coverPath)) return null;
      const cover = fs.readFileSync(media.coverPath);
      return cover.buffer.slice(cover.byteOffset, cover.byteOffset + cover.byteLength);
    }
    if (kind === "story-audio") {
      if (!media.storyAudioPath || !fs.existsSync(media.storyAudioPath)) return null;
      const story = fs.readFileSync(media.storyAudioPath);
      return story.buffer.slice(story.byteOffset, story.byteOffset + story.byteLength);
    }
    const file = media.audioPath;
    if (!file || !fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (stat.size > 256 * 1024 * 1024) throw new Error("media file is too large for waveform analysis");
    const bytes = fs.readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });

  ipcMain.handle(CH.mediaSpeak, (_event, input: unknown): boolean => {
    const value = obj(input, "input");
    const text = str(value.text, "text", 20_000);
    const lang = str(value.lang, "lang", 32);
    if (!text.trim()) return false;
    return speak(text, lang);
  });

  ipcMain.handle(CH.marksSave, (_event, projectId: unknown, marks: unknown) => {
    const project = id(projectId, "projectId");
    if (!Array.isArray(marks)) throw new Error("marks must be an array");
    if (marks.length > 500) throw new Error("too many marks in one call");
    const patch = marks.map((raw) => {
      const value = obj(raw, "mark");
      const startMs = value.startMs === null ? null : num(value.startMs, "startMs", 0);
      const endMs = value.endMs === null || value.endMs === undefined ? null : num(value.endMs, "endMs", 0);
      return { lineId: id(value.lineId, "lineId"), startMs, endMs };
    });
    const content = readProjectContent(loadProject(project));
    saveMarks(project, patch, readMedia(project)?.media ?? null, content);
    notifyChanged();
    return getProjectDetail(project);
  });

  ipcMain.handle(CH.marksDistribute, (_event, projectId: unknown) => {
    const detail = distributeMarks(id(projectId, "projectId"));
    notifyChanged();
    return detail;
  });

  ipcMain.handle(CH.marksSetReviewed, (_event, projectId: unknown, lineIds: unknown, reviewed: unknown) => {
    const project = id(projectId, "projectId");
    if (!Array.isArray(lineIds) || lineIds.length > 500) throw new Error("lineIds must be an array");
    const detail = setReviewed(project, lineIds.map((value) => id(value, "lineId")), bool(reviewed, "reviewed"));
    notifyChanged();
    return detail;
  });

  ipcMain.handle(CH.reviewApprove, (_event, projectId: unknown, input: unknown) => {
    const project = id(projectId, "projectId");
    const value = obj(input, "approval");
    const detail = approveProject(project, str(value.approver, "approver", 120), str(value.note, "note", 2000));
    notifyChanged();
    return detail;
  });

  ipcMain.handle(CH.reviewRevoke, (_event, projectId: unknown) => {
    const detail = revokeApproval(id(projectId, "projectId"), "operator");
    notifyChanged();
    return detail;
  });

  ipcMain.handle(CH.exportPreflight, (_event, projectId: unknown) => {
    return getProjectDetail(id(projectId, "projectId")).preflight;
  });

  ipcMain.handle(CH.exportQuick, (_event, projectId: unknown, input: unknown) => {
    const project = id(projectId, "projectId");
    const raw = input === undefined || input === null ? {} : obj(input, "input");
    const outcome = runQuickExport(
      project,
      {
        displayVersion: raw.displayVersion === undefined ? undefined : str(raw.displayVersion, "displayVersion", 32),
        manifestBaseUrl: raw.manifestBaseUrl === undefined ? undefined : str(raw.manifestBaseUrl, "manifestBaseUrl", 300),
      },
      { archiveRoot: getSettings().archiveDir },
    );
    notifyChanged();
    return outcome;
  });

  ipcMain.handle(CH.exportRun, (_event, projectId: unknown, options: unknown) => {
    const project = id(projectId, "projectId");
    const value = obj(options, "options");
    const outcome = runExport(
      project,
      {
        encryptionKeyId: str(value.encryptionKeyId, "encryptionKeyId", 32),
        signatureKeyId: str(value.signatureKeyId, "signatureKeyId", 32),
        displayVersion: str(value.displayVersion, "displayVersion", 32),
        manifestBaseUrl: str(value.manifestBaseUrl, "manifestBaseUrl", 300),
      },
      { archiveRoot: getSettings().archiveDir },
    );
    notifyChanged();
    return outcome;
  });

  ipcMain.handle(CH.exportVerify, (_event, exportId: unknown) => verifyExportReport(id(exportId, "exportId")));

  ipcMain.handle(CH.exportStage, async (_event, exportId: unknown) => {
    const target = await pickFolder("Choose a folder that will host the pack and latest.json");
    if (!target) return null;
    const bundle = stageExport(id(exportId, "exportId"), target);
    notifyChanged();
    return bundle;
  });

  ipcMain.handle(CH.exportPublish, async (_event, exportId: unknown, manifestUrl: unknown) => {
    const outcome = await publishExport(id(exportId, "exportId"), str(manifestUrl, "manifestUrl", 2000));
    notifyChanged();
    return outcome;
  });

  ipcMain.handle(CH.exportOpenFolder, (_event, exportId: unknown) => {
    const rows = all<{ pack_path: string }>("SELECT pack_path FROM exports WHERE export_id = ?", [
      id(exportId, "exportId"),
    ]);
    const packPath = rows[0]?.pack_path;
    if (!packPath) throw new Error("export not found");
    if (fs.existsSync(packPath)) shell.showItemInFolder(packPath);
    else shell.openPath(path.dirname(packPath));
  });


  ipcMain.handle(CH.statsGet, (_event, scope: unknown) => {
    const value = obj(scope, "scope");
    const allowed = ["latest-published", "latest-exported", "drafts", "all-versions"];
    if (!allowed.includes(str(value.scope, "scope", 32))) throw new Error("unknown stats scope");
    const language = value.targetLanguage;
    const requestedLanguage = language === undefined ? "all" : str(language, "targetLanguage", 3);
    if (requestedLanguage !== "all" && !isTargetLanguage(requestedLanguage)) {
      throw new Error("unknown target language");
    }
    return computeStats({
      scope: str(value.scope, "scope", 32) as StatsScope["scope"],
      targetLanguage: requestedLanguage as StatsScope["targetLanguage"],
    });
  });

  ipcMain.handle(CH.statsSave, async (_event, scope: unknown, format: unknown) => {
    const value = obj(scope, "scope");
    const report = computeStats({
      scope: str(value.scope, "scope", 32) as StatsScope["scope"],
      targetLanguage: (value.targetLanguage as StatsScope["targetLanguage"]) ?? "all",
    });
    const kind = str(format, "format", 4);
    if (kind !== "csv" && kind !== "json") throw new Error("format must be csv or json");
    return saveTextFile({
      defaultName: `reedance-stats-${report.scope}-${report.generatedAt.slice(0, 10)}.${kind}`,
      contents: kind === "csv" ? statsToCsv(report) : statsJson(report),
      filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
    });
  });

}
