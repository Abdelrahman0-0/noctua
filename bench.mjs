#!/usr/bin/env node
// Tests the AI models directly (no site needed): is the key good, does the model exist, how fast, how good, which order to use.
//   $env:GROQ_API_KEY="..."; $env:GEMINI_API_KEY="..."; node bench.mjs [--models groq:id,gemini:id]
// The keys are read from this window only. They are never printed or saved. The calls use your own provider quota.
import path from "node:path";
import { Results, parseArgs, emit, JSONL } from "./lib/util.mjs";
import { runBench, DEFAULT_MODELS } from "./lib/bench.mjs";
import { writeReport } from "./lib/report.mjs";

const a = parseArgs(process.argv.slice(2));
if (a.help) {
  console.log(`Model benchmark\n\nUsage: node bench.mjs [--models ${DEFAULT_MODELS}] [--bench-gap 2200] [--site-timeout 6000] [--out dir]\n\nNeeds GROQ_API_KEY and/or GEMINI_API_KEY in the environment.\nUses about 13 calls per model. Exit code 1 if a key or model is broken.`);
  process.exit(0);
}
const R = new Results();
const ctx = { results: R, models: a.models || "", bench: { siteTimeoutMs: Number(a["site-timeout"] ?? 6000), gapMs: Number(a["bench-gap"] ?? 2200) } };
console.log("\nBenchmarking models directly (keys stay on this computer)\n");
await runBench(ctx);
const out = a.out || path.resolve("reports", "bench-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
const s = writeReport(out, "models (direct)", R);
if (JSONL) emit({ type: "done", summary: s });
console.log(`\n${s.pass} ok, ${s.warn} warnings, ${s.fail} failed, ${s.skip} notes.\nReport: ${path.join(out, "report.html")}`);
process.exit(s.fail ? 1 : 0);
