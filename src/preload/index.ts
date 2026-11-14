import { contextBridge, ipcRenderer } from "electron";
import type { StudioApi } from "../shared/types";
import { CH } from "../shared/ipc";

/**
 * The only bridge between the sandboxed renderer and the main process.
 *
 * It exposes a fixed, typed allowlist of operations — no `ipcRenderer`, no
 * `require`, no filesystem paths, no arbitrary channel names. Every payload is
 * re-validated inside the main process.
 */
const api: StudioApi = {
  app: {
    info: () => ipcRenderer.invoke(CH.appInfo),
    rescan: () => ipcRenderer.invoke(CH.appRescan),
    openExternal: (url) => ipcRenderer.invoke(CH.appOpenExternal, url),
    showItemInFolder: (target) => ipcRenderer.invoke(CH.appShowItem, target),
    saveTextFile: (options) => ipcRenderer.invoke(CH.appSaveText, options),
    onLibraryChanged: (callback) => {
      const listener = (): void => callback();
      ipcRenderer.on(CH.appLibraryChanged, listener);
      return () => ipcRenderer.removeListener(CH.appLibraryChanged, listener);
    },
    onCommand: (callback) => {
      const listener = (_event: unknown, command: string): void => callback(command as Parameters<typeof callback>[0]);
      ipcRenderer.on(CH.appCommand, listener);
      return () => ipcRenderer.removeListener(CH.appCommand, listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    set: (patch) => ipcRenderer.invoke(CH.settingsSet, patch),
    pickFolder: (title) => ipcRenderer.invoke(CH.settingsPickFolder, title),
  },
  library: {
    list: () => ipcRenderer.invoke(CH.libraryList),
  },
  projects: {
    importDraft: () => ipcRenderer.invoke(CH.projectImport),
    createEmpty: (input) => ipcRenderer.invoke(CH.projectCreate, input),
    get: (projectId) => ipcRenderer.invoke(CH.projectGet, projectId),
    saveContent: (projectId, content) => ipcRenderer.invoke(CH.projectSaveContent, projectId, content),
    saveRights: (projectId, rights) => ipcRenderer.invoke(CH.projectSaveRights, projectId, rights),
    remove: (projectId) => ipcRenderer.invoke(CH.projectRemove, projectId),
  },
  media: {
    selectAudio: (projectId) => ipcRenderer.invoke(CH.mediaSelectAudio, projectId),
    selectCover: (projectId) => ipcRenderer.invoke(CH.mediaSelectCover, projectId),
    removeCover: (projectId) => ipcRenderer.invoke(CH.mediaRemoveCover, projectId),
    reportDuration: (projectId, durationMs) => ipcRenderer.invoke(CH.mediaReportDuration, projectId, durationMs),
    playUrl: (projectId, kind) => ipcRenderer.invoke(CH.mediaPlayUrl, projectId, kind),
    bytes: (projectId, kind) => ipcRenderer.invoke(CH.mediaBytes, projectId, kind),
  },
  marks: {
    save: (projectId, marks) => ipcRenderer.invoke(CH.marksSave, projectId, marks),
    setReviewed: (projectId, lineIds, reviewed) => ipcRenderer.invoke(CH.marksSetReviewed, projectId, lineIds, reviewed),
    distribute: (projectId) => ipcRenderer.invoke(CH.marksDistribute, projectId),
  },
  review: {
    approve: (projectId, input) => ipcRenderer.invoke(CH.reviewApprove, projectId, input),
    revoke: (projectId) => ipcRenderer.invoke(CH.reviewRevoke, projectId),
  },
  exports: {
    preflight: (projectId) => ipcRenderer.invoke(CH.exportPreflight, projectId),
    quick: (projectId, input) => ipcRenderer.invoke(CH.exportQuick, projectId, input ?? {}),
    run: (projectId, options) => ipcRenderer.invoke(CH.exportRun, projectId, options),
    verify: (exportId) => ipcRenderer.invoke(CH.exportVerify, exportId),
    stage: (exportId) => ipcRenderer.invoke(CH.exportStage, exportId),
    publish: (exportId, manifestUrl) => ipcRenderer.invoke(CH.exportPublish, exportId, manifestUrl),
    openFolder: (exportId) => ipcRenderer.invoke(CH.exportOpenFolder, exportId),
  },
  keys: {
    list: () => ipcRenderer.invoke(CH.keysList),
    generateTest: () => ipcRenderer.invoke(CH.keysGenerateTest),
    importFromFile: () => ipcRenderer.invoke(CH.keysImport),
    backup: (passphrase) => ipcRenderer.invoke(CH.keysBackup, passphrase),
    password: () => ipcRenderer.invoke(CH.keysPassword),
    setPassword: (password) => ipcRenderer.invoke(CH.keysSetPassword, password),
    rotatePassword: () => ipcRenderer.invoke(CH.keysRotatePassword),
  },
  stats: {
    get: (scope) => ipcRenderer.invoke(CH.statsGet, scope),
    save: (scope, format) => ipcRenderer.invoke(CH.statsSave, scope, format),
  },
};

contextBridge.exposeInMainWorld("reedance", api);
