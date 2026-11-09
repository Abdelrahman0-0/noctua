// A record of every request and answer a run sees: the API calls Noctua makes, the pages it fetches, and everything the
// browser loads while it clicks around. It goes into the report (traffic table) and, in the app, streams live.
import { JSONL, emit } from "./util.mjs";

const SECRET = /^(authorization|x-api-key|x-goog-api-key|cookie|set-cookie|proxy-authorization)$/i;
const hdrs = (h) => {
  const o = {}; if (!h) return o;
  const it = typeof h.entries === "function" ? h.entries() : Object.entries(h);
  for (const [k, v] of it) o[k] = SECRET.test(k) ? "[hidden]" : String(v).slice(0, 200);
  return o;
};

export const traffic = {
  entries: [], max: 700, t0: Date.now(), dropped: 0,
  reset() { this.entries = []; this.t0 = Date.now(); this.dropped = 0; },
  add(e) {
    e.at = Date.now() - this.t0;
    if (this.entries.length >= this.max) { this.dropped++; return; }
    e.n = this.entries.length + 1; this.entries.push(e);
    if (JSONL) emit({ type: "req", e });
  },
};

// fetch() that leaves a record. Same arguments, same result.
export async function tfetch(url, init = {}, src = "api") {
  const t = performance.now();
  const e = { src, method: String(init.method || "GET").toUpperCase(), url: String(url), reqHeaders: hdrs(init.headers), reqBody: init.body ? String(init.body).slice(0, 400) : "", status: 0, statusText: "", ms: 0, size: 0, resHeaders: {}, resBody: "", error: "" };
  try {
    const r = await fetch(url, init);
    e.status = r.status; e.statusText = r.statusText; e.resHeaders = hdrs(r.headers);
    try {
      const buf = Buffer.from(await r.clone().arrayBuffer()); e.size = buf.length;
      if (/json|text|xml|javascript/i.test(r.headers.get("content-type") || "")) e.resBody = buf.toString("utf8").replace(/\s+/g, " ").slice(0, 600);
    } catch { /* body not readable: the status is still recorded */ }
    e.ms = Math.round(performance.now() - t); traffic.add(e); return r;
  } catch (err) {
    e.ms = Math.round(performance.now() - t); e.error = String(err?.cause?.code || err?.message || err).slice(0, 80); traffic.add(e); throw err;
  }
}

// Browser traffic: call from page.on("response") and page.on("requestfailed").
export function browserResponse(r) {
  try {
    const q = r.request(), tm = q.timing?.() || {}, h = r.headers();
    const e = { src: "browser", method: q.method(), url: r.url(), type: q.resourceType(), status: r.status(), statusText: r.statusText(), ms: tm.responseEnd > 0 ? Math.round(tm.responseEnd) : 0, size: Number(h["content-length"]) || 0,
      reqHeaders: hdrs(q.headers()), reqBody: (q.postData() || "").slice(0, 400), resHeaders: hdrs(h), resBody: "", error: "" };
    traffic.add(e);
    if (/^(fetch|xhr)$/.test(e.type) && /json|text/i.test(h["content-type"] || "")) r.text().then((t) => { e.resBody = t.replace(/\s+/g, " ").slice(0, 600); }).catch(() => {});
  } catch { /* a page that closed mid-way */ }
}
export function browserFailed(r) {
  try { const q = r.request ? r.request() : r; traffic.add({ src: "browser", method: q.method(), url: q.url(), type: q.resourceType(), status: 0, ms: 0, size: 0, reqHeaders: hdrs(q.headers()), reqBody: "", resHeaders: {}, resBody: "", error: String(q.failure()?.errorText || "failed").slice(0, 80) }); } catch { /* ignore */ }
}
