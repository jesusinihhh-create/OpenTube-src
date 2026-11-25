const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("path"), fs = require("fs");

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "app-config.json"), "utf8")); } catch (e) {}
const SITE = process.env.OPENTUBE_URL || cfg.siteUrl || "";

if (!app.requestSingleInstanceLock()) app.quit();
let win;
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const openOutside = (u) => { try { const p = new URL(u); if (p.protocol === "https:" || p.protocol === "http:") shell.openExternal(u); } catch (e) {} };

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 420, minHeight: 600, backgroundColor: "#141414", title: "OpenTube",
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const origin = SITE ? new URL(SITE).origin : "";
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file://")) return;
    let o = ""; try { o = new URL(url).origin; } catch (x) {}
    if (o !== origin) { e.preventDefault(); openOutside(url); }
  });
  win.webContents.on("did-fail-load", (_e, code, _d, _u, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { url: SITE } });
  });
  if (SITE) win.loadURL(SITE); else win.loadFile(path.join(__dirname, "offline.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(["notifications", "fullscreen", "clipboard-sanitized-write"].includes(perm)));
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
