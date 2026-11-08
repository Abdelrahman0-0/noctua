// Proves the AI judging works without knowing the models: it must pass a healthy site and catch canned,
// looping, slow and failing AI, wait out the site's rest period, and stay inside the site's rate limit.
import { startMock } from "./mock/server.mjs";
import { run } from "./check.mjs";

let failed = 0;
const expect = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} deep: ${msg}`); if (!ok) failed++; };
const go = async (port, mock, opts = {}) => {
  const srv = await startMock({ port, ...mock });
  const r = await run({ site: `http://localhost:${port}`, apiOnly: true, gap: 0, quiet: true, rateLimit: 1000, out: `reports/selftest-deep-${port}`, ...opts });
  srv.close(); return r.results.rows;
};
const row = (rows, re) => rows.find((r) => re.test(r.name));
const level = (rows, re) => row(rows, re)?.level;

console.log("\n--- healthy site, with a real rate limit (8 requests per 3s) ---");
let t0 = Date.now();
let rows = await go(4181, { rateLimit: { n: 8, ms: 3000 } }, { rateLimit: 8, rateWindow: 3000, rateMargin: 1, token: "mock-admin-token-1234567890" });
const ai = rows.filter((r) => /^(chat|meeting|mail|hint|review|limits):/.test(r.name));
expect(rows.filter((r) => r.level === "FAIL").length === 0, `no FAIL on a healthy site (${rows.filter((r) => r.level === "FAIL").map((r) => r.name).join(", ")})`);
expect(ai.length >= 25, `all the AI questions were asked (${ai.length})`);
expect(!rows.some((r) => /HTTP 429/.test(r.detail)), `the run stayed inside the rate limit (took ${Math.round((Date.now() - t0) / 1000)}s because it paced itself)`);
expect(level(rows, /gives the right answer every time/) === "PASS", "consistency over 3 tries");
expect(level(rows, /Different questions get different answers/) === "PASS", "answers are not canned");
expect(level(rows, /answers look sane/) === "PASS", "all answers look sane");
expect(level(rows, /No sign of a model timing out/) === "PASS", "no sign of a timeout");
expect(level(rows, /Overall verdict/) === "PASS", "overall verdict is PASS");
expect(level(rows, /Scorecard: FAST models/) === "PASS" && level(rows, /Scorecard: SMART models/) === "PASS" && /right answers 1\d\/1\d|right answers \d+\/\d+/.test(row(rows, /Scorecard: FAST/)?.detail || ""), "each group of models gets a scorecard, with no keys");

console.log("\n--- light mode ---");
rows = await go(4182, {}, { light: true });
expect(!rows.some((r) => /fresh fact|gives the right answer every time/.test(r.name)) && rows.some((r) => /Overall verdict/.test(r.name)), "light mode skips the deep questions but still judges");

console.log("\n--- canned AI (same answer to everything) ---");
rows = await go(4183, { bug: "canned" });
expect(level(rows, /reads a fresh fact from the files \(time\)/) === "FAIL" && level(rows, /codeword/) === "FAIL", "fresh-fact questions fail");
expect(level(rows, /remembers the conversation/) === "FAIL", "memory question fails");
expect(level(rows, /Different questions get different answers/) === "FAIL", "identical answers are called canned");
expect(level(rows, /Overall verdict/) === "FAIL" && level(rows, /Scorecard: FAST models/) === "FAIL", "overall verdict and the FAST scorecard are FAIL");

console.log("\n--- direct test requested but no keys ---");
delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY;
rows = await go(4187, {}, { bench: true, light: true });
expect(level(rows, /Direct test with your keys/) === "SKIP" && !rows.some((r) => /Suggested/.test(r.name)) && !rows.some((r) => /key/i.test(r.name) && r.level === "FAIL"), "asking for the direct test without keys is a calm skip, never an error");

console.log("\n--- looping AI ---");
rows = await go(4184, { bug: "ramble" });
expect(level(rows, /Answers that look like nonsense/) === "FAIL" && /loops/.test(row(rows, /Answers that look like nonsense/)?.detail || ""), "loops are caught");

console.log("\n--- a model dies, then the site rests ---");
rows = await go(4185, { bug: "resting" }, { restWait: 1500 });
expect(level(rows, /^meeting: responds to the blocker/) === "FAIL", "the real failure is reported");
expect(level(rows, /^mail: writes a proper reply/) === "PASS" && level(rows, /^hint: guides/) === "PASS", "tests after it recovered instead of failing as a cascade");
expect(level(rows, /Model failing on the site: gemini:gemini-mock-lite/) === "FAIL" && /6 seconds/.test(row(rows, /gemini:gemini-mock-lite/)?.detail || ""), "the slow model is named from the server's own message");
expect(level(rows, /Model failing on the site: groq:llama-mock-70b/) === "FAIL" && /404/.test(row(rows, /llama-mock-70b/)?.detail || ""), "the model that returns 404 is named");
expect(level(rows, /rests its models/) === "WARN", "the resting period is explained");

console.log("\n--- slow AI ---");
rows = await go(4186, { bug: "slow" }, { slowMs: 500 });
expect(level(rows, /slower than the site's 6s per-model limit/) === "FAIL", "answers over the limit are flagged as a sign of a failing model");

console.log(failed ? `\nDeep selftest FAILED (${failed})` : "\nDeep selftest passed.");
process.exit(failed ? 1 : 0);
