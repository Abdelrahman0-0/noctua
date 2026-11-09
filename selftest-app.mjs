// Tests the app window's server: security, a real run streamed live, saved settings, history, reports and Stop.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMock } from "./mock/server.mjs";
import { startApp } from "./app.mjs";

const TOKEN = "mock-admin-token-1234567890";
let failed = 0;
const expect = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} app: ${msg}`); if (!ok) failed++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-app-"));
const site = await startMock({ port: 4173, bug: false });
const app = await startApp({ port: 4790, open: false, reportsDir: path.join(tmp, "reports"), settingsFile: path.join(tmp, "settings.json"), dataDir: path.join(tmp, "data") });
const base = app.url.replace(/\/$/, "");
const raw = await fetch(base + "/");
const cookie = (raw.headers.get("set-cookie") || "").split(";")[0];
const get = (p, h = {}) => fetch(base + p, { headers: { cookie, ...h } });
const post = (p, body) => fetch(base + p, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

expect(raw.status === 200 && /Noctua/.test(await raw.text()), "the window page loads");
expect((await fetch(base + "/api/state")).status === 403, "API refuses requests without the session cookie");
const rawStatus = (host) => new Promise((resolve) => { const r = http.request({ host: "127.0.0.1", port: app.port, path: "/api/state", headers: { cookie, host } }, (res) => { res.resume(); resolve(res.statusCode); }); r.on("error", () => resolve(0)); r.end(); });
expect((await rawStatus("evil.example.com")) === 403 && (await rawStatus("127.0.0.1:" + app.port)) === 200, "API refuses a foreign Host header (DNS-rebinding protection)");
expect((await fetch(base + "/api/state", { headers: { cookie, origin: "https://evil.example.com" } })).status === 403, "API refuses calls coming from another website");
expect((await get("/reports/..%2Fsettings.json")).status === 404 && (await get("/reports/..%2F..%2Fpackage.json")).status === 404, "report files cannot escape the reports folder");

let st = await (await get("/api/state")).json();
expect(st.playwright === true && st.running === false && Array.isArray(st.history), "state endpoint reports the environment");
expect((await post("/api/start", { site: "not-a-url", api: true })).status === 400, "a bad site address is rejected");
expect((await post("/api/start", { site: "http://localhost:4173" })).status === 400, "starting with nothing selected is rejected");
expect((await post("/api/start", { bench: true })).status === 400, "models test without any key is rejected");

// A real run, streamed live over SSE
const events = [];
const ctl = new AbortController();
const sse = fetch(base + "/api/events", { headers: { cookie }, signal: ctl.signal }).then(async (r) => {
  const dec = new TextDecoder(); let buf = "";
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); if (l.startsWith("data: ")) events.push(JSON.parse(l.slice(6))); }
  }
}).catch(() => {});
const started = await post("/api/start", { site: "http://localhost:4173", api: true, ui: false, bench: false, token: TOKEN, remember: true, expect: "groq", gap: 0, rateLimit: 1000 });
expect(started.status === 200, "a run starts");
expect((await post("/api/start", { site: "http://localhost:4173", api: true })).status === 409, "a second run is refused while one is running");
const t0 = Date.now();
while (!events.some((e) => e.type === "exit") && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 300));
const done = events.find((e) => e.type === "done"), rows = events.filter((e) => e.type === "row");
expect(events[0]?.type === "start" && rows.length > 20, `progress streamed live (${rows.length} result rows)`);
expect(done && done.summary.fail === 0, `the run finished with no FAIL on a healthy site (${done?.summary?.fail})`);
expect(!JSON.stringify(events).includes(TOKEN), "the admin token never appears in the stream");
expect(events.some((e) => e.type === "row" && e.name === "Which model answered" && e.level === "PASS"), "the expected-provider option reached the checker");

st = await (await get("/api/state")).json();
expect(st.history.length === 1 && st.history[0].pass > 20, "the finished run shows in the history");
expect(st.form?.site === "http://localhost:4173" && st.form.api === true && st.saved.token === true, "form settings and saved token are remembered");
const rep = await get(`/reports/${st.history[0].dir}/report.html`);
expect(rep.status === 200 && /id="verdict"/.test(await rep.text()), "the full report can be opened from the app");
const trf = await get(`/reports/${st.history[0].dir}/traffic.json`); const trj = trf.status === 200 ? await trf.json() : { entries: [] };
expect(trj.entries.length > 5 && trj.entries.some((e) => e.src === "api" && e.status > 0 && e.resHeaders), "the report keeps every request and answer (traffic.json)");
expect(!JSON.stringify(trj).includes("Bearer "), "recorded traffic never contains the admin token");
await post("/api/forget");
st = await (await get("/api/state")).json();
expect(st.saved.token === false, "saved keys can be deleted");
expect(!fs.readFileSync(path.join(tmp, "settings.json"), "utf8").includes(TOKEN), "token is gone from settings.json after Forget");

// Monitor
expect((await fetch(base + "/api/monitor/state")).status === 403, "monitor API refuses requests without the session cookie");
expect((await post("/api/monitor/site", { url: "ftp://nope" })).status === 400, "monitor refuses a bad site address");
const added = await (await post("/api/monitor/site", { url: "http://localhost:4173", name: "mock", lightMin: 1, token: "secret-token-xyz" })).json();
await new Promise((r) => setTimeout(r, 1500));
const ms = await (await get("/api/monitor/state")).json();
const m0 = ms.sites.find((x) => x.id === added.id);
expect(m0 && m0.last && m0.last.ok === true && m0.uptime === 100, "monitor probed the site by itself and saw it up");
expect(!JSON.stringify(ms).includes("secret-token-xyz") && m0.hasToken === true, "monitor never sends a saved token back to the page");
expect((await post("/api/monitor/alerts", { webhookUrl: "http://plain-http.example" })).status === 400, "alert webhook must be https");
expect((await post("/api/monitor/remove", { id: added.id })).status === 200 && (await (await get("/api/monitor/state")).json()).sites.length === 0, "a monitored site can be removed");

// Stop
const n0 = events.length;
await post("/api/start", { site: "http://localhost:4173", api: false, ui: true, gap: 0, quick: true });
await new Promise((r) => setTimeout(r, 4000));
await post("/api/stop");
const t1 = Date.now();
while (!events.slice(n0).some((e) => e.type === "exit") && Date.now() - t1 < 15000) await new Promise((r) => setTimeout(r, 200));
const ex = events.slice(n0).find((e) => e.type === "exit");
expect(ex && ex.killed === true, "Stop ends a running test");
expect((await (await get("/api/state")).json()).running === false, "the app is ready for the next run after Stop");

ctl.abort(); await sse; app.close(); site.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nApp selftest FAILED (${failed})` : "\nApp selftest passed.");
process.exit(failed ? 1 : 0);
