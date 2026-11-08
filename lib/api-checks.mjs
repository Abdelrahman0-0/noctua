// Checks the site from outside, like a user: input rules, security, then real AI work.
// It does not need to know which models the site uses. It judges the ANSWERS: right, fresh, consistent, sane, fast.
import { sleep } from "./util.mjs";
import { CASES, base, deepCases, REPEATS } from "./cases.mjs";
import { sanity, jaccard, parseFailures, explainWhy, median, pct } from "./quality.mjs";

const FAST = new Set(["chat", "mail", "meeting"]);

export async function apiChecks(ctx) {
  const { site, token, results: R, state, pacer } = ctx;
  const slowMs = ctx.slowMs || 6000;
  R.section("API (/api/ai)");
  const lane = () => ({ total: 0, right: 0, errors: 0, hard: [], soft: [] });
  const stats = { lanes: { fast: lane(), smart: lane() }, ok: 0, fail: 0, fast: [], smart: [], slow: 0, replies: [], failures: new Map(), cascades: 0, answered: new Map() };

  async function post(body) {
    const t0 = Date.now();
    const r = await fetch(site + "/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    return { status: r.status, j, ms: Date.now() - t0, model: r.headers.get("x-ai-model") || "" };
  }
  const reasonOf = (r) => String(r.j?.reason || r.j?.error || "");
  const learn = (r) => { if (r.status === 502) for (const f of parseFailures(reasonOf(r))) stats.failures.set(f.id, f.why); };

  // One AI request that survives the site's own protections: waits for the rate limit, and waits out the
  // "resting" minute after a failure, so one problem is reported once instead of failing every test after it.
  async function call(body) {
    await pacer.pace();
    let r = await post(body); pacer.note(); learn(r);
    if (r.status === 429) {
      pacer.reset();
      await pacer.wait(pacer.windowMs + 2000, "The site's AI limit was reached, waiting for it to reset");
      r = await post(body); pacer.note(); learn(r);
    }
    if (r.status === 502 && /resting/i.test(reasonOf(r))) {
      stats.cascades++;
      await pacer.wait(pacer.restWaitMs, "The AI models are resting after a failure, waiting for them to come back");
      r = await post(body); pacer.note(); learn(r);
    }
    return r;
  }

  // ai(name, soft, request, test, opts): test(reply) returns [ok, detail]. soft = WARN instead of FAIL when the answer is off.
  async function ai(name, soft, body, test, opts = {}) {
    if (state.aiCalls >= ctx.aiBudget) { R.add("SKIP", name, "AI call budget used up (--ai-budget)"); return null; }
    const L = stats.lanes[FAST.has(body.kind) ? "fast" : "smart"];
    let r; try { r = await call(body); } catch (e) { stats.fail++; L.total++; L.errors++; R.add("FAIL", name, "request failed: " + e.message); return false; }
    if (r.status !== 200) { stats.fail++; L.total++; L.errors++; R.add(r.status === 429 ? "WARN" : "FAIL", name, `HTTP ${r.status} ${reasonOf(r)}`.trim()); return false; }
    stats.ok++;
    (FAST.has(body.kind) ? stats.fast : stats.smart).push(r.ms);
    if (r.ms > slowMs) stats.slow++;
    const text = r.j?.text ?? "";
    stats.replies.push({ kind: body.kind, name, text, repeat: !!opts.repeat, fact: opts.fact || "" });
    const who = r.j?.model || r.model; if (who) stats.answered.set(who, (stats.answered.get(who) || 0) + 1);
    const [ok, detail] = test(r.j || {}, r.ms, r);
    L.total++; if (ok) L.right++; else (soft ? L.soft : L.hard).push(name);
    const slow = r.ms > slowMs ? ` (took ${(r.ms / 1000).toFixed(1)}s, over the site's 6s per-model limit)` : "";
    R.add(ok ? (slow ? "WARN" : "PASS") : soft ? "WARN" : "FAIL", name, `${detail}${slow}`);
    await sleep(ctx.gapMs);
    return ok;
  }

  // 1. The door (no model is called)
  try {
    const r = await fetch(site + "/api/ai", { signal: AbortSignal.timeout(20000) });
    R.add(r.status === 405 ? "PASS" : "FAIL", "API exists and refuses GET", r.status === 404 ? "HTTP 404: the API is not deployed (check Root Directory and that api/ai.js is in the repo)" : `HTTP ${r.status}`);
  } catch (e) { R.add("FAIL", "API is reachable", e.message); return; }
  for (const [name, body, code] of [["Rejects unknown kind", { ...base, kind: "hack", message: "hi" }, 400], ["Rejects missing persona", { kind: "chat", message: "hi" }, 400], ["Rejects empty message", { ...base, kind: "chat", message: "" }, 400], ["Rejects broken JSON", "{not json", 400]]) {
    try { const r = await post(body); pacer.note(); R.add(r.status === code ? "PASS" : "FAIL", name, `HTTP ${r.status}`); } catch (e) { R.add("FAIL", name, e.message); }
  }

  // 2. The admin endpoint must be closed to strangers
  for (const [name, headers] of [["Admin endpoint refuses no token", {}], ["Admin endpoint refuses a wrong token", { Authorization: "Bearer definitely-wrong-token-123456" }]]) {
    try { const r = await fetch(site + "/api/ai-check", { headers, signal: AbortSignal.timeout(20000) }); R.add(r.status === 401 || r.status === 404 ? "PASS" : "FAIL", name, r.status === 200 ? "HTTP 200: model details are open to anyone, set AI_ADMIN_TOKEN or remove the endpoint" : `HTTP ${r.status}`); }
    catch (e) { R.add("FAIL", name, e.message); }
  }

  // 3. Every model one by one (needs the admin token)
  if (!token) R.add("SKIP", "Each model tested one by one", "pass --token and set AI_ADMIN_TOKEN in Vercel to enable");
  else {
    try {
      const r = await fetch(site + "/api/ai-check", { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(60000) });
      if (r.status !== 200) R.add("FAIL", "Model health check", `HTTP ${r.status} (is AI_ADMIN_TOKEN set in Vercel, same value, and redeployed?)`);
      else {
        const j = await r.json();
        R.add(j.keys.groq || j.keys.gemini ? "PASS" : "FAIL", "At least one provider key is set", `groq=${j.keys.groq} gemini=${j.keys.gemini}`);
        if (!j.results.length) R.add("FAIL", "At least one model is configured", "no models in any lane");
        for (const m of j.results) R.add(m.ok ? (m.ms > 8000 ? "WARN" : "PASS") : "FAIL", `Model ${m.id}  (${m.kinds.join(", ")})`, m.ok ? `${m.ms} ms` : `error ${m.error}`);
        for (const k of ["chat", "review"]) R.add((j.lanes[k] || []).length ? "PASS" : "FAIL", `Lane for ${k} has models`, (j.lanes[k] || []).join(" > "));
      }
    } catch (e) { R.add("FAIL", "Model health check", e.message); }
  }

  // 4. Every kind of work, as the site sends it
  const res = {};
  for (const c of CASES) res[c.name] = await ai(c.name, c.soft, c.body, c.test, { fact: c.fact });

  // 5. Deep checks: fresh facts, memory, persona, consistency
  if (!ctx.light) {
    R.section("AI answers: fresh facts, memory, consistency");
    for (const c of deepCases()) await ai(c.name, c.soft, c.body, c.test, { fact: c.fact });
    const rel = REPEATS.release, rev = REPEATS.goodReview;
    const tries = [res[rel.name]];
    for (let i = 2; i <= 3; i++) tries.push(await ai(`${rel.name} (try ${i} of 3)`, rel.soft, rel.body, rel.test, { repeat: true }));
    const okRel = tries.filter((x) => x === true).length, nRel = tries.filter((x) => x !== null).length;
    if (nRel === 3) R.add(okRel === 3 ? "PASS" : okRel === 2 ? "WARN" : "FAIL", "chat: gives the right answer every time", `${okRel} of 3 tries were right`);
    const revTries = [res[rev.name], await ai(`${rev.name} (second try)`, rev.soft, rev.body, rev.test, { repeat: true })];
    if (!revTries.includes(null)) R.add(revTries.every(Boolean) ? "PASS" : revTries.some(Boolean) ? "WARN" : "FAIL", "review: same verdict for the same answer", `${revTries.filter(Boolean).length} of 2 tries accepted it`);
  }

  // 6. What all those answers say about the AI, judged from the outside
  R.section("AI health, judged from the outside");
  const total = stats.ok + stats.fail;
  if (total) {
    const rate = stats.ok / total;
    R.add(rate === 1 ? "PASS" : rate >= 0.9 ? "WARN" : "FAIL", "AI requests answered", `${stats.ok} of ${total} (${Math.round(rate * 100)}%)`);
  }
  for (const [id, why] of stats.failures) R.add("FAIL", `Model failing on the site: ${id}`, explainWhy(why));
  if (stats.cascades) R.add("WARN", "After a failure the site rests its models", `${stats.cascades} time(s) every request failed for about a minute after one model problem. The test waited and went on. Real users get the built-in replies during that minute.`);
  // One scorecard per group of models. The site sends chat, mail and meeting to its FAST models and hint and review to its SMART models.
  for (const [label, key, arr] of [["FAST models (chat, mail, meeting)", "fast", stats.fast], ["SMART models (hint, review)", "smart", stats.smart]]) {
    const L = stats.lanes[key];
    if (!L.total) continue;
    const parts = [`right answers ${L.right}/${L.total}`];
    if (arr.length) parts.push(`median ${(median(arr) / 1000).toFixed(1)}s`, `slowest ${(Math.max(...arr) / 1000).toFixed(1)}s`);
    if (L.errors) parts.push(`${L.errors} request(s) failed`);
    if (L.hard.length) parts.push("wrong: " + L.hard.slice(0, 3).join("; "));
    if (L.soft.length) parts.push("weaker on: " + L.soft.slice(0, 3).join("; "));
    const slowHere = arr.length && pct(arr, 0.95) > slowMs;
    R.add(L.errors || L.hard.length ? "FAIL" : L.soft.length || slowHere ? "WARN" : "PASS", `Scorecard: ${label}`, parts.join(", "));
  }
  if (stats.slow) {
    const ratio = stats.slow / Math.max(1, stats.ok);
    R.add(ratio >= 0.5 ? "FAIL" : "WARN", "Answers slower than the site's 6s per-model limit", `${stats.slow} of ${stats.ok}. The site gives every model 6 seconds, so a slower answer means the first model timed out and a backup answered. The primary model may be too slow or failing.`);
  } else if (stats.ok) R.add("PASS", "No sign of a model timing out", "every answer came in under 6 seconds");

  const distinct = stats.replies.filter((x) => !x.repeat && FAST.has(x.kind) && x.text);
  if (distinct.length >= 4) {
    let max = 0, pair = "";
    for (let i = 0; i < distinct.length; i++) for (let k = i + 1; k < distinct.length; k++) { if (distinct[i].fact && distinct[i].fact === distinct[k].fact) continue; const sim = jaccard(distinct[i].text, distinct[k].text); if (sim > max) { max = sim; pair = `${distinct[i].name} / ${distinct[k].name}`; } }
    R.add(max >= 0.75 ? "FAIL" : max >= 0.6 ? "WARN" : "PASS", "Different questions get different answers (not canned)", max >= 0.6 ? `very similar answers (${max.toFixed(2)}) for: ${pair}` : `most similar pair: ${max.toFixed(2)} (1.00 would be identical)`);
  }
  const hard = [], soft = [];
  for (const x of stats.replies) { const q = sanity(x.text, x.kind); q.hard.forEach((m) => hard.push(`${x.name}: ${m}`)); q.soft.forEach((m) => soft.push(`${x.name}: ${m}`)); }
  if (stats.replies.length) {
    if (hard.length) R.add("FAIL", "Answers that look like nonsense", `${hard.length} problem(s): ${hard.slice(0, 3).join(" | ")}`);
    if (soft.length) R.add("WARN", "Answers worth a look", `${soft.length} note(s): ${soft.slice(0, 3).join(" | ")}`);
    if (!hard.length && !soft.length) R.add("PASS", `All ${stats.replies.length} answers look sane`, "no loops, gibberish, leaks, code dumps or cut-off sentences");
  }
  if (!stats.answered.size) R.add("SKIP", "Which model answered", "the server only returns text, so this cannot be known from outside (optional: see README)");
  else {
    const list = [...stats.answered].map(([m, n]) => `${m} x${n}`).join(", ");
    const expect = String(ctx.config.expectProvider || ctx.expect || "").toLowerCase();
    const off = expect ? [...stats.answered].filter(([m]) => !m.toLowerCase().startsWith(expect + ":")) : [];
    R.add(off.length ? "WARN" : "PASS", "Which model answered", off.length ? `${list}. Expected ${expect}, so a fallback is answering: check the ${expect} key and its limit` : list);
  }
  const mine = R.rows.filter((r) => r.group === "API (/api/ai)" || r.group.startsWith("AI "));
  const f = mine.filter((r) => r.level === "FAIL").length, w = mine.filter((r) => r.level === "WARN").length;
  if (total) R.add(f ? "FAIL" : w ? "WARN" : "PASS", "Overall verdict on the AI", f ? `${f} check(s) failed. Start with the failing models and the first FAIL above.` : w ? "the AI works, with warnings to look at" : "the AI answers correctly, freshly, consistently and quickly");
}
