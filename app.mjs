#!/usr/bin/env node
// The app window. Starts a small server on THIS computer only (127.0.0.1), opens the window, runs the checker
// as a separate process and streams its progress to the page. Nothing here is reachable from the internet.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMonitor } from "./lib/monitor.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MARK = "@@MM@@";
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".png": "image/png", ".js": "text/javascript", ".css": "text/css" };

const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  else { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
}

function openWindow(url) {
  const p = process.platform;
  try {
    if (p === "win32") {
      const pf = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
      const cands = pf.flatMap((b) => [path.join(b, "Microsoft/Edge/Application/msedge.exe"), path.join(b, "Google/Chrome/Application/chrome.exe")]);
      const exe = cands.find((c) => fs.existsSync(c));
      if (exe) return spawn(exe, [`--app=${url}`, "--window-size=1120,880"], { detached: true, stdio: "ignore" }).unref();
      return spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    }
    spawn(p === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch { console.log("Open this address in your browser: " + url); }
}

export async function startApp({ port = 4777, open = true, autoExit = false, reportsDir = path.join(DIR, "reports"), settingsFile = path.join(DIR, "settings.json"), dataDir = path.join(DIR, "data"), monitorOn = true, onMonitorEvent = () => {}, onQuit = null } = {}) {
  const REPORTS = reportsDir, SETTINGS = settingsFile;
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; } };
  const writeSettings = (s) => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
  const secret = crypto.randomBytes(24).toString("hex");
  const run = { child: null, events: [], clients: new Set(), out: "", started: 0 };
  let lastPing = 0, seenClient = false;
  const mclients = new Set();
  const mpush = (ev) => { try { onMonitorEvent(ev); } catch { /* shell hook must never break monitoring */ } const line = `data: ${JSON.stringify(ev)}\n\n`; for (const c of mclients) c.write(line); };
  const monitor = createMonitor({ dir: dataDir, appDir: DIR, onEvent: mpush, busy: () => !!run.child });
  if (monitorOn) monitor.start();

  const push = (ev) => { run.events.push(ev); const line = `data: ${JSON.stringify(ev)}\n\n`; for (const c of run.clients) c.write(line); };

  function startRun(body) {
    const st = readSettings(), sec = st.secrets || {};
    const site = String(body.site || "").trim().replace(/\/+$/, "");
    const api = !!body.api, ui = !!body.ui, bench = !!body.bench;
    if (!api && !ui && !bench) return { error: "Pick at least one thing to test." };
    if ((api || ui) && !/^https?:\/\/[^\s/]+/i.test(site)) return { error: "The site address must start with https://" };
    const token = body.token || sec.token || "", groq = body.groqKey || sec.groqKey || "", gem = body.geminiKey || sec.geminiKey || "";
    if (!api && !ui && !groq && !gem) return { error: "Pick the site test, or enter a key for the direct test." };
    const models = String(body.models || "").trim();
    if (models && !/^[\w.:\-,/ ]+$/.test(models)) return { error: "The models list has strange characters." };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    run.out = (api || ui ? "" : "bench-") + stamp;
    const outDir = path.join(REPORTS, run.out);
    let args;
    if (!api && !ui) args = ["bench.mjs", "--out", outDir, ...(models ? ["--models", models] : [])];
    else {
      args = ["check.mjs", site, "--out", outDir, "--gap", String(clamp(body.gap, 0, 10000, 2500))];
      if (api && !ui) args.push("--api-only");
      if (ui && !api) args.push("--ui-only");
      if (body.light) args.push("--light");
      if (body.rateLimit) args.push("--rate-limit", String(clamp(body.rateLimit, 1, 100000, 30)));
      if (body.quick) args.push("--quick");
      if (body.headed) args.push("--headed");
      if (body.maxClicks) args.push("--max-clicks", String(clamp(body.maxClicks, 5, 200, 40)));
      if (bench && (groq || gem)) args.push("--bench");
      if (bench && (groq || gem) && models) args.push("--models", models);
      if (["groq", "gemini"].includes(body.expect)) args.push("--expect", body.expect);
    }
    // Remember settings. Keys and token are saved only if the person asked, and only in plain text on this computer.
    const next = { ...st, form: { site, api, ui, bench, quick: !!body.quick, light: !!body.light, headed: !!body.headed, maxClicks: body.maxClicks || "", models, expect: body.expect || "" } };
    if (body.remember) next.secrets = { token: token || sec.token || "", groqKey: groq || sec.groqKey || "", geminiKey: gem || sec.geminiKey || "" };
    else delete next.secrets;
    next.remember = !!body.remember;
    try { writeSettings(next); } catch { /* read-only folder: fine */ }

    run.events = []; run.started = Date.now();
    const env = { ...process.env, MM_JSONL: "1", NO_COLOR: "1", ELECTRON_RUN_AS_NODE: "1" };
    if (token) env.ADMIN_TOKEN = token;
    if (groq) env.GROQ_API_KEY = groq;
    if (gem) env.GEMINI_API_KEY = gem;
    const child = spawn(process.execPath, args, { cwd: DIR, env, windowsHide: true });
    run.child = child;
    push({ type: "start", out: run.out, site: site || "models", at: run.started });
    let buf = "";
    const onData = (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
        if (line.startsWith(MARK)) { try { push(JSON.parse(line.slice(MARK.length))); } catch { /* ignore */ } }
        else if (line.trim()) push({ type: "log", line: line.slice(0, 400) });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (d) => String(d).split("\n").filter((l) => l.trim()).forEach((l) => push({ type: "log", line: l.slice(0, 400) })));
    child.on("error", (e) => push({ type: "log", line: "Could not start: " + e.message }));
    child.on("close", (code, sig) => { push({ type: "exit", code, killed: !!sig || run.stopping }); run.child = null; run.stopping = false; });
    return { ok: true, out: run.out };
  }

  function history() {
    try {
      return fs.readdirSync(REPORTS).filter((d) => fs.existsSync(path.join(REPORTS, d, "report.json"))).sort().reverse().slice(0, 15).map((d) => {
        try { const j = JSON.parse(fs.readFileSync(path.join(REPORTS, d, "report.json"), "utf8")); return { dir: d, ...j.summary }; } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const host = String(req.headers.host || "");
    const send = (code, body, type = "application/json", extra = {}) => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...extra }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    // 1) only this computer's own address (blocks DNS-rebinding), 2) pages from other sites may not call us
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(403, { error: "forbidden host" });
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(403, { error: "forbidden origin" });

    if (url.pathname === "/") {
      const html = fs.readFileSync(path.join(DIR, "ui", "index.html"), "utf8");
      return send(200, html, TYPES[".html"], { "Set-Cookie": `mm=${secret}; HttpOnly; SameSite=Strict; Path=/` });
    }
    const cookie = Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")));
    if (cookie.mm !== secret) return send(403, { error: "open this from the app window" });

    if (url.pathname.startsWith("/api/monitor/")) {
      const sub = url.pathname.slice("/api/monitor/".length);
      const readBody = async () => { let raw = ""; for await (const c of req) { raw += c; if (raw.length > 20000) break; } try { return JSON.parse(raw || "{}"); } catch { return null; } };
      if (sub === "state") return send(200, { sites: monitor.list(), alerts: monitor.alerts(), incidents: monitor.incidents(), net: monitor.netBrief(), now: Date.now() });
      if (sub === "detail") { const d = monitor.detail(String(url.searchParams.get("id") || "")); return d ? send(200, d) : send(404, { error: "no such site" }); }
      if (sub === "system") return send(200, await monitor.system());
      if (sub === "events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(": hi\n\n"); mclients.add(res); req.on("close", () => mclients.delete(res)); return;
      }
      if (sub.startsWith("deep-report/")) {
        const rel = decodeURIComponent(sub.slice("deep-report/".length)); const file = path.resolve(monitor.reportsDir, rel);
        if (!file.startsWith(path.resolve(monitor.reportsDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: "not found" });
        return send(200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
      }
      if (req.method !== "POST") return send(405, { error: "POST only" });
      const b = await readBody(); if (!b) return send(400, { error: "bad request" });
      if (sub === "site") { const r = monitor.addOrUpdate(b); return send(r.error ? 400 : 200, r); }
      if (sub === "remove") return send(200, monitor.remove(String(b.id || "")));
      if (sub === "probe") { monitor.probeNow(String(b.id || "")); return send(200, { ok: true }); }
      if (sub === "deep") { if (run.child) return send(409, { error: "A manual test is running. Try again when it ends." }); monitor.deepNow(String(b.id || "")); return send(200, { ok: true }); }
      if (sub === "alerts") { const r = monitor.saveAlerts(b); return send(r.error ? 400 : 200, r); }
      if (sub === "net-check") { await monitor.forceNet(); return send(200, await monitor.system()); }
      if (sub === "test-alert") { const sent = await monitor.testAlert(); return send(200, { sent }); }
      return send(404, { error: "not found" });
    }
    if (url.pathname === "/api/quit" && req.method === "POST") { send(200, { ok: true }); setTimeout(() => { try { close(); } catch { /* ignore */ } if (onQuit) onQuit(); else process.exit(0); }, 200); return; }
    if (url.pathname === "/api/ping") { lastPing = Date.now(); seenClient = true; return send(200, { ok: true }); }
    if (url.pathname === "/api/state") {
      const st = readSettings(), sec = st.secrets || {};
      let pw = true; try { await import("playwright"); } catch { pw = false; }
      return send(200, { form: st.form || null, remember: !!st.remember, saved: { token: !!sec.token, groqKey: !!sec.groqKey, geminiKey: !!sec.geminiKey }, running: !!run.child, history: history(), playwright: pw, node: process.version });
    }
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      run.clients.add(res); req.on("close", () => run.clients.delete(res));
      return;
    }
    if (url.pathname === "/api/start" && req.method === "POST") {
      if (run.child) return send(409, { error: "A test is already running." });
      let raw = ""; for await (const c of req) { raw += c; if (raw.length > 20000) break; }
      let body = {}; try { body = JSON.parse(raw); } catch { return send(400, { error: "bad request" }); }
      const r = startRun(body);
      return send(r.error ? 400 : 200, r);
    }
    if (url.pathname === "/api/stop" && req.method === "POST") { if (run.child) { run.stopping = true; killTree(run.child); } return send(200, { ok: true }); }
    if (url.pathname === "/api/forget" && req.method === "POST") { const st = readSettings(); delete st.secrets; st.remember = false; try { writeSettings(st); } catch { /* ignore */ } return send(200, { ok: true }); }
    if (url.pathname.startsWith("/reports/")) {
      let rel; try { rel = decodeURIComponent(url.pathname.slice("/reports/".length)); } catch { return send(400, {}); }
      const file = path.resolve(REPORTS, rel);
      if (!file.startsWith(REPORTS + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: "not found" });
      return send(200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
    }
    send(404, { error: "not found" });
  });

  let p = port;
  await new Promise((resolve, reject) => {
    const tryListen = () => { server.once("error", (e) => { if (e.code === "EADDRINUSE" && p < port + 20) { p++; tryListen(); } else reject(e); }); server.listen(p, "127.0.0.1", resolve); };
    tryListen();
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  if (open) openWindow(url);
  if (autoExit) {
    const t = setInterval(() => { if (seenClient && !run.child && !monitor.hasActive() && Date.now() - lastPing > 180000) { console.log("Window closed. Bye."); process.exit(0); } }, 5000);
    t.unref();
  }
  const close = () => { monitor.stop(); killTree(run.child); for (const c of mclients) c.end(); for (const c of run.clients) c.end(); server.close(); };
  return { server, url, port: server.address().port, secret, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const noOpen = process.argv.includes("--no-open");
  // Already running (for example started at login)? Just open its window instead of starting a second copy.
  for (let q = 4777; q <= 4797 && !noOpen; q++) {
    try {
      const r = await fetch(`http://127.0.0.1:${q}/`, { signal: AbortSignal.timeout(700) });
      if (r.ok && /<title>Noctua<\/title>/.test(await r.text())) { openWindow(`http://127.0.0.1:${q}/`); console.log("Noctua is already running. Opened its window."); process.exit(0); }
    } catch { /* nothing on this port */ }
  }
  const hidden = process.argv.includes("--hidden"); // started at login: run the monitor, don't pop a window
  const app = await startApp({ open: !noOpen && !hidden, autoExit: !noOpen && !hidden });
  console.log(`\nNoctua is running at ${app.url}\nKeep this window open while you use the app. Close the app window and this one closes by itself.\n`);
}
