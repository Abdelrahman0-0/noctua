// Direct model benchmark. Talks to Groq / Gemini with YOUR keys (read from this computer's environment,
// never printed, never saved) and asks each model what the site asks: same prompts, same checks.
// It tells you: does the key work, does the model id exist, how fast, how good, what limits, and which order to use.
import { sleep, short } from "./util.mjs";
import { CASES } from "./cases.mjs";
import { clean, buildPrompt, parseReview, tidy, KINDS } from "./site-logic.mjs";

export const DEFAULT_MODELS = "groq:llama-3.1-8b-instant,groq:llama-3.3-70b-versatile,gemini:gemini-3.5-flash-lite";
const KEYS = { groq: "GROQ_API_KEY", gemini: "GEMINI_API_KEY" };
const BASES = { groq: () => process.env.GROQ_BASE || "https://api.groq.com/openai/v1", gemini: () => process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta" };

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : 0; };

function mask(text) {
  let t = String(text ?? "");
  for (const k of Object.values(KEYS)) { const v = process.env[k]; if (v && v.length > 6) t = t.split(v).join("***"); }
  return t;
}

// One call to one model, like the site's own `one()`, but it also returns timing, token count and limit headers.
async function ask(step, c, timeoutMs) {
  const { system, user } = buildPrompt(c), max = Math.round(KINDS[c.kind] * 2.2) + 60;
  const key = process.env[KEYS[step.p]], t0 = Date.now();
  let r;
  try {
    if (step.p === "groq") {
      r = await fetch(`${BASES.groq()}/chat/completions`, { method: "POST", signal: AbortSignal.timeout(timeoutMs), headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: step.m, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: max, temperature: 0.6 }) });
    } else {
      r = await fetch(`${BASES.gemini()}/models/${step.m}:generateContent`, { method: "POST", signal: AbortSignal.timeout(timeoutMs), headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: max + 1000, temperature: 0.6 } }) });
    }
  } catch (e) { return { ok: false, ms: Date.now() - t0, status: 0, error: e.name === "TimeoutError" ? `no answer in ${timeoutMs / 1000}s` : mask(e.message) }; }
  const ms = Date.now() - t0, status = r.status;
  const rl = {};
  for (const [k, v] of r.headers) if (k.startsWith("x-ratelimit-") || k === "retry-after") rl[k] = v;
  if (!r.ok) { let msg = ""; try { const j = await r.json(); msg = j?.error?.message || j?.error || ""; } catch { /* ignore */ } return { ok: false, ms, status, rl, error: `HTTP ${status} ${short(mask(typeof msg === "string" ? msg : JSON.stringify(msg)))}`.trim() }; }
  let j = {}; try { j = await r.json(); } catch { /* ignore */ }
  const raw = step.p === "groq" ? j?.choices?.[0]?.message?.content || "" : j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const out = step.p === "groq" ? j?.usage?.completion_tokens : j?.usageMetadata?.candidatesTokenCount;
  return { ok: !!raw.trim(), ms, status, rl, raw, outTokens: out || 0, error: raw.trim() ? "" : "empty answer" };
}

// Ask the provider which models this key can use. Returns null when the list could not be read.
async function listModels(provider) {
  const key = process.env[KEYS[provider]];
  try {
    if (provider === "groq") {
      const r = await fetch(`${BASES.groq()}/models`, { headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) return { rejected: r.status };
      if (!r.ok) return null;
      return { ids: ((await r.json()).data || []).map((m) => m.id) };
    }
    const r = await fetch(`${BASES.gemini()}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000) });
    if (r.status === 400 || r.status === 401 || r.status === 403) return { rejected: r.status };
    if (!r.ok) return null;
    return { ids: ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name).replace(/^models\//, "")) };
  } catch { return null; }
}

function limitsText(rl) {
  if (!rl || !Object.keys(rl).length) return "";
  const g = (k) => rl[k];
  const parts = [];
  if (g("x-ratelimit-remaining-requests") !== undefined) parts.push(`requests ${g("x-ratelimit-remaining-requests")} left of ${g("x-ratelimit-limit-requests")}${g("x-ratelimit-reset-requests") ? " (resets " + g("x-ratelimit-reset-requests") + ")" : ""}`);
  if (g("x-ratelimit-remaining-tokens") !== undefined) parts.push(`tokens ${g("x-ratelimit-remaining-tokens")} left of ${g("x-ratelimit-limit-tokens")}${g("x-ratelimit-reset-tokens") ? " (resets " + g("x-ratelimit-reset-tokens") + ")" : ""}`);
  return parts.join("; ");
}

async function benchOne(step, opts, listing) {
  const id = `${step.p}:${step.m}`;
  const res = { id, provider: step.p, ok: false, lat: [], quality: 0, total: 0, hardFails: [], softMisses: [], reviewJson: 0, reviewTotal: 0, tokps: [], rl: null, error: "" };
  if (listing?.ids && !listing.ids.includes(step.m)) { res.error = "this model id is not on your account's list (retired or misspelled)"; return res; }
  const timeout = Math.max(opts.siteTimeoutMs * 3, 20000);
  const pace = async () => sleep(opts.gapMs);
  const withRetry = async (c) => {
    let r = await ask(step, c, timeout);
    if (r.status === 429) { const wait = Math.min(Number(r.rl?.["retry-after"]) || 15, 20) * 1000; await sleep(opts.gapMs ? wait : 0); r = await ask(step, c, timeout); if (r.status === 429) r.error = "rate limited (HTTP 429) even after waiting"; }
    return r;
  };
  // speed: three tiny calls
  const ping = clean({ kind: "chat", persona: { name: "Check", role: "Tester", company: "Test Co", field: "testing", culture: "plain" }, context: [], history: [], message: "Reply with the single word: ok", extra: { user: "tester" } });
  for (let i = 0; i < 3; i++) {
    const r = await withRetry(ping); res.rl = r.rl && Object.keys(r.rl).length ? r.rl : res.rl;
    if (r.ok) res.lat.push(r.ms); else if (!res.lat.length && i === 2) { res.error = r.error; return res; }
    await pace();
  }
  if (!res.lat.length) { res.error = "no answer to a simple question"; return res; }
  res.ok = true;
  // quality: the site's own test cases, asked straight to the model
  for (const cs of CASES.filter((x) => !x.siteOnly)) {
    const c = clean(cs.body);
    const r = await withRetry(c); res.rl = r.rl && Object.keys(r.rl).length ? r.rl : res.rl;
    res.total++;
    if (c.kind === "review") res.reviewTotal++;
    if (!r.ok) { (cs.soft ? res.softMisses : res.hardFails).push(`${cs.name} (${r.error})`); await pace(); continue; }
    res.lat.push(r.ms);
    if (r.outTokens && r.ms) res.tokps.push(r.outTokens / (r.ms / 1000));
    let j;
    if (c.kind === "review") {
      const m = String(r.raw).match(/\{[\s\S]*\}/); let valid = false;
      if (m) { try { valid = typeof JSON.parse(m[0]).feedback === "string"; } catch { /* not json */ } }
      if (valid) res.reviewJson++;
      j = parseReview(r.raw);
    } else j = { text: tidy(r.raw) };
    const [ok] = cs.test(j);
    if (ok) res.quality++; else (cs.soft ? res.softMisses : res.hardFails).push(cs.name);
    await pace();
  }
  return res;
}

// Pick the order: FAST wants quick and reliable, SMART wants best quality and clean JSON. Mix providers so one outage does not stop everything.
function recommend(results) {
  const mix = (sorted) => {
    const out = []; const seen = new Set();
    for (const r of sorted) if (!seen.has(r.provider)) { out.push(r); seen.add(r.provider); }
    for (const r of sorted) if (!out.includes(r)) out.push(r);
    // best overall first, then different provider, then the rest
    const best = sorted[0]; return [best, ...out.filter((x) => x !== best)].filter(Boolean).slice(0, 3);
  };
  const fast = results.filter((r) => r.eligible).sort((a, b) => a.median - b.median);
  const smart = results.filter((r) => r.eligible && r.reviewJson === r.reviewTotal).sort((a, b) => b.quality - a.quality || a.median - b.median);
  const tie = smart.length > 1 && smart[0].quality === smart[1].quality;
  return { fast: mix(fast).map((r) => r.id), smart: mix(smart).map((r) => r.id), tie };
}

export async function runBench(ctx) {
  const R = ctx.results;
  R.section("Models, tested directly (your keys, your provider quota)");
  const wanted = String(ctx.models || process.env.BENCH_MODELS || DEFAULT_MODELS).split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(":"); return { p: x.slice(0, i), m: x.slice(i + 1) }; }).filter((x) => KEYS[x.p] && x.m);
  if (!wanted.length) return R.add("FAIL", "Benchmark models", "use --models groq:model-id,gemini:model-id");
  const providers = [...new Set(wanted.map((w) => w.p))];
  if (!providers.some((p) => process.env[KEYS[p]])) return R.add("SKIP", "Direct test with your keys", "no keys given, so it was skipped. The scorecards above already judge the models through the site. Keys only add the exact names, the provider limits and a suggested order.");
  const listings = {}, usable = [];
  for (const p of providers) {
    if (!process.env[KEYS[p]]) { R.add("SKIP", `${p}: key`, `set ${KEYS[p]} in this window first (it stays on your computer)`); continue; }
    const l = await listModels(p);
    if (l?.rejected) { R.add("FAIL", `${p}: API key is accepted`, `${p} rejected the key (HTTP ${l.rejected}). On the site this means ${p} never answers. Make a new key.`); continue; }
    R.add("PASS", `${p}: API key is accepted`, l?.ids ? `${l.ids.length} models available to this key` : "key works (the model list could not be read)");
    listings[p] = l; usable.push(p);
  }
  const todo = wanted.filter((w) => usable.includes(w.p));
  const results = await Promise.all(todo.map((s) => benchOne(s, ctx.bench, listings[s.p])));
  for (const r of results) {
    if (!r.ok) { R.add("FAIL", `Model ${r.id}`, r.error); continue; }
    r.median = median(r.lat); r.p95v = p95(r.lat);
    const slow = r.p95v > ctx.bench.siteTimeoutMs;
    r.eligible = !r.hardFails.length && !slow;
    const tps = r.tokps.length ? `~${Math.round(median(r.tokps))} tokens/s` : "";
    const bits = [`median ${r.median} ms`, `slowest ${r.p95v} ms`, tps, `quality ${r.quality}/${r.total}`, r.reviewTotal ? `review JSON ${r.reviewJson}/${r.reviewTotal}` : ""].filter(Boolean).join(", ");
    const notes = [];
    if (r.hardFails.length) notes.push("FAILED: " + r.hardFails.join("; "));
    if (slow) notes.push(`slower than the site's ${ctx.bench.siteTimeoutMs / 1000}s limit, the site would skip it`);
    if (r.softMisses.length) notes.push("weaker on: " + r.softMisses.join("; "));
    R.add(r.hardFails.length || slow ? "WARN" : "PASS", `Model ${r.id}`, [bits, ...notes].join(". "));
    const lim = limitsText(r.rl);
    if (lim) R.add("PASS", `Limits reported by ${r.provider} for ${r.id.split(":")[1]}`, lim);
  }
  const rec = recommend(results.filter((r) => r.ok));
  if (!rec.fast.length && !rec.smart.length) return R.add("WARN", "Suggested order", "no model passed every hard check, so there is nothing safe to suggest");
  R.add("PASS", "Suggested AI_FAST (chat, email, meeting)", rec.fast.join(","));
  R.add("PASS", "Suggested AI_SMART (review, hint)", rec.smart.join(","));
  if (rec.tie) R.add("SKIP", "Note on AI_SMART", "the top models tied on quality and this short test cannot tell how deeply they reason. For review and hint, a larger model is usually the safer first pick, so use your judgement on the tie.");
  R.add("SKIP", "How to use the suggestion", "compare with your Vercel values (the tool cannot read them). If different, update AI_FAST / AI_SMART, Redeploy, then rerun the check. This is one short run: rerun once before trusting a close call.");
  ctx.benchResults = results;
}
