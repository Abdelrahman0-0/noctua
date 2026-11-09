// Noctua monitor: watches several sites on a schedule, keeps history, sends alerts.
//  - light probe (every few minutes): site up, the five connection phases (DNS, TCP, TLS, wait, download), certificate,
//    redirects, size, security headers, extra pages, a required word, content change. No browser, no AI calls.
//  - deep run (every hour or so): the full Noctua check (api + browser) as a separate process.
//  - this computer: internet reachability (so "your internet is down" is never reported as "the site is down"), CPU, memory.
// Data lives in plain files next to the app (no database to install): data/sites.json, data/alerts.json, data/history/<id>.jsonl
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import dns from "node:dns/promises";
import path from "node:path";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const MAX_HISTORY = 20000;       // records kept per site (about two weeks at one probe a minute)
const FAILS_BEFORE_ALERT = 2;
const NETISH = new Set(["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET"]);
const NET_TARGETS = [["Google", "https://www.gstatic.com/generate_204"], ["Cloudflare", "https://1.1.1.1/cdn-cgi/trace"], ["Microsoft", "https://www.msftconnecttest.com/connecttest.txt"]];

export const slug = (url) => String(url).replace(/^https?:\/\//i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "site";
const isLocal = (url) => { try { const h = new URL(url).hostname; return h === "localhost" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "::1" || h === "[::1]"; } catch { return false; } };
const r0 = (x) => Math.max(0, Math.round(x));

export function sslDaysLeft(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { return resolve(null); }
    if (u.protocol !== "https:") return resolve(null);
    const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: u.hostname, timeout: timeoutMs }, () => {
      const c = s.getPeerCertificate(); s.end();
      const t = c && c.valid_to ? Date.parse(c.valid_to) : NaN;
      resolve(Number.isFinite(t) ? Math.floor((t - Date.now()) / 86400000) : null);
    });
    s.on("error", () => resolve(null));
    s.on("timeout", () => { s.destroy(); resolve(null); });
  });
}

// ---- one timed request: records when each connection phase finished ----
function hop(urlStr, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const lib = u.protocol === "https:" ? https : http;
    const ph = { t0: performance.now() }; let cert = null, proto = null, cipher = "", settled = false;
    const fail = (e) => { if (settled) return; settled = true; e.ph = ph; reject(e); };
    const req = lib.request(u, { method: "GET", agent: false, timeout: timeoutMs, headers: { "user-agent": "Noctua-Monitor/2", accept: "text/html,application/json,*/*", "accept-encoding": "identity" } }, (res) => {
      ph.ttfb = performance.now();
      const chunks = []; let size = 0, kept = 0;
      res.on("data", (c) => { size += c.length; if (kept < maxBytes) { chunks.push(c); kept += c.length; } });
      res.on("end", () => { if (settled) return; settled = true; ph.end = performance.now(); resolve({ status: res.statusCode, statusText: res.statusMessage || "", httpVersion: res.httpVersion || "", headers: res.headers, body: Buffer.concat(chunks), size, ph, cert, proto, cipher }); });
      res.on("error", fail);
      res.on("aborted", () => fail(Object.assign(new Error("connection closed"), { code: "ECONNRESET" })));
    });
    req.on("socket", (s) => {
      s.on("lookup", (err) => { if (!err) ph.dns = performance.now(); });
      s.on("connect", () => { ph.tcp = performance.now(); ph.ip = s.remoteAddress || ""; });
      s.on("secureConnect", () => { ph.tls = performance.now(); try { cert = s.getPeerCertificate(); proto = s.getProtocol(); cipher = s.getCipher()?.name || ""; } catch { /* ignore */ } });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", fail);
    req.end();
  });
}
async function timedGet(url, { timeoutMs = 20000, maxBytes = 1500000, maxRedirects = 5 } = {}) {
  const t0 = performance.now(); let cur = url, n = 0; const hops = [];
  for (;;) {
    const r = await hop(cur, { timeoutMs: Math.max(1000, timeoutMs - (performance.now() - t0)), maxBytes });
    hops.push({ url: cur, status: r.status, statusText: r.statusText, ms: r0((r.ph.end ?? performance.now()) - r.ph.t0), loc: String(r.headers.location || "").slice(0, 200) });
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location && n < maxRedirects) { cur = new URL(r.headers.location, cur).href; n++; continue; }
    return { ...r, redirects: n, finalUrl: cur, total: r0(performance.now() - t0), hops };
  }
}
const phasesOf = (ph) => { const d = ph.dns ?? ph.t0, c = ph.tcp ?? d, tl = ph.tls ?? c, f = ph.ttfb ?? tl, e = ph.end ?? f; return { dns: r0(d - ph.t0), tcp: r0(c - d), tls: r0(tl - c), wait: r0(f - tl), dl: r0(e - f) }; };
const stageOf = (ph, url) => { if (!ph) return "dns"; let host = ""; try { host = new URL(url).hostname; } catch { /* ignore */ } const lit = net.isIP(host.replace(/^\[|\]$/g, "")); if (!ph.dns && !lit) return "dns"; if (!ph.tcp) return "connect"; if (/^https:/i.test(url) && !ph.tls) return "tls"; if (!ph.ttfb) return "wait"; return "download"; };
const errCode = (e) => String(e?.cause?.code || e?.code || e?.message || "error").slice(0, 80);

const fingerprint = (buf) => {
  const html = buf.toString("utf8");
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]).sort().join("|");
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(assets + "\n" + text).digest("hex").slice(0, 12);
};

const SENT = { "user-agent": "Noctua-Monitor/2", accept: "text/html,application/json,*/*", "accept-encoding": "identity" };
function buildTrace(site, r, rec, e) {
  const tr = { n: 0, req: { method: "GET", url: site.url, headers: { host: (() => { try { return new URL(site.url).host; } catch { return ""; } })(), ...SENT } } };
  if (r) {
    const tx = /html|json|text|xml|javascript/i.test(String(r.headers["content-type"] || "")) ? r.body.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 500) : "";
    tr.hops = r.hops; tr.ip = r.ph.ip || "";
    tr.res = { status: r.status, statusText: r.statusText, httpVersion: r.httpVersion, size: r.size, headers: Object.fromEntries(Object.entries(r.headers).slice(0, 40).map(([k, v]) => [k, String(v).slice(0, 200)])), preview: tx };
    tr.tls = r.proto ? { proto: r.proto, cipher: r.cipher, issuer: rec.cert?.issuer || "", days: rec.ssl } : null;
    tr.phases = rec.ph; tr.final = r.finalUrl;
  } else { tr.err = rec.err; tr.stage = rec.stage; tr.ip = rec.ip || ""; }
  if (rec.paths) tr.paths = rec.paths;
  return tr;
}

// One light probe. Never throws. Returns a plain record (rec.trace holds the full request and response).
export async function lightProbe(site, { slowMs = 3000 } = {}) {
  slowMs = Number(site.slowMs) || slowMs;
  const rec = { t: Date.now(), kind: "light", ok: false, status: 0, ms: 0, ssl: null, notes: [] };
  const t0 = Date.now(); let r = null, warn = false;
  try {
    r = await timedGet(site.url);
    rec.ms = r.total; rec.status = r.status; rec.ok = r.status >= 200 && r.status < 400;
    rec.ph = phasesOf(r.ph); rec.ip = r.ph.ip || ""; rec.size = r.size; rec.redirects = r.redirects;
    if (r.redirects && r.finalUrl !== site.url) rec.final = r.finalUrl;
    if (!rec.ok) rec.notes.push(`HTTP ${r.status}`);
    if (rec.ok && rec.ms > slowMs) { rec.notes.push(`slow: ${rec.ms} ms`); warn = true; }
    const h = r.headers;
    rec.server = String(h.server || h["x-powered-by"] || "").slice(0, 40);
    rec.type = String(h["content-type"] || "").split(";")[0].slice(0, 40);
    rec.sec = { hsts: !!h["strict-transport-security"], csp: !!h["content-security-policy"], xfo: !!(h["x-frame-options"] || /frame-ancestors/i.test(String(h["content-security-policy"] || ""))), xcto: !!h["x-content-type-options"], ref: !!h["referrer-policy"] };
    const body = r.body, text = body.toString("utf8");
    const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (m) rec.title = m[1].replace(/\s+/g, " ").trim().slice(0, 80);
    if (site.keyword) { rec.kw = text.toLowerCase().includes(String(site.keyword).toLowerCase()); if (!rec.kw) { rec.ok = false; rec.notes.push(`text not found: ${site.keyword}`); } }
    if (r.cert && r.cert.valid_to) {
      const to = Date.parse(r.cert.valid_to); const days = Number.isFinite(to) ? Math.floor((to - Date.now()) / 86400000) : null;
      if (days !== null) { rec.ssl = days; rec.cert = { issuer: String(r.cert.issuer?.O || r.cert.issuer?.CN || "").slice(0, 60), to, days, proto: r.proto || "" }; }
    }
    if (rec.ok && (/html|json|text|xml/i.test(rec.type) || !rec.type)) rec.hash = fingerprint(body);
    if (rec.ssl !== null && rec.ssl < 14) { rec.notes.push(`SSL expires in ${rec.ssl} days`); warn = true; if (rec.ssl < 0) rec.ok = false; }
    if (rec.ok && Array.isArray(site.paths) && site.paths.length) {
      const origin = new URL(site.url).origin;
      rec.paths = await Promise.all(site.paths.slice(0, 8).map(async (p) => {
        const t = Date.now();
        try { const x = await timedGet(new URL(p, origin).href, { timeoutMs: 15000, maxBytes: 200000 }); return { p, status: x.status, ms: x.total, ok: x.status >= 200 && x.status < 400 }; }
        catch (e) { return { p, status: 0, ms: Date.now() - t, ok: false, err: errCode(e).slice(0, 40) }; }
      }));
      const bad = rec.paths.filter((x) => !x.ok); if (bad.length) { rec.notes.push(`${bad.length}/${rec.paths.length} extra pages failing`); warn = true; }
    }
  } catch (e) {
    rec.ms = Date.now() - t0; rec.err = errCode(e); rec.notes.push(rec.err); rec.stage = stageOf(e.ph, site.url); if (e.ph?.ip) rec.ip = e.ph.ip;
  }
  rec.level = !rec.ok ? "down" : warn ? "warn" : "up";
  try { rec.trace = buildTrace(site, r, rec); } catch { /* never let tracing break a probe */ }
  return rec;
}

async function pingOne([name, url]) {
  const t0 = Date.now();
  try { const r = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: "manual" }); await r.arrayBuffer().catch(() => {}); return { name, ok: true, ms: Date.now() - t0 }; }
  catch (e) { return { name, ok: false, ms: Date.now() - t0, err: errCode(e).slice(0, 40) }; }
}
const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
function dirSize(d) { let n = 0; try { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); n += f.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch { /* ignore */ } return n; }

export function createMonitor({ dir, appDir, onEvent = () => {}, busy = () => false }) {
  const SITES = path.join(dir, "sites.json"), ALERTS = path.join(dir, "alerts.json"), ALERT_LOG = path.join(dir, "alert-log.json"), HIST = path.join(dir, "history"), REPORTS = path.join(dir, "deep-reports");
  fs.mkdirSync(HIST, { recursive: true });
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

  let sites = readJson(SITES, []);
  const live = new Map();
  const stateOf = (id) => { if (!live.has(id)) live.set(id, { last: null, lastDeep: null, lastHash: null, fails: 0, alerted: false, sslAlerted: false, nextLight: 0, nextDeep: 0, deepRunning: false, probing: false, seq: 0, ring: [], watchUntil: 0 }); return live.get(id); };

  // ---- history: kept in memory, appended to a file ----
  const cache = new Map();
  const histFile = (id) => path.join(HIST, id + ".jsonl");
  function hist(id) {
    if (!cache.has(id)) { let a = []; try { a = fs.readFileSync(histFile(id), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none yet */ } cache.set(id, a); }
    return cache.get(id);
  }
  const readHistory = (id, n = 200) => hist(id).slice(-n);
  function appendHistory(id, rec) {
    const a = hist(id); a.push(rec);
    try { fs.appendFileSync(histFile(id), JSON.stringify(rec) + "\n"); } catch { /* disk full: keep going in memory */ }
    if (a.length > MAX_HISTORY) { a.splice(0, a.length - MAX_HISTORY / 2); try { fs.writeFileSync(histFile(id), a.map((x) => JSON.stringify(x)).join("\n") + "\n"); } catch { /* ignore */ } }
  }
  for (const s of sites) { const h = hist(s.id); const st = stateOf(s.id); st.last = [...h].reverse().find((r) => r.kind === "light") || null; st.lastDeep = [...h].reverse().find((r) => r.kind === "deep") || null; st.lastHash = [...h].reverse().find((r) => r.hash)?.hash || null; }

  // ---- alerts ----
  const alertCfg = () => readJson(ALERTS, {});
  const alertLog = readJson(ALERT_LOG, []);
  async function sendAlert(text) {
    const c = alertCfg(); const sent = [];
    try {
      if (c.telegramToken && c.telegramChatId) {
        const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(c.telegramToken)}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c.telegramChatId, text }), signal: AbortSignal.timeout(10000) });
        sent.push(r.ok ? "telegram" : `telegram failed (HTTP ${r.status})`);
      }
    } catch (e) { sent.push("telegram failed: " + e.message); }
    try {
      if (c.webhookUrl && /^https:\/\//i.test(c.webhookUrl)) { // Slack / Discord / any webhook that accepts {text}
        const r = await fetch(c.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(10000) });
        sent.push(r.ok ? "webhook" : `webhook failed (HTTP ${r.status})`);
      }
    } catch (e) { sent.push("webhook failed: " + e.message); }
    alertLog.push({ t: Date.now(), text: text.slice(0, 300), sent }); if (alertLog.length > 50) alertLog.splice(0, alertLog.length - 50);
    try { writeJson(ALERT_LOG, alertLog); } catch { /* ignore */ }
    onEvent({ type: "alert", text, sent, at: Date.now() });
    return sent;
  }

  function judge(site, rec) {
    const st = stateOf(site.id);
    if (rec.noNet) return; // the problem is this computer's internet, not the site
    if (rec.ok) {
      if (st.alerted) { sendAlert(`✅ ${site.name || site.url} is back up (${rec.ms} ms).`); st.alerted = false; }
      st.fails = 0;
      if (rec.ssl !== null && rec.ssl < 14 && !st.sslAlerted) { st.sslAlerted = true; sendAlert(`🟠 ${site.name || site.url}: the SSL certificate expires in ${rec.ssl} days.`); }
      if (rec.ssl !== null && rec.ssl > 30) st.sslAlerted = false;
      if (site.watchContent && rec.changed) sendAlert(`🟡 ${site.name || site.url}: the page content changed.`);
    } else {
      st.fails++;
      if (st.fails >= FAILS_BEFORE_ALERT && !st.alerted) { st.alerted = true; sendAlert(`🔴 ${site.name || site.url} is DOWN (${st.fails} checks in a row): ${rec.notes.join(", ") || "no answer"}`); }
    }
  }

  // ---- this computer: internet, CPU, memory ----
  const netState = { at: 0, ok: null, dnsMs: null, targets: [], log: [] };
  let netBusy = null;
  function checkNet(force) {
    if (!force && Date.now() - netState.at < 15000) return Promise.resolve(netState);
    if (netBusy) return netBusy;
    netBusy = (async () => {
      const t0 = Date.now(); let dnsMs = null;
      const [targets] = await Promise.all([Promise.all(NET_TARGETS.map(pingOne)), dns.lookup("www.google.com").then(() => { dnsMs = Date.now() - t0; }).catch(() => {})]);
      const was = netState.ok; netState.targets = targets; netState.ok = targets.some((x) => x.ok); netState.dnsMs = dnsMs; netState.at = Date.now();
      netState.log.push({ t: netState.at, ok: netState.ok, ms: netState.ok ? Math.min(...targets.filter((x) => x.ok).map((x) => x.ms)) : 0 }); if (netState.log.length > 120) netState.log.shift();
      if (was !== null && was !== netState.ok) onEvent({ type: "net", ok: netState.ok });
      netBusy = null; return netState;
    })();
    return netBusy;
  }
  let prevCpu = os.cpus(), cpuNow = 0, lastTick = Date.now(), lagMs = 0; const cpuHist = [], memHist = [], lagHist = [];
  function sample() {
    const cur = os.cpus(); let idle = 0, tot = 0;
    cur.forEach((c, i) => { const p = prevCpu[i] || c; for (const k in c.times) tot += c.times[k] - (p.times[k] || 0); idle += c.times.idle - (p.times.idle || 0); });
    prevCpu = cur; cpuNow = tot > 0 ? Math.round((1 - idle / tot) * 100) : 0;
    cpuHist.push(cpuNow); memHist.push(Math.round((1 - os.freemem() / os.totalmem()) * 100)); lagHist.push(lagMs);
    for (const a of [cpuHist, memHist, lagHist]) if (a.length > 60) a.shift();
  }
  const counters = { probes: 0, failed: 0, since: Date.now() };
  let dataBytes = 0, dataAt = 0;

  // ---- probes ----
  async function probeLight(id, { boost = false } = {}) {
    const site = sites.find((s) => s.id === id); if (!site) return null;
    const st = stateOf(id); if (st.probing) return st.last; st.probing = true; onEvent({ type: "probing", id });
    try {
      const rec = await lightProbe(site); counters.probes++;
      if (!rec.ok && NETISH.has(rec.err) && !isLocal(site.url)) { const n = await checkNet(true); if (!n.ok) { rec.noNet = true; rec.notes.push("no internet on this computer"); } }
      if (!rec.ok && !rec.noNet) counters.failed++;
      if (rec.hash) { if (st.lastHash && st.lastHash !== rec.hash) rec.changed = true; st.lastHash = rec.hash; }
      const trace = rec.trace; delete rec.trace; if (trace) trace.n = ++st.seq;
      const keep = !boost || !rec.ok || (st.last && st.last.level !== rec.level);   // extra "live watch" probes only reach the disk when something changes
      st.last = rec; if (keep) appendHistory(id, rec); judge(site, rec);
      (st.ring || (st.ring = [])).push({ rec, trace }); if (st.ring.length > 300) st.ring.shift();
      onEvent({ type: "probe", id, rec, trace }); return rec;
    } finally { st.probing = false; }
  }

  function probeDeep(id) {
    const site = sites.find((s) => s.id === id); const st = stateOf(id);
    if (!site || st.deepRunning) return Promise.resolve(null);
    if (busy()) return Promise.resolve(null); // a manual test is running: never two browsers at once
    st.deepRunning = true; onEvent({ type: "deep-start", id });
    const out = path.join(REPORTS, id, new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
    const args = ["check.mjs", site.url, "--out", out, "--quick", "--light", "--gap", "2500"];
    if (site.deepApi === false) args.push("--ui-only");
    const env = { ...process.env, NO_COLOR: "1", ELECTRON_RUN_AS_NODE: "1" }; delete env.MM_JSONL;
    if (site.token) env.ADMIN_TOKEN = site.token;
    return new Promise((resolve) => {
      const child = spawn(process.execPath, args, { cwd: appDir, env, windowsHide: true });
      const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 25 * 60 * 1000);
      child.stdout.resume(); child.stderr.resume();
      child.on("error", () => {});
      child.on("close", () => {
        clearTimeout(kill); st.deepRunning = false;
        const j = readJson(path.join(out, "report.json"), null);
        const rec = { t: Date.now(), kind: "deep", ok: !!j && j.summary.fail === 0, pass: j?.summary.pass ?? 0, warn: j?.summary.warn ?? 0, fail: j?.summary.fail ?? 0, report: j ? path.relative(REPORTS, path.join(out, "report.html")).split(path.sep).join("/") : "", notes: j ? [] : ["deep run did not finish"] };
        if (j) rec.failed = j.rows.filter((r) => r.level === "FAIL").slice(0, 5).map((r) => r.name);
        st.lastDeep = rec; appendHistory(id, rec);
        if (!rec.ok) sendAlert(`🟠 Deep test of ${site.name || site.url}: ${rec.fail || "?"} failed${rec.failed?.length ? " — " + rec.failed.join("; ") : ""}`);
        onEvent({ type: "deep", id, rec }); resolve(rec);
      });
    });
  }

  // ---- numbers ----
  const lightOnly = (id, since = 0) => hist(id).filter((r) => r.kind === "light" && !r.noNet && r.t >= since);
  function windowStats(id, ms) {
    const rs = lightOnly(id, Date.now() - ms); if (!rs.length) return null;
    const okr = rs.filter((r) => r.ok), t = okr.map((r) => r.ms);
    return { n: rs.length, up: Math.round((okr.length / rs.length) * 10000) / 100, avg: t.length ? r0(t.reduce((a, b) => a + b, 0) / t.length) : null, p50: pct(t, 0.5), p95: pct(t, 0.95), max: t.length ? Math.max(...t) : null, since: rs[0].t };
  }
  function series(id, hours, buckets = 72) {
    const from = Date.now() - hours * 3600000, size = (hours * 3600000) / buckets, out = [];
    for (let i = 0; i < buckets; i++) out.push({ t: from + i * size, n: 0, bad: 0, sum: 0, okn: 0 });
    for (const r of lightOnly(id, from)) { const b = out[Math.min(buckets - 1, Math.floor((r.t - from) / size))]; b.n++; if (!r.ok) b.bad++; else { b.sum += r.ms; b.okn++; } }
    return out.map((b) => ({ t: b.t, n: b.n, bad: b.bad, ms: b.okn ? r0(b.sum / b.okn) : null }));
  }
  function siteEvents(x) { // outages with their length, deep failures, content changes
    const out = []; let down = null;
    for (const r of hist(x.id)) {
      if (r.kind === "light") {
        if (r.noNet) continue;
        if (!r.ok && !down) { down = r; out.push({ t: r.t, id: x.id, site: x.name, type: "down", note: (r.notes || []).join(", ") }); }
        else if (r.ok && down) { out.push({ t: r.t, id: x.id, site: x.name, type: "up", dur: r.t - down.t, note: (r.notes || []).join(", ") }); down = null; }
        if (r.changed) out.push({ t: r.t, id: x.id, site: x.name, type: "changed", note: r.title || "" });
      } else if (r.kind === "deep" && !r.ok) out.push({ t: r.t, id: x.id, site: x.name, type: "deep", note: (r.failed || []).join("; ") || `${r.fail || "?"} failed` });
    }
    return out;
  }
  const levelOf = (s, l) => (!s.enabled ? "off" : !l ? "wait" : l.noNet ? "nonet" : l.level || (l.ok ? "up" : "down"));

  // ---- scheduler ----
  let timer = null, nextNet = 0, lastSample = 0;
  const every = (s) => (s.lightSec ? s.lightSec * 1000 : Math.max(1, s.lightMin || 5) * 60000);
  function tick() {
    const now = Date.now(); lagMs = Math.max(0, now - lastTick - 1000); lastTick = now; if (now - lastSample >= 10000) { lastSample = now; sample(); }
    if (now >= nextNet) { nextNet = now + 60000; checkNet(true).catch(() => {}); }
    for (const s of sites) {
      if (!s.enabled) continue;
      const st = stateOf(s.id);
      const boosted = st.watchUntil > now, iv = boosted ? Math.min(every(s), 3000) : every(s);
      if (now >= st.nextLight) { st.nextLight = now + iv; probeLight(s.id, { boost: boosted && iv < every(s) }); }
      if (s.deepMin && now >= st.nextDeep) { st.nextDeep = now + Math.max(15, s.deepMin) * 60000; probeDeep(s.id); }
    }
  }
  const cleanPaths = (v, fallback) => {
    if (v === undefined) return fallback || [];
    const arr = Array.isArray(v) ? v : String(v).split(/[\n,]+/);
    return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean).map((x) => (x.startsWith("/") ? x : "/" + x)).filter((x) => /^\/[^\s]*$/.test(x)))].slice(0, 8);
  };
  const api = {
    start() { if (!timer) { timer = setInterval(tick, 1000); timer.unref?.(); tick(); } },
    // The site screen says "I am looking" every few seconds: while it does, that site is probed every 3 seconds.
    watch(id) { const st = stateOf(id), now = Date.now(); st.watchUntil = now + 25000; if (st.nextLight > now + 3000) st.nextLight = now; return { ok: true }; },
    traces(id, n = 120) { return (stateOf(id).ring || []).slice(-n).reverse(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    hasActive: () => sites.some((s) => s.enabled),
    list() {
      return sites.map((s) => { const st = stateOf(s.id); const h = readHistory(s.id, 400).filter((r) => r.kind === "light" && !r.noNet).slice(-60);
        const up = h.filter((r) => r.ok).length;
        return { ...s, token: undefined, hasToken: !!s.token, last: st.last, lastDeep: st.lastDeep, deepRunning: st.deepRunning, probing: st.probing, fails: st.fails, level: levelOf(s, st.last),
          uptime: h.length ? Math.round((up / h.length) * 1000) / 10 : null, avgMs: h.length ? Math.round(h.reduce((a, r) => a + r.ms, 0) / h.length) : null,
          w24: windowStats(s.id, 86400000), nextLight: s.enabled ? stateOf(s.id).nextLight : 0,
          strip: series(s.id, 24, 48).map((b) => (b.n ? (b.bad ? (b.bad === b.n ? 2 : 1) : 0) : -1)),
          series: h.slice(-40).map((r) => ({ t: r.t, ms: r.ms, ok: r.ok })) };
      });
    },
    detail(id) {
      const s = sites.find((x) => x.id === id); if (!s) return null; const st = stateOf(id);
      const recent = readHistory(id, 400).filter((r) => r.kind === "light").slice(-40).reverse();
      const okPh = readHistory(id, 400).filter((r) => r.kind === "light" && r.ok && r.ph).slice(-20).map((r) => r.ph);
      const avgPh = okPh.length ? Object.fromEntries(["dns", "tcp", "tls", "wait", "dl"].map((k) => [k, r0(okPh.reduce((a, p) => a + (p[k] || 0), 0) / okPh.length)])) : null;
      const ev = siteEvents(s).sort((a, b) => b.t - a.t).slice(0, 40);
      const downs = ev.filter((e) => e.type === "up"), mttr = downs.length ? r0(downs.reduce((a, e) => a + e.dur, 0) / downs.length) : null;
      return { site: { ...s, token: undefined, hasToken: !!s.token }, level: levelOf(s, st.last), last: st.last, lastDeep: st.lastDeep, probing: st.probing, deepRunning: st.deepRunning, fails: st.fails, nextLight: st.nextLight,
        w1: windowStats(id, 3600000), w24: windowStats(id, 86400000), w7: windowStats(id, 7 * 86400000), w30: windowStats(id, 30 * 86400000), mttr,
        series24: series(id, 24), series1: series(id, 1, 60), avgPh, recent, events: ev, changes: ev.filter((e) => e.type === "changed").slice(0, 10), total: hist(id).length };
    },
    async system() {
      const n = await checkNet(false); const now = Date.now();
      if (now - dataAt > 60000) { dataBytes = dirSize(dir); dataAt = now; }
      const mu = process.memoryUsage();
      return {
        net: { ok: n.ok, at: n.at, dnsMs: n.dnsMs, targets: n.targets, log: n.log.slice(-60) },
        os: { platform: `${os.type()} ${os.release()}`, host: os.hostname(), arch: os.arch(), cores: os.cpus().length, model: String(os.cpus()[0]?.model || "").replace(/\s+/g, " ").trim(), cpu: cpuNow, memTotal: os.totalmem(), memFree: os.freemem(), uptime: os.uptime(), cpuHist, memHist },
        app: { node: process.version, uptime: Math.round(process.uptime()), rss: mu.rss, heap: mu.heapUsed, lagMs, lagHist, probes: counters.probes, failed: counters.failed, since: counters.since, dataBytes, sites: sites.length, active: sites.filter((s) => s.enabled).length, deep: sites.filter((s) => stateOf(s.id).deepRunning).length, timer: !!timer },
        alerts: { ...api.alerts(), log: alertLog.slice(-8).reverse() },
      };
    },
    forceNet: () => checkNet(true),
    netBrief: () => ({ ok: netState.ok, at: netState.at }),
    alerts() { const c = alertCfg(); return { telegram: !!(c.telegramToken && c.telegramChatId), webhook: !!c.webhookUrl }; },
    saveAlerts(b) {
      const c = alertCfg();
      if (typeof b.telegramToken === "string" && b.telegramToken.trim()) c.telegramToken = b.telegramToken.trim();
      if (typeof b.telegramChatId === "string" && b.telegramChatId.trim()) c.telegramChatId = b.telegramChatId.trim();
      if (typeof b.webhookUrl === "string") { const w = b.webhookUrl.trim(); if (!w) delete c.webhookUrl; else if (/^https:\/\/[^\s]+$/i.test(w)) c.webhookUrl = w; else return { error: "The webhook address must start with https://" }; }
      if (b.clear) { delete c.telegramToken; delete c.telegramChatId; delete c.webhookUrl; }
      writeJson(ALERTS, c); return { ok: true };
    },
    testAlert: () => sendAlert("🦉 Noctua test alert: if you can read this, alerts work."),
    addOrUpdate(b) {
      const url = String(b.url || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^\s/]+/i.test(url)) return { error: "The site address must start with https://" };
      const id = b.id || slug(url);
      const prev = sites.find((s) => s.id === id);
      const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
      const s = { id, url, name: String(b.name || "").trim().slice(0, 60) || url.replace(/^https?:\/\//, ""), enabled: b.enabled !== false,
        lightMin: num(b.lightMin, 1, 1440, prev?.lightMin ?? 5), lightSec: b.lightSec === undefined ? (b.lightMin !== undefined ? 0 : prev?.lightSec || 0) : (Number(b.lightSec) > 0 ? num(b.lightSec, 5, 3600, 30) : 0), deepMin: b.deepMin === 0 || b.deepMin === "0" ? 0 : num(b.deepMin, 15, 10080, prev?.deepMin ?? 0),
        token: typeof b.token === "string" && b.token.trim() ? b.token.trim() : prev?.token || "",
        paths: cleanPaths(b.paths, prev?.paths), keyword: b.keyword === undefined ? prev?.keyword || "" : String(b.keyword).trim().slice(0, 100),
        watchContent: b.watchContent === undefined ? !!prev?.watchContent : !!b.watchContent, slowMs: num(b.slowMs, 200, 60000, prev?.slowMs ?? 3000) };
      sites = prev ? sites.map((x) => (x.id === id ? s : x)) : [...sites, s];
      writeJson(SITES, sites); stateOf(id).nextLight = 0; if (s.deepMin) stateOf(id).nextDeep = Date.now() + 60000;
      if (api.timerOn()) tick(); return { ok: true, id };
    },
    timerOn: () => !!timer,
    remove(id) { sites = sites.filter((s) => s.id !== id); writeJson(SITES, sites); live.delete(id); cache.delete(id); return { ok: true }; },
    probeNow: (id) => probeLight(id), deepNow: (id) => probeDeep(id),
    incidents(limit = 30) {
      const out = []; for (const x of sites) out.push(...siteEvents(x));
      return out.sort((a, b) => b.t - a.t).slice(0, limit);
    },
    history: (id, n) => readHistory(id, n),
    reportsDir: REPORTS,
  };
  return api;
}
