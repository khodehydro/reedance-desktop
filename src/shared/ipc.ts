/** IPC channel names shared by main + preload. */
export const CH = {
  appInfo: "app:info",
  appRescan: "app:rescan",
  appOpenExternal: "app:open-external",
  appShowItem: "app:show-item",
  appSaveText: "app:save-text",
  appLibraryChanged: "app:library-changed",
  appCommand: "app:command",

  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsPickFolder: "settings:pick-folder",

  libraryList: "library:list",

  projectImport: "project:import",
  projectCreate: "project:create",
  projectGet: "project:get",
  projectSaveContent: "project:save-content",
  projectSaveRights: "project:save-rights",
  projectRemove: "project:remove",

  mediaSelectAudio: "media:select-audio",
  mediaSelectCover: "media:select-cover",
  mediaRemoveCover: "media:remove-cover",
  mediaReportDuration: "media:report-duration",
  mediaPlayUrl: "media:play-url",
  mediaBytes: "media:bytes",

  marksSave: "marks:save",
  marksSetReviewed: "marks:set-reviewed",
  marksDistribute: "marks:distribute",

  reviewApprove: "review:approve",
  reviewRevoke: "review:revoke",

  exportPreflight: "export:preflight",
  exportQuick: "export:quick",
  exportRun: "export:run",
  exportVerify: "export:verify",
  exportStage: "export:stage",
  exportPublish: "export:publish",
  exportOpenFolder: "export:open-folder",

  keysList: "keys:list",
  keysGenerateTest: "keys:generate-test",
  keysImport: "keys:import",
  keysBackup: "keys:backup",
  keysInfo: "keys:info",

  statsGet: "stats:get",
  statsSave: "stats:save",
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];
