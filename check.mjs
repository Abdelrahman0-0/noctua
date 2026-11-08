#!/usr/bin/env node
// Noctua: a standalone black-box checker for a website and its AI features. It only talks to the public address, it needs none of the site's code.
//   node check.mjs https://your-site.vercel.app [--token ADMIN_TOKEN] [options]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Results, parseArgs, emit, JSONL } from "./lib/util.mjs";
import { siteChecks } from "./lib/site-checks.mjs";
import { apiChecks } from "./lib/api-checks.mjs";
import { uiChecks } from "./lib/ui-checks.mjs";
import { runBench } from "./lib/bench.mjs";
import { makePacer } from "./lib/pacer.mjs";
import { sanity } from "./lib/quality.mjs";
import { writeReport } from "./lib/report.mjs";

export const HELP = `Noctua: sees what hides in the dark

Usage:
  node check.mjs <site-url> [options]

Options:
  --token <t>        AI_ADMIN_TOKEN, enables the one-by-one model test (or env ADMIN_TOKEN)
  --api-only         only site basics and the API (no browser)
  --ui-only          only site basics and the browser (no AI API calls)
  --no-ui            same as --api-only
  --quick            browser: desktop only, fewer clicks
  --headed           show the browser window while it runs
  --max-clicks <n>   desktop click limit (default 40)
  --ai-budget <n>    hard cap on real AI calls in the whole run (default 90). The run waits by itself when the site's limit (30 per 10 min) is reached
  --gap <ms>         wait between AI calls (default 1200)
  --light            fewer AI questions (skips the deep checks: fresh facts, memory, consistency)
  --slow-ms <ms>     an answer slower than this suggests a backup model answered (default 6000)
  --bench            also test the models directly with GROQ_API_KEY / GEMINI_API_KEY from this computer
  --models <list>    models for --bench, e.g. groq:llama-3.1-8b-instant,gemini:gemini-3.5-flash-lite
  --expect <name>    provider that should answer on the site (groq or gemini), warns if another one does
  --config <file>    config file (default ./checker.config.json)
  --out <dir>        report folder (default ./reports/<time>)
Exit code: 0 = no FAIL, 1 = at least one FAIL, 2 = bad usage.`;

export async function run(opts) {
  const site = String(opts.site || "").replace(/\/+$/, "");
  const R = opts.results || new Results(opts.quiet);
  let config = {};
  const cfgPath = opts.config || path.resolve("checker.config.json");
  if (fs.existsSync(cfgPath)) { try { config = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) { console.log(`Cannot read ${cfgPath}: ${e.message}`); } }
  const out = opts.out || path.resolve("reports", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  const ctx = {
    site, token: opts.token || "", results: R, config, headed: !!opts.headed, quick: !!opts.quick,
    gapMs: Number(opts.gap ?? 1200), aiBudget: Number(opts.aiBudget ?? 90), maxProbes: 3, light: !!opts.light, slowMs: Number(opts.slowMs ?? 6000),
    maxClicks: Number(opts.maxClicks ?? (opts.quick ? 15 : 40)), mobileClicks: Number(opts.mobileClicks ?? 15),
    state: { aiCalls: 0, limited: false, uiReplies: [] }, shotDir: path.join(out, "screenshots"),
    expect: opts.expect || "", models: opts.models || "", restMs: opts.restMs,
    bench: { siteTimeoutMs: Number(opts.siteTimeout ?? 6000), gapMs: Number(opts.benchGap ?? 2200) },
  };
  ctx.pacer = makePacer(R, ctx.state, { limit: Number(opts.rateLimit ?? 30), windowMs: Number(opts.rateWindow ?? 600000), margin: Number(opts.rateMargin ?? 2), restWaitMs: Number(opts.restWait ?? 65000) });
  if (!opts.quiet) console.log(`\nChecking ${site}\n`);
  const reachable = await siteChecks(ctx);
  if (reachable) {
    if (!opts.uiOnly) await apiChecks(ctx);
    if (!opts.apiOnly && !opts.noUi) await uiChecks(ctx);
    if (ctx.state.uiReplies.length) {
      R.section("AI answers seen in the browser");
      const bad = []; for (const t of ctx.state.uiReplies) { const q = sanity(t, "chat"); bad.push(...q.hard.map((m) => `${m}`)); }
      R.add(bad.length ? "FAIL" : "PASS", `${ctx.state.uiReplies.length} answer(s) shown to the user look sane`, bad.slice(0, 3).join(" | "));
    }
  }
  if (opts.bench) await runBench(ctx);
  const summary = writeReport(out, site, R);
  if (JSONL && !opts.quiet) emit({ type: "done", summary, aiCalls: ctx.state.aiCalls });
  if (!opts.quiet) {
    console.log(`\n${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary.skip} skipped in ${summary.seconds}s. Real AI calls used: ${ctx.state.aiCalls}.`);
    console.log(`Report: ${path.join(out, "report.html")}`);
    if (summary.fail) console.log("\nFix the FAIL lines first. The reason is printed after the arrow, and failed steps have a screenshot in the report.");
    else if (summary.warn) console.log("\nWarnings are quality or polish issues, not breakage. Rerun once to see if they repeat.");
  }
  return { results: R, summary, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const site = a._[0] || process.env.SITE;
  if (!site || a.help) { console.log(HELP); process.exit(site || a.help ? 0 : 2); }
  const { summary } = await run({
    site, token: a.token || process.env.ADMIN_TOKEN, apiOnly: a["api-only"], uiOnly: a["ui-only"], noUi: a["no-ui"], quick: a.quick, headed: a.headed,
    maxClicks: a["max-clicks"], aiBudget: a["ai-budget"], gap: a.gap, light: a.light, slowMs: a["slow-ms"], restWait: a["rest-wait"], rateLimit: a["rate-limit"], rateWindow: a["rate-window"], rateMargin: a["rate-margin"], config: a.config, out: a.out,
    bench: a.bench, models: a.models, expect: a.expect,
  });
  process.exit(summary.fail ? 1 : 0);
}
