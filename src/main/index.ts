import path from "node:path";
import { BrowserWindow, Menu, app, dialog, nativeImage, session, shell } from "electron";
import { CH } from "../shared/ipc";
import { closeDatabase, flushNow, openDatabase } from "./db";
import { registerIpc } from "./ipc";
import { ensureStudioKeys } from "./keys";
import { ensureDirs } from "./paths";
import { registerMediaProtocol, registerMediaScheme } from "./protocol";

const isDev = process.env.REEDANCE_DEV === "1";
const isSmokeTest = process.argv.includes("--smoke-test");

// A single instance keeps one SQLite writer and one archive scanner.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

registerMediaScheme();

function sendCommand(command: "import-draft" | "new-project" | "open-settings" | "open-stats"): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CH.appCommand, command);
  }
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Import draft…", accelerator: "CmdOrCtrl+O", click: () => sendCommand("import-draft") },
        { label: "New project…", accelerator: "CmdOrCtrl+N", click: () => sendCommand("new-project") },
        { type: "separator" },
        { label: "Statistics", accelerator: "CmdOrCtrl+Shift+S", click: () => sendCommand("open-stats") },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendCommand("open-settings") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        ...(isDev ? ([{ role: "toggleDevTools" }] as Electron.MenuItemConstructorOptions[]) : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Contract & help",
          click: () => {
            void shell.openExternal("https://github.com/khodehydro/reedance/blob/main/docs/architecture/WINDOWS_AGENT.md");
          },
        },
        {
          label: "About Reedance Studio",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: "Reedance Studio",
              message: `Reedance Studio ${app.getVersion()}`,
              detail:
                "Content studio for the Reedance learning platform.\nImport an AI-authored .rddraft.json, select the song audio from this computer, sync every lyric line on the waveform timeline, review, and export an encrypted .rdpack plus a signed latest.json.\n\nDeveloped with ❤️ by HYDRO team",
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), "build", "icon.png");
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: "#08111f",
    title: "Reedance Studio",
    icon: nativeImage.createFromPath(iconPath),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      spellcheck: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.REEDANCE_DEV_URL;
    if (isDev && devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  const devUrl = process.env.REEDANCE_DEV_URL;
  if (isDev && devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  if (isSmokeTest) {
    window.webContents.once("did-finish-load", () => {
      console.log("SMOKE_OK: renderer loaded");
      setTimeout(() => app.quit(), 1500);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error("SMOKE_FAIL: renderer gone", details.reason);
      app.exit(1);
    });
  }

  return window;
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (isDev && process.env.REEDANCE_DEV_URL && url.startsWith(process.env.REEDANCE_DEV_URL)) return;
    if (url.startsWith("file://") || url.startsWith("rdmedia://")) return;
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
});

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

app.whenReady().then(async () => {
  try {
    ensureDirs();
    await openDatabase();
    // Keys are provisioned by the app itself: exporting must never ask the
    // operator to create or pick key material.
    try {
      ensureStudioKeys();
    } catch (error) {
      console.error("could not provision the studio keys", error);
    }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerMediaProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    if (isSmokeTest) {
      console.log("SMOKE_DB_OK");
    }
  } catch (error) {
    console.error("failed to start the studio", error);
    dialog.showErrorBox(
      "Reedance Studio could not start",
      `${error instanceof Error ? error.message : String(error)}\n\nThe local studio database could not be opened.`,
    );
    app.exit(1);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    flushNow();
  } catch (error) {
    console.error("failed to flush database at quit", error);
  }
});

app.on("will-quit", () => {
  try {
    closeDatabase();
  } catch (error) {
    console.error("failed to close database", error);
  }
});
