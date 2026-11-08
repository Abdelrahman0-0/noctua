// Proves the checker works: a healthy fake site must give no FAIL, a broken fake site must be caught.
import { startMock } from "./mock/server.mjs";
import { run } from "./check.mjs";
import { startProviders } from "./mock/providers.mjs";
import { Results } from "./lib/util.mjs";
import { runBench } from "./lib/bench.mjs";
import { writeReport } from "./lib/report.mjs";
import fs from "node:fs";

const TOKEN = "mock-admin-token-1234567890";
const healthy = await startMock({ port: 4173, bug: false });
const broken = await startMock({ port: 4174, bug: true });
let failed = 0;
const expect = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} selftest: ${msg}`); if (!ok) failed++; };

console.log("\n=== Healthy site: the checker should report no FAIL ===");
const a = await run({ site: "http://localhost:4173", token: TOKEN, gap: 0, rateLimit: 1000, expect: "groq", out: "reports/selftest-healthy", mobileClicks: 10 });
expect(a.summary.fail === 0, `healthy site has 0 FAIL (got ${a.summary.fail})`);
expect(a.results.rows.some((r) => r.name.startsWith("Chat from the screen") && r.level === "PASS"), "chat through the UI was tested and passed");
expect(a.results.rows.some((r) => r.name === "Upload a .pdf file" && r.level === "PASS"), "pdf upload was tested");
expect(a.results.rows.some((r) => /^AI error: HTTP 500/.test(r.name) && r.level === "PASS"), "AI outage (500) was simulated and survived");
expect(a.results.rows.some((r) => /Ask for a hint/.test(r.name) || /AI calls made by the UI: 2/.test(r.name)), "the hint button inside the Tasks screen was clicked");
expect(a.results.rows.some((r) => r.name === "Which model answered" && r.level === "PASS" && /groq:llama-3.1-8b-instant/.test(r.detail)), "the site's answering model was read and matches the expected provider");
expect(a.results.rows.some((r) => /Delete account/.test(r.name)) === false, "the 'Delete account' button was not clicked");

console.log("\n=== Broken site: the checker must catch the faults ===");
const b = await run({ site: "http://localhost:4174", token: TOKEN, gap: 0, rateLimit: 1000, quick: true, expect: "groq", restMs: 50, out: "reports/selftest-broken", quiet: false });
const failRows = b.results.rows.filter((r) => r.level === "FAIL");
const has = (re) => failRows.some((r) => re.test(r.name + " " + r.detail));
expect(has(/invent/), "caught the invented salary");
expect(has(/Admin endpoint refuses no token/), "caught the open admin endpoint");
expect(has(/Click "Tasks"/) || has(/JavaScript error/), "caught the JavaScript error when opening Tasks");
expect(has(/broken images/i), "caught the broken image");
expect(has(/hint/i), "caught the failing hint API");
expect(has(/AI calls made by the UI/), "caught the failing hint when the UI itself asked for it");
expect(b.results.rows.some((r) => r.name === "Which model answered" && r.level === "WARN" && /fallback/.test(r.detail)), "noticed that a fallback model (not groq) is answering");

console.log("\n=== Direct model benchmark against fake Groq and Gemini ===");
const prov = await startProviders({ port: 4180 });
Object.assign(process.env, { GROQ_API_KEY: "gk-test-secret", GEMINI_API_KEY: "mk-test-secret", GROQ_BASE: "http://localhost:4180/groq", GEMINI_BASE: "http://localhost:4180/gemini" });
const R = new Results();
const bctx = { results: R, models: "groq:llama-3.1-8b-instant,groq:llama-3.3-70b-versatile,groq:mock-bad,groq:mock-slow,groq:retired-model,gemini:gemini-mock-lite", bench: { siteTimeoutMs: 500, gapMs: 0 } };
await runBench(bctx);
const row = (re) => R.rows.find((r) => re.test(r.name));
expect(row(/Model groq:llama-3.1-8b-instant/)?.level === "PASS" && row(/Model groq:llama-3.3-70b-versatile/)?.level === "PASS" && row(/Model gemini:gemini-mock-lite/)?.level === "PASS", "good models pass");
expect(row(/Model groq:mock-bad/)?.level === "WARN" && /salary/.test(row(/Model groq:mock-bad/)?.detail || ""), "a model that invents a salary is flagged");
expect(row(/Model groq:mock-slow/)?.level === "WARN" && /would skip it/.test(row(/Model groq:mock-slow/)?.detail || ""), "a model slower than the site's limit is flagged");
expect(row(/Model groq:retired-model/)?.level === "FAIL" && /not on your account/.test(row(/Model groq:retired-model/)?.detail || ""), "a retired model id is caught");
expect(/requests 14390 left of 14400/.test(row(/Limits reported by groq/)?.detail || ""), "the provider's real limits are shown");
const fastRow = row(/Suggested AI_FAST/)?.detail || "", smartRow = row(/Suggested AI_SMART/)?.detail || "";
expect(fastRow.startsWith("groq:llama-3.1-8b-instant") && !/mock-bad|mock-slow|retired/.test(fastRow + smartRow), `suggested FAST order is sensible (${fastRow})`);
expect(/gemini:gemini-mock-lite/.test(fastRow) && /gemini:gemini-mock-lite/.test(smartRow), "suggestion mixes in the other provider as a safety net");
writeReport("reports/selftest-bench", "bench", R);
expect(!fs.readFileSync("reports/selftest-bench/report.json", "utf8").includes("gk-test-secret"), "the API key is not in the saved report");
process.env.GROQ_API_KEY = "wrong-key";
const R2 = new Results(true);
await runBench({ results: R2, models: "groq:llama-3.1-8b-instant", bench: { siteTimeoutMs: 500, gapMs: 0 } });
expect(R2.rows.some((r) => r.level === "FAIL" && /rejected the key/.test(r.detail)), "a wrong key is reported clearly");

healthy.close(); broken.close(); prov.close();
console.log(failed ? `\nSelftest FAILED (${failed})` : "\nSelftest passed: the checker detects what it should.");
process.exit(failed ? 1 : 0);
