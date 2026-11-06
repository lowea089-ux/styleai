// Electron entry for the Windows desktop app. Runs the regular StyleAI server on a random loopback port
// and shows it in an app window. Data lives in %APPDATA%/StyleAI/data.
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import { loadConfig } from "../server/config";
import { startServer } from "../server/main";

let win: BrowserWindow | null = null;
let server: { port: number; close: () => void } | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(boot).catch(fail);
}

function fail(e: unknown) {
  dialog.showErrorBox("StyleAI konnte nicht starten", e instanceof Error ? e.message : String(e));
  app.quit();
}

async function boot() {
  process.env.STYLEAI_DESKTOP = "1";
  process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.CLIENT_DIR = path.join(app.getAppPath(), "dist");
  process.env.API_PORT = "0"; // any free port
  server = await startServer(loadConfig());
  const origin = `http://127.0.0.1:${server.port}`;

  // Granted: geolocation (local weather) and the camera without microphone (live try-on; frames are
  // processed in the window and never leave the device). Everything else is denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === "geolocation") return cb(true);
    if (permission === "media") {
      const types = (details as Electron.MediaAccessPermissionRequest).mediaTypes ?? [];
      return cb(types.length > 0 && types.every((t) => t === "video"));
    }
    cb(false);
  });
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: "StyleAI",
    backgroundColor: "#11100e",
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // External links (trend sources, API key pages) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.on("closed", () => (win = null));
  await win.loadURL(`${origin}/`);
}

app.on("window-all-closed", () => {
  server?.close();
  app.quit();
});
