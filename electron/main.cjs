// Noctua desktop shell. A real window, a tray icon, Windows notifications, and the monitor keeps
// running in the background when the window is closed. All the checking code is the same as before.
const { app, BrowserWindow, Tray, Menu, Notification, shell, nativeImage, dialog, screen, ipcMain } = require("electron");
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

const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), "utf8")); } catch { return {}; } };
const writePrefs = (p) => { try { fs.writeFileSync(prefsFile(), JSON.stringify(p)); } catch { /* ignore */ } };

// The intro: a full-screen, transparent, click-through-to-skip overlay. There is no window frame at all: the dark
// swallows the real desktop and the owl's light shows parts of it again. It lasts about 8 seconds; click or press
// any key to skip. The app window is shown at the "reveal" moment, while the dark is still lifting.
function playIntro() {
  return new Promise((resolve) => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), b = d.bounds;
    const w = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: "#00000000",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" } });
    w.setAlwaysOnTop(true, "screen-saver");
    let over = false, early = false;
    const reveal = () => { if (!early) { early = true; resolve(); } };
    const end = () => { if (over) return; over = true; clearTimeout(guard); try { w.destroy(); } catch { /* ignore */ } reveal(); };
    const guard = setTimeout(end, 12000); // never let the intro hold the app up
    const quiet = process.env.NOCTUA_QUIET === "1" || readPrefs().introSound === false;
    w.once("ready-to-show", () => { w.show(); w.focus(); });
    w.webContents.on("page-title-updated", (_e, title) => { if (title === "reveal") reveal(); else if (title === "done") end(); });
    w.on("closed", end);
    w.loadFile(path.join(__dirname, "splash.html"), { query: { lang: ar() ? "ar" : "en", mute: quiet ? "1" : "0" } }).catch(end);
  });
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
  const intro = !hidden && readPrefs().intro !== false ? playIntro() : Promise.resolve();
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
  await intro; // the window appears when the intro ends (it plays while Noctua starts)
  if (!hidden) showWindow();
  setupUpdates();
}

// ---- Updates: Noctua checks at start-up (and every 6 hours). When there is a new version it asks, in its own window, before downloading. ----
function setupUpdates() {
  if (!app.isPackaged || process.env.NOCTUA_NO_UPDATE) return; // only the installed program updates itself
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = false; // it asks first: the themed window below
  autoUpdater.autoInstallOnAppQuit = true;
  // Everything the updater does is written to updater.log, so a problem can be seen instead of guessed.
  const logFile = path.join(app.getPath("userData"), "updater.log");
  const log = (lvl, m) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${lvl} ${String(m && m.stack || m)}\n`); } catch { /* ignore */ } };
  try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200000) fs.writeFileSync(logFile, ""); } catch { /* ignore */ }
  autoUpdater.logger = { info: (m) => log("INFO", m), warn: (m) => log("WARN", m), error: (m) => log("ERROR", m), debug: () => {} };
  log("INFO", `Noctua ${app.getVersion()} started; will check for updates`);
  let manual = false;
  const tell = (body) => { if (manual && Notification.isSupported()) new Notification({ title: "Noctua", body, icon: path.join(ROOT, "build", "icon.png") }).show(); };
  const set = (status, version) => { updateState = { status, version: version || updateState.version }; refreshTray(); };
  autoUpdater.on("checking-for-update", () => set("checking"));
  autoUpdater.on("update-not-available", () => { set("none"); tell(T("نوكتوا محدّث، دي أحدث نسخة.", "Noctua is up to date.")); manual = false; });
  let dismissed = "", prompt = null, view = "available";
  const sendState = (extra = {}) => { try { if (prompt && !prompt.isDestroyed()) prompt.webContents.send("noctua-state", { view, version: updateState.version, ...extra }); } catch { /* ignore */ } };
  const openPrompt = (v) => {
    view = v || view;
    if (prompt && !prompt.isDestroyed()) { prompt.show(); prompt.focus(); sendState(); return; }
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, w = 560, h = 300;
    prompt = new BrowserWindow({ width: w, height: h, x: Math.round(d.x + (d.width - w) / 2), y: Math.round(d.y + (d.height - h) / 2), frame: false, resizable: false, minimizable: false, maximizable: false,
      alwaysOnTop: true, show: false, backgroundColor: "#000000", icon: path.join(ROOT, "build", "icon.png"),
      webPreferences: { preload: path.join(__dirname, "update-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    prompt.once("ready-to-show", () => { prompt.show(); prompt.focus(); });
    prompt.on("closed", () => { prompt = null; });
    prompt.loadFile(path.join(__dirname, "update.html"), { query: { lang: ar() ? "ar" : "en", v: updateState.version || "", view } }).catch(() => {});
  };
  const closePrompt = () => { try { if (prompt && !prompt.isDestroyed()) prompt.close(); } catch { /* ignore */ } };
  ipcMain.on("noctua-update", (e, name) => {
    if (!prompt || e.sender !== prompt.webContents) return; // only our own update window may ask
    if (name === "download") { view = "downloading"; set("downloading"); sendState({ percent: 0 }); log("INFO", "user accepted: downloading"); autoUpdater.downloadUpdate().catch((er) => { log("ERROR", er); view = "error"; set("error"); sendState({ error: String(er && er.message || er).slice(0, 160) }); }); }
    else if (name === "install") { log("INFO", "user accepted: installing"); installUpdate(); }
    else if (name === "later") { if (updateState.status === "available") dismissed = updateState.version; closePrompt(); }
    else closePrompt();
  });
  autoUpdater.on("download-progress", (pr) => sendState({ percent: Math.round(pr.percent || 0) }));
  autoUpdater.on("update-available", (i) => {
    set("available", i.version); log("INFO", `update available: ${i.version}`);
    if (!manual && dismissed === i.version) return; // said "later" already: the tray still shows it, no nagging
    if (hidden && !manual) { // started silently at login: do not pop a window, just tell
      if (Notification.isSupported()) { const n = new Notification({ title: "Noctua", body: T(`البومة لقت نسخة جديدة ${i.version}. دوس هنا.`, `The owl found version ${i.version}. Click here.`), icon: path.join(ROOT, "build", "icon.png") }); n.on("click", () => openPrompt("available")); n.show(); }
      return;
    }
    openPrompt("available"); manual = false;
  });
  autoUpdater.on("error", (e) => { updateState.error = String(e && e.message || e).slice(0, 200); set("error"); tell(T("تعذّر فحص التحديث: ", "Could not check for updates: ") + updateState.error); manual = false; if (view === "downloading") { view = "error"; sendState({ error: updateState.error }); } });
  autoUpdater.on("update-downloaded", (i) => {
    set("ready", i.version); view = "ready"; log("INFO", `downloaded: ${i.version}`);
    if (prompt && !prompt.isDestroyed()) { sendState(); prompt.show(); prompt.focus(); return; }
    openPrompt("ready");
  });
  global.__prompt = () => openPrompt(updateState.status === "ready" ? "ready" : "available");
  global.__check = (byHand) => { manual = byHand === true; return autoUpdater.checkForUpdates().catch((e) => { log("ERROR", e); set("error"); }); };
  global.__install = () => { quitting = true; try { if (server) server.close(); } catch { /* ignore */ } autoUpdater.quitAndInstall(false, true); };
  setTimeout(global.__check, 1500); // check right at start-up
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
    if (st === "ready") return { label: T(`تثبيت التحديث ${v} وإعادة التشغيل`, `Install update ${v} and restart`), click: () => global.__prompt && global.__prompt() };
    if (st === "available") return { label: T(`في تحديث ${v}، دوس للتنزيل`, `Update ${v} available, click to download`), click: () => global.__prompt && global.__prompt() };
    if (st === "downloading") return { label: T(`بنزّل التحديث ${v}…`, `Downloading update ${v}…`), enabled: false };
    if (st === "checking") return { label: T("بدوّر على تحديث…", "Checking for updates…"), enabled: false };
    if (st === "error") return { label: T("تعذّر فحص التحديث، جرّب تاني", "Update check failed, try again"), click: () => global.__check && global.__check(true) };
    return { label: st === "none" ? T("النسخة دي هي الأحدث", "You are up to date") + " (" + app.getVersion() + ")" : T("دوّر على تحديث", "Check for updates"), enabled: st !== "none" || true, click: () => global.__check && global.__check(true) };
  };
  const build = () => Menu.buildFromTemplate([
    { label: "Noctua " + app.getVersion(), enabled: false },
    { label: T("فتح نوكتوا", "Open Noctua"), click: showWindow },
    updItem(),
    { type: "separator" },
    { label: T("تشغيل مع ويندوز", "Start with Windows"), type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (m) => { app.setLoginItemSettings({ openAtLogin: m.checked, args: ["--hidden"] }); } },
    { label: T("عرض المقدمة عند التشغيل", "Play the intro at start"), type: "checkbox", checked: readPrefs().intro !== false,
      click: (m) => writePrefs({ ...readPrefs(), intro: m.checked }) },
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
