// Noctua desktop shell. A real window, a tray icon, Windows notifications, and the monitor keeps
// running in the background when the window is closed. All the checking code is the same as before.
const { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const hidden = process.argv.includes("--hidden");
let win = null, tray = null, server = null, quitting = false, lastNotify = 0;
let updateState = { status: "idle", version: null }; // idle | checking | downloading | ready | none | error

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(boot).catch((e) => { dialog.showErrorBox("Noctua", String(e && e.stack || e)); app.exit(1); });
}

const ar = () => /^ar/i.test(app.getLocale());
const T = (a, e) => (ar() ? a : e);

function migrateOldInstall(dataDir) {
  // Update from the old Install.bat version: keep the person's sites, history and settings.
  try {
    const old = path.join(process.env.LOCALAPPDATA || "", "Noctua");
    if (!process.env.LOCALAPPDATA || !fs.existsSync(old) || fs.existsSync(path.join(app.getPath("userData"), ".migrated"))) return;
    const cp = (a, b) => { if (fs.existsSync(a) && !fs.existsSync(b)) fs.cpSync(a, b, { recursive: true }); };
    cp(path.join(old, "data"), dataDir);
    cp(path.join(old, "settings.json"), path.join(app.getPath("userData"), "settings.json"));
    cp(path.join(old, "reports"), path.join(app.getPath("userData"), "reports"));
    fs.writeFileSync(path.join(app.getPath("userData"), ".migrated"), "1");
  } catch { /* never block start-up on a migration problem */ }
}

async function boot() {
  Menu.setApplicationMenu(null);
  const ud = app.getPath("userData");
  const dataDir = process.env.NOCTUA_DATA || path.join(ud, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!process.env.NOCTUA_DATA) migrateOldInstall(dataDir);
  const { startApp } = await import(pathToFileURL(path.join(ROOT, "app.mjs")).href);
  server = await startApp({
    open: false, autoExit: false,
    dataDir,
    reportsDir: path.join(ud, "reports"),
    settingsFile: path.join(ud, "settings.json"),
    onMonitorEvent: onMonitorEvent,
    onQuit: () => quit(),
  });
  makeTray();
  if (!hidden) showWindow();
  setupUpdates();
}

// ---- Updates: Noctua checks for a new version by itself, downloads it quietly, and installs it when you restart. ----
function setupUpdates() {
  if (!app.isPackaged || process.env.NOCTUA_NO_UPDATE) return; // only the installed program updates itself
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const set = (status, version) => { updateState = { status, version: version || updateState.version }; refreshTray(); };
  autoUpdater.on("checking-for-update", () => set("checking"));
  autoUpdater.on("update-not-available", () => set("none"));
  autoUpdater.on("update-available", (i) => set("downloading", i.version));
  autoUpdater.on("error", () => set("error")); // offline or no release yet: stay quiet, try again later
  autoUpdater.on("update-downloaded", (i) => {
    set("ready", i.version);
    if (Notification.isSupported()) {
      const n = new Notification({ title: "Noctua", body: T(`نسخة جديدة (${i.version}) جاهزة. دوس هنا عشان تتثبّت.`, `Version ${i.version} is ready. Click to install it.`), icon: path.join(ROOT, "build", "icon.png") });
      n.on("click", installUpdate); n.show();
    }
  });
  global.__check = () => autoUpdater.checkForUpdates().catch(() => set("error"));
  global.__install = () => { quitting = true; try { if (server) server.close(); } catch { /* ignore */ } autoUpdater.quitAndInstall(false, true); };
  setTimeout(global.__check, 15000);
  setInterval(global.__check, 6 * 3600 * 1000);
}
const installUpdate = () => global.__install && global.__install();

function showWindow() {
  if (!server) return;
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1180, height: 900, minWidth: 380, minHeight: 560, title: "Noctua", show: false,
    backgroundColor: "#0b0b0c", autoHideMenuBar: true,
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(server.url);
  // Links: our own pages (reports) open in a small window of ours (they need our cookie); the web opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(server.url.replace(/\/$/, ""))) return { action: "allow", overrideBrowserWindowOptions: { width: 1100, height: 850, autoHideMenuBar: true, backgroundColor: "#0b0b0c" } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(server.url.replace(/\/$/, ""))) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  // Closing the window does not stop the monitoring: it goes to the tray.
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function makeTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(__dirname, "tray@2x.png")) });
  tray = new Tray(img);
  tray.setToolTip(T("نوكتوا: المراقبة شغالة", "Noctua: monitoring is running"));
  const updItem = () => {
    const v = updateState.version, st = updateState.status;
    if (st === "ready") return { label: T(`تثبيت التحديث ${v} وإعادة التشغيل`, `Install update ${v} and restart`), click: installUpdate };
    if (st === "downloading") return { label: T(`بنزّل التحديث ${v}…`, `Downloading update ${v}…`), enabled: false };
    if (st === "checking") return { label: T("بدوّر على تحديث…", "Checking for updates…"), enabled: false };
    return { label: st === "none" ? T("النسخة دي هي الأحدث", "You are up to date") + " (" + app.getVersion() + ")" : T("دوّر على تحديث", "Check for updates"), enabled: st !== "none" || true, click: () => global.__check && global.__check() };
  };
  const build = () => Menu.buildFromTemplate([
    { label: T("فتح نوكتوا", "Open Noctua"), click: showWindow },
    updItem(),
    { type: "separator" },
    { label: T("تشغيل مع ويندوز", "Start with Windows"), type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (m) => { app.setLoginItemSettings({ openAtLogin: m.checked, args: ["--hidden"] }); } },
    { type: "separator" },
    { label: T("خروج (إيقاف المراقبة)", "Quit (stop monitoring)"), click: () => quit() },
  ]);
  tray.setContextMenu(build());
  tray.on("click", showWindow);
  tray.on("right-click", () => tray.setContextMenu(build()));
  refreshTray = () => { try { tray.setContextMenu(build()); } catch { /* ignore */ } };
}
let refreshTray = () => {};

function onMonitorEvent(ev) {
  if (ev.type !== "alert" || !Notification.isSupported()) return;
  if (Date.now() - lastNotify < 1500) return; // several alerts at once: don't flood
  lastNotify = Date.now();
  const n = new Notification({ title: "Noctua", body: String(ev.text || "").slice(0, 240), icon: path.join(ROOT, "build", "icon.png") });
  n.on("click", showWindow);
  n.show();
}

function quit() {
  quitting = true;
  try { if (server) server.close(); } catch { /* ignore */ }
  try { if (tray) tray.destroy(); } catch { /* ignore */ }
  app.exit(0);
}
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* stay alive in the tray */ });
