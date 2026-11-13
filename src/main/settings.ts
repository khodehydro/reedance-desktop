import fs from "node:fs";
import type { Settings } from "../shared/types";
import { getSetting, setSetting } from "./db";
import { defaultArchiveDir } from "./paths";

const DEFAULT_SETTINGS: Settings = {
  archiveDir: "",
  lang: "fa",
  theme: "dark",
  reducedMotion: false,
  allowTestKeys: false,
  defaultManifestBaseUrl: "",
  complianceAckAt: undefined,
  lastProjectId: undefined,
};

export function getSettings(): Settings {
  const raw = getSetting("studio.settings");
  const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed };
  if (!merged.archiveDir) merged.archiveDir = defaultArchiveDir();
  return merged;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next: Settings = { ...current, ...patch };
  if (next.archiveDir) {
    fs.mkdirSync(next.archiveDir, { recursive: true });
  }
  if (next.lang !== "fa" && next.lang !== "en") next.lang = "fa";
  if (next.theme !== "dark" && next.theme !== "light" && next.theme !== "system") next.theme = "dark";
  setSetting("studio.settings", JSON.stringify(next));
  return next;
}

export { DEFAULT_SETTINGS };
