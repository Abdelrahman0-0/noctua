// Real-browser checks (Playwright): load, click through everything, chat, upload, AI outage, custom flows.
import fs from "node:fs";
import path from "node:path";
import { sleep, short } from "./util.mjs";
import { makeSamples } from "./samples.mjs";
import { browserResponse, browserFailed } from "./traffic.mjs";

const DANGER = /(delete|remove|log ?out|sign ?out|reset|clear (all|data|history)|erase|unsubscribe|deactivate|checkout|pay now|حذف|مسح|تسجيل الخروج)/i;
const CHATISH = /(message|ask|type|write|reply|chat|say|question|رسال|اكتب|اسأل)/i;
const SEND_BTN = /^(send|ask|reply|post|إرسال|ارسال)\b/i;

// ---------- helpers ----------
function monitor(page, ctx, count = true) {
  const m = { pageErrors: [], consoleErrors: [], bad: [], failed: [], api: [] };
  const ignoreRe = (ctx.config.ignoreConsole || []).map((s) => new RegExp(s, "i"));
  const ignoreUrl = [/favicon\.ico/i, ...(ctx.config.ignoreUrls || []).map((s) => new RegExp(s, "i"))];
  page.on("pageerror", (e) => m.pageErrors.push(short(e.message || e)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (/Failed to load resource/i.test(t) || ignoreRe.some((r) => r.test(t))) return;
    m.consoleErrors.push(short(t));
  });
  page.on("response", (r) => {
    browserResponse(r);
    const u = r.url(), s = r.status();
    if (/\/api\/ai(\?|$)/.test(u)) {
      const entry = { status: s, reason: "" };
      m.api.push(entry); if (count) ctx.pacer.note();
      r.json().then((j) => { if (s !== 200) entry.reason = j.reason || j.error || ""; else if (count && j?.text) ctx.state.uiReplies.push(j.text); }).catch(() => {});
      return;
    }
    if (s >= 400 && !ignoreUrl.some((re) => re.test(u))) m.bad.push({ status: s, url: u.slice(0, 120) });
  });
  page.on("requestfailed", (r) => {
    const e = r.failure()?.errorText || "";
    if (!/ABORTED/i.test(e)) browserFailed(r);
    if (/ABORTED/i.test(e) || ignoreUrl.some((re) => re.test(r.url())) || /\/api\/ai/.test(r.url())) return;
    m.failed.push(`${r.url().slice(0, 100)} (${e})`);
  });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  return m;
}
const snap = (m) => ({ pe: m.pageErrors.length, ce: m.consoleErrors.length, bad: m.bad.length, failed: m.failed.length });
const delta = (m, s) => ({ pe: m.pageErrors.slice(s.pe), ce: m.consoleErrors.slice(s.ce), bad: m.bad.slice(s.bad), failed: m.failed.slice(s.failed) });
const isBlank = (page) => page.evaluate(() => (document.body?.innerText || "").trim().length < 5 && !document.querySelector("img,canvas,video,svg")).catch(() => true);
const bodyLen = (page) => page.evaluate(() => (document.body?.innerText || "").length).catch(() => 0);
const fingerprint = async (page) => page.url() + "|" + (await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 300)).catch(() => ""));

async function shot(page, ctx, name) {
  try {
    const file = `${name}.png`;
    await page.screenshot({ path: path.join(ctx.shotDir, file) });
    return "screenshots/" + file;
  } catch { return null; }
}

const collect = (page) => page.evaluate(() => {
  document.querySelectorAll("[data-mmc]").forEach((e) => e.removeAttribute("data-mmc"));
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none"; };
  const els = [...document.querySelectorAll("a[href],button,[role=button],[role=tab],[role=menuitem],[role=switch],summary")].filter(vis);
  return els.map((el, i) => {
    el.setAttribute("data-mmc", String(i));
    const text = (el.innerText || el.getAttribute("aria-label") || el.title || el.value || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const a = el.closest("a[href]"); let href = null, external = false;
    if (a) { href = a.href; try { external = new URL(href).host !== location.host; } catch { /* ignore */ } }
    return { i, text, tag: el.tagName.toLowerCase(), href, external, newTab: !!a && a.target === "_blank", disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true" };
  });
});


// Fill the forms on the current screen with believable test values, so flows like "apply to a company" or an
// interview can move forward. Passwords, payments and chat boxes are left alone.
const fillForms = (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none"; };
  const setVal = (el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  let n = 0;
  for (const el of document.querySelectorAll("input,textarea,select")) {
    if (!vis(el) || el.disabled || el.readOnly) continue;
    const meta = [el.placeholder, el.name, el.id, el.getAttribute("aria-label"), el.labels && el.labels[0] ? el.labels[0].innerText : ""].join(" ").toLowerCase();
    if (/card|cvv|iban|password|pass word|كلمة/.test(meta)) continue;
    if (el.tagName === "SELECT") { if (!el.value && el.options.length > 1) { el.selectedIndex = 1; el.dispatchEvent(new Event("change", { bubbles: true })); n++; } continue; }
    const type = (el.type || "text").toLowerCase();
    if (["password", "file", "hidden", "submit", "button", "range", "color", "date", "image", "reset"].includes(type)) continue;
    if (type === "checkbox") { if (/agree|accept|terms|consent|موافق/.test(meta) && !el.checked) { el.click(); n++; } continue; }
    if (type === "radio") { if (el.name && !document.querySelector(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`)) { el.click(); n++; } continue; }
    if (el.value || /message|ask|reply|chat|رسال/.test(meta)) continue;
    let v = "Test value";
    if (type === "email" || /email|mail|بريد/.test(meta)) v = "sara.test@example.com";
    else if (type === "number") v = "25";
    else if (type === "tel" || /phone|mobile|whatsapp/.test(meta)) v = "01000000000";
    else if (/name|اسم/.test(meta)) v = "Sara Ahmed";
    else if (/url|link|github|linkedin|portfolio/.test(meta)) v = "https://example.com";
    else if (el.tagName === "TEXTAREA" || /about|bio|summary|why|describe|answer|cover/.test(meta)) v = "I am a frontend developer who enjoys building clean, fast web apps with React and I learn quickly from feedback.";
    else if (/field|role|job|position|title|major|study|skill/.test(meta)) v = "Web Development";
    setVal(el, v); n++;
  }
  return n;
});

async function findChatInput(page) {
  const loc = page.locator("textarea:visible, input[type=text]:visible, input:not([type]):visible, input[type=search]:visible");
  const n = Math.min(await loc.count().catch(() => 0), 8);
  let fallback = null;
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const meta = await el.evaluate((e) => [e.placeholder, e.getAttribute("aria-label"), e.name, e.id].join(" ")).catch(() => "");
    const label = await el.evaluate((e) => e.placeholder || e.getAttribute("aria-label") || e.name || e.id || "").catch(() => "");
    if (CHATISH.test(meta)) return { el, label: short(label) || "message box" };
    if (!fallback && (await el.evaluate((e) => e.tagName).catch(() => "")) === "TEXTAREA") fallback = { el, label: "text area" };
  }
  return fallback;
}

// Type a message and wait for the site to react. Returns what happened.
async function sendMessage(page, m, input, message, waitMs = 30000) {
  const before = m.api.length, len0 = await bodyLen(page), s0 = snap(m), t0 = Date.now();
  await input.el.fill(message).catch(() => {});
  await input.el.press("Enter").catch(() => {});
  let sent = false;
  for (let i = 0; i < 6 && !sent; i++) { await sleep(250); sent = m.api.length > before; }
  if (!sent) {
    const btn = page.getByRole("button", { name: SEND_BTN }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 2000 }).catch(() => {});
  }
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    await sleep(300);
    if (m.api.length > before) break;
    if (Date.now() - t0 > 3500 && !sent && (await bodyLen(page)) > len0 + 5) break; // built-in reply appeared with no API call
  }
  await sleep(1200);
  const d = delta(m, s0);
  return { apiCalls: m.api.slice(before), grew: (await bodyLen(page)) - len0, ms: Date.now() - t0, pageErrors: d.pe };
}

// ---------- the audit of one viewport ----------
async function auditViewport(browser, vp, ctx) {
  const R = ctx.results;
  R.section(`Browser: ${vp.name} (${vp.width}x${vp.height})`);
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, acceptDownloads: true });
  const page = await context.newPage();
  context.on("page", (p) => p.close().catch(() => {}));
  const m = monitor(page, ctx);
  const tag = vp.name;

  // --- load ---
  let status = 0;
  try {
    const resp = await page.goto(ctx.site + "/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => page.goto(ctx.site + "/", { waitUntil: "load", timeout: 30000 }));
    status = resp?.status() || 0;
  } catch (e) { R.add("FAIL", "Page opens in the browser", e.message); await context.close(); return; }
  await page.waitForFunction(() => (document.body?.innerText || "").trim().length > 10, null, { timeout: 8000 }).catch(() => {});
  const home = await shot(page, ctx, `${tag}-home`);
  const blank = await isBlank(page);
  R.add(status === 200 && !blank ? "PASS" : "FAIL", "Page renders (not blank)", blank ? "the page is empty after loading: the app crashed on start" : `HTTP ${status}`, home);
  R.add(m.pageErrors.length ? "FAIL" : "PASS", "No JavaScript errors on load", m.pageErrors.slice(0, 3).join(" | "), m.pageErrors.length ? home : null);
  R.add(m.consoleErrors.length ? "WARN" : "PASS", "No console errors on load", m.consoleErrors.slice(0, 3).join(" | "));
  const serverBad = m.bad.filter((b) => b.status >= 500), clientBad = m.bad.filter((b) => b.status < 500);
  R.add(serverBad.length ? "FAIL" : "PASS", "No server errors while loading", serverBad.slice(0, 3).map((b) => `${b.status} ${b.url}`).join(" | "));
  R.add(clientBad.length || m.failed.length ? "WARN" : "PASS", "All files and requests load", [...clientBad.map((b) => `${b.status} ${b.url}`), ...m.failed].slice(0, 3).join(" | "));

  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const nameOf = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.slice(-60)),
      lang: document.documentElement.lang, title: document.title, viewport: !!document.querySelector("meta[name=viewport]"),
      imgNoAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length,
      btnNoName: [...document.querySelectorAll("button,[role=button]")].filter(vis).filter((b) => !nameOf(b) && !b.querySelector("img[alt]")).length,
      inputNoLabel: [...document.querySelectorAll("input:not([type=hidden]),textarea,select")].filter(vis).filter((i) => !(i.labels && i.labels.length) && !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby") && !i.placeholder && !i.title).length,
      loadMs: nav ? Math.round(nav.loadEventEnd) : 0,
      jsKb: Math.round(res.filter((r) => /\.m?js(\?|$)/.test(r.name)).reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
    };
  }).catch(() => null);
  if (info) {
    R.add(info.brokenImgs.length ? "FAIL" : "PASS", "No broken images", info.brokenImgs.join(", "));
    R.add(info.overflow > 2 ? "WARN" : "PASS", "No sideways scrolling", info.overflow > 2 ? `page is ${info.overflow}px wider than the screen` : "");
    R.add(info.loadMs && info.loadMs > 6000 ? "WARN" : "PASS", "Page loads in a reasonable time", `${info.loadMs} ms, ${info.jsKb} KB of JavaScript`);
    const a11y = [];
    if (!info.title) a11y.push("no page title");
    if (!info.lang) a11y.push("no <html lang>");
    if (!info.viewport) a11y.push("no viewport meta (bad on phones)");
    if (info.imgNoAlt) a11y.push(`${info.imgNoAlt} images without alt`);
    if (info.btnNoName) a11y.push(`${info.btnNoName} buttons without a name`);
    if (info.inputNoLabel) a11y.push(`${info.inputNoLabel} fields without a label`);
    R.add(a11y.length ? "WARN" : "PASS", "Basic accessibility and SEO", a11y.join("; "));
  }

  // --- linked pages ---
  const links = await page.evaluate(() => [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => h.startsWith(location.origin) && !h.includes("#") && !/\.(pdf|zip|png|jpg|svg)$/i.test(h)))]).catch(() => []);
  const routes = links.filter((l) => l.replace(/\/$/, "") !== ctx.site).slice(0, 15);
  if (routes.length) {
    const broken = [];
    const p2 = await context.newPage(); const m2 = monitor(p2, ctx);
    for (const url of routes) {
      const s = snap(m2);
      const r = await p2.goto(url, { waitUntil: "load", timeout: 20000 }).catch((e) => ({ err: e.message }));
      await sleep(400);
      if (r.err) broken.push(`${url} (${short(r.err)})`);
      else if (r.status() >= 400) broken.push(`${url} (HTTP ${r.status()})`);
      else if (await isBlank(p2)) broken.push(`${url} (blank)`);
      else if (delta(m2, s).pe.length) broken.push(`${url} (JS error: ${delta(m2, s).pe[0]})`);
    }
    await p2.close();
    R.add(broken.length ? "FAIL" : "PASS", `Linked pages open (${routes.length})`, broken.slice(0, 3).join(" | "));
  }

  // --- click through everything ---
  const samples = ctx.samples;
  const visitedKeys = new Set(), seenViews = new Set(), probedViews = new Set(), uploaded = new Set();
  let prevKeys = new Set(); const problems = []; const clickPath = []; let chatPath = null; let clicked = 0, unclickable = 0, skippedDanger = 0, probes = 0, shots = 0;
  const maxClicks = vp.maxClicks, skipExtra = (ctx.config.skipClickText || []).map((s) => new RegExp(s, "i"));
  seenViews.add(await fingerprint(page));

  async function viewHooks() {
    const fp = await fingerprint(page);
    if (!seenViews.has(fp)) {
      seenViews.add(fp);
      if (shots < 10) { shots++; await shot(page, ctx, `${tag}-view-${shots}`); }
    }
    // chat probe (once per screen, desktop only)
    if (vp.probes && probes < ctx.maxProbes) {
      const input = await findChatInput(page);
      const heading = input ? await page.evaluate(() => document.querySelector("h1,h2,h3")?.innerText || "").catch(() => "") : "";
      const pkey = input ? `${page.url()}|${input.label}|${heading}` : "";
      if (input && !probedViews.has(pkey)) {
        probedViews.add(pkey);
        if (!chatPath) chatPath = clickPath.slice();
        if (ctx.state.limited || ctx.state.aiCalls >= ctx.aiBudget) R.add("SKIP", `Chat from the screen: "${input.label}"`, "AI call budget used up or rate limit reached");
        else {
          probes++;
          await ctx.pacer.pace();
          const r = await sendMessage(page, m, input, probes === 1 ? "When is the release?" : "Hello, can you help me with my task?");
          const name = `Chat from the screen: "${input.label}"`;
          const api = r.apiCalls[0];
          const sh = await shot(page, ctx, `${tag}-chat-${probes}`);
          if (r.pageErrors.length) R.add("FAIL", name, "JavaScript error after sending: " + r.pageErrors[0], sh);
          else if (!api) R.add(r.grew > 5 ? "WARN" : "FAIL", name, r.grew > 5 ? "a reply appeared but the site did not call /api/ai (built-in replies only)" : "nothing happened after sending", sh);
          else if (api.status === 200) R.add(r.grew > 5 ? "PASS" : "WARN", name, r.grew > 5 ? `AI replied through the site (${(r.ms / 1000).toFixed(1)}s)` : "the AI answered but nothing new showed on screen", sh);
          else if (api.status === 429) R.add("WARN", name, "rate limit reached (HTTP 429)", sh);
          else R.add("FAIL", name, `AI call failed: HTTP ${api.status} ${api.reason}`.trim(), sh);
        }
      }
    }
    // CV / file upload (once per accept type)
    const fileInputs = page.locator("input[type=file]");
    const nf = await fileInputs.count().catch(() => 0);
    for (let i = 0; i < nf; i++) {
      const el = fileInputs.nth(i);
      const accept = ((await el.getAttribute("accept").catch(() => "")) || "").toLowerCase();
      const types = !accept ? ["pdf"] : ["pdf", "docx", "txt"].filter((t) => accept.includes(t) || (t === "docx" && accept.includes("word")) || (t === "txt" && accept.includes("text/plain")));
      if (!types.length && !uploaded.has("skip" + accept)) { uploaded.add("skip" + accept); R.add("SKIP", `File upload (accept="${accept}")`, "only pdf, docx and txt uploads are tested"); }
      for (const t of types) {
        const key = `${accept}|${t}`; if (uploaded.has(key)) continue; uploaded.add(key);
        const s0 = snap(m), len0 = await bodyLen(page);
        await el.setInputFiles(samples[t]).catch(() => {});
        await sleep(3000);
        const d = delta(m, s0), grew = (await bodyLen(page)) - len0, blank2 = await isBlank(page);
        const name = `Upload a .${t} file`;
        const sh = await shot(page, ctx, `${tag}-upload-${t}`);
        if (d.pe.length) R.add("FAIL", name, "JavaScript error: " + d.pe[0], sh);
        else if (blank2) R.add("FAIL", name, "the page went blank after the upload", sh);
        else if (d.bad.some((b) => b.status >= 500)) R.add("FAIL", name, "server error after the upload", sh);
        else R.add(grew !== 0 ? "PASS" : "WARN", name, grew !== 0 ? "the page reacted without errors" : "no errors, but nothing on the page changed (check that the file is read)", sh);
      }
    }
  }

  await viewHooks();
  for (let step = 0; step < maxClicks; step++) {
    await fillForms(page).catch(() => 0);
    await sleep(150);
    const targets = await collect(page).catch(() => []);
    for (const t of targets) t.key = `${t.tag}|${t.text}|${t.href || ""}${t.text ? "" : "#" + t.i}`;
    const usable = (t) => !t.disabled && !t.external && !t.newTab && !(t.href && /^(mailto|tel|javascript):/i.test(t.href)) && !visitedKeys.has(t.key);
    // Controls that just appeared (inside the screen we opened) come first, then the rest in page order.
    const next = targets.find((t) => usable(t) && !prevKeys.has(t.key)) || targets.find(usable);
    prevKeys = new Set(targets.map((t) => t.key));
    if (!next) break;
    visitedKeys.add(next.key);
    if (DANGER.test(next.text) || skipExtra.some((r) => r.test(next.text))) { skippedDanger++; continue; }
    const s0 = snap(m), urlBefore = page.url();
    const label = next.text || `<${next.tag}>`;
    try { await page.locator(`[data-mmc="${next.i}"]`).first().click({ timeout: 2500 }); }
    catch { unclickable++; await page.keyboard.press("Escape").catch(() => {}); continue; }
    clicked++;
    if (next.text) clickPath.push({ tag: next.tag, text: next.text }); else clickPath.push(null);
    await sleep(600);
    if (await page.locator("[role=dialog],[aria-modal=true]").first().isVisible().catch(() => false)) { await page.keyboard.press("Escape").catch(() => {}); await sleep(200); }
    if (new URL(page.url()).origin !== new URL(ctx.site).origin) { await page.goto(urlBefore).catch(() => {}); continue; }
    const d = delta(m, s0), blank2 = await isBlank(page);
    if (d.pe.length || blank2 || d.bad.some((b) => b.status >= 500)) {
      const sh = await shot(page, ctx, `${tag}-problem-${problems.length + 1}`);
      problems.push({ level: "FAIL", name: `Click "${label}"`, detail: d.pe.length ? "JavaScript error: " + d.pe[0] : blank2 ? "the page went blank" : "server error: " + d.bad.find((b) => b.status >= 500).url, sh });
      if (blank2) { await page.goto(ctx.site + "/", { waitUntil: "load" }).catch(() => {}); clickPath.length = 0; }
    } else if (d.ce.length || d.bad.length) {
      problems.push({ level: "WARN", name: `Click "${label}"`, detail: d.ce[0] || `request failed: ${d.bad[0].status} ${d.bad[0].url}`, sh: null });
    }
    await viewHooks();
  }
  for (const p of problems) R.add(p.level, p.name, p.detail, p.sh);
  const hard = problems.filter((p) => p.level === "FAIL").length;
  R.add(hard ? "FAIL" : "PASS", `Clicked ${clicked} buttons and links, ${hard} caused a failure`, `${seenViews.size} different screens seen` + (unclickable ? `, ${unclickable} not clickable` : "") + (skippedDanger ? `, ${skippedDanger} skipped on purpose (delete/log out/reset)` : ""));
  if (clicked >= maxClicks) R.add("WARN", "Click limit reached", `stopped at ${maxClicks} clicks, raise it with --max-clicks to cover more`);
  if (vp.probes && probes === 0) R.add("SKIP", "Chat from the screen", "no chat box found while clicking around (add a flow in checker.config.json)");
  if (vp.probes && !uploaded.size) R.add("SKIP", "File upload", "no file input found while clicking around");

  // AI calls the UI made while we clicked
  if (vp.probes) {
    const ok = m.api.filter((a) => a.status === 200).length, lim = m.api.filter((a) => a.status === 429).length, bad = m.api.filter((a) => a.status >= 400 && a.status !== 429);
    if (m.api.length) R.add(bad.length ? "FAIL" : lim ? "WARN" : "PASS", `AI calls made by the UI: ${m.api.length}`, `${ok} OK${lim ? `, ${lim} rate limited` : ""}${bad.length ? `, ${bad.length} failed (${bad.map((b) => b.status + " " + b.reason).join(", ")})` : ""}`);
    else R.add("SKIP", "AI calls made by the UI", "the UI sent none while clicking");
  }
  ctx.chatPath = ctx.chatPath || chatPath;
  await context.close();
}

// ---------- the site must survive when the AI is down ----------
async function outageTests(browser, ctx) {
  const R = ctx.results;
  R.section("Resilience: the site when the AI is down (simulated in the browser, no real calls)");
  if (ctx.chatPath === null || ctx.chatPath === undefined) return R.add("SKIP", "Site survives AI errors", "no chat box was found, so there is nothing to test");
  const scenarios = [["HTTP 500", { status: 500, body: '{"error":"boom"}' }], ["HTTP 429 (limit)", { status: 429, body: '{"error":"limit"}' }], ["no network to /api/ai", null]];
  for (const [name, fake] of scenarios) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
    const page = await context.newPage(); const m = monitor(page, ctx, false);
    await page.route("**/api/ai", (route) => fake ? route.fulfill({ status: fake.status, contentType: "application/json", body: fake.body }) : route.abort());
    try {
      await page.goto(ctx.site + "/", { waitUntil: "load", timeout: 30000 });
      await sleep(800);
      for (const step of ctx.chatPath) {
        if (!step) throw new Error("path has an icon-only button");
        await page.locator(step.tag).filter({ hasText: step.text }).first().click({ timeout: 3000 }); await sleep(500);
      }
      const input = await findChatInput(page);
      if (!input) throw new Error("chat box not found again");
      const r = await sendMessage(page, m, input, "When is the release?", 12000);
      const blank = await isBlank(page);
      const sh = await shot(page, ctx, `outage-${name.replace(/\W+/g, "")}`);
      if (r.pageErrors.length || blank) R.add("FAIL", `AI error: ${name}`, r.pageErrors[0] ? "JavaScript error: " + r.pageErrors[0] : "the page went blank", sh);
      else R.add(r.grew > 5 ? "PASS" : "WARN", `AI error: ${name}`, r.grew > 5 ? "the site stayed up and answered with a built-in reply" : "no crash, but the screen showed no reply (user sees nothing)", sh);
    } catch (e) { R.add("SKIP", `AI error: ${name}`, "could not reach the chat again: " + short(e.message)); }
    await context.close();
  }
}

// ---------- custom flows from checker.config.json ----------
async function runFlows(browser, ctx) {
  const flows = ctx.config.flows || [];
  if (!flows.length) return;
  const R = ctx.results;
  R.section("Your flows (checker.config.json)");
  for (const flow of flows) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
    const page = await context.newPage(); const m = monitor(page, ctx);
    let failed = null, idx = 0;
    try {
      for (const st of flow.steps) {
        idx++;
        if (st.goto !== undefined) await page.goto(new URL(st.goto, ctx.site + "/").href, { waitUntil: "load", timeout: 30000 });
        else if (st.click) await page.locator(st.click).first().click({ timeout: st.timeout || 6000 });
        else if (st.fill) await page.locator(st.fill[0]).first().fill(String(st.fill[1]), { timeout: 6000 });
        else if (st.press) await page.keyboard.press(st.press);
        else if (st.upload) await page.locator(st.upload[0]).first().setInputFiles(ctx.samples[st.upload[1]] || st.upload[1]);
        else if (st.expectText) await page.getByText(st.expectText).first().waitFor({ timeout: st.timeout || 10000 });
        else if (st.expectVisible) await page.locator(st.expectVisible).first().waitFor({ state: "visible", timeout: st.timeout || 10000 });
        else if (st.waitApi) { const before = m.api.length; const end = Date.now() + (st.timeout || 30000); while (m.api.length === before && Date.now() < end) await sleep(300); if (m.api.length === before) throw new Error("no /api/ai call happened"); if (m.api.at(-1).status !== 200) throw new Error(`/api/ai answered HTTP ${m.api.at(-1).status} ${m.api.at(-1).reason}`); }
        else if (st.wait) await sleep(st.wait);
        else if (st.screenshot) await shot(page, ctx, `flow-${flow.name.replace(/\W+/g, "-")}-${idx}`);
        if (m.pageErrors.length) throw new Error("JavaScript error: " + m.pageErrors[0]);
      }
    } catch (e) { failed = `step ${idx} ${JSON.stringify(flow.steps[idx - 1]).slice(0, 80)}: ${short(e.message)}`; }
    const sh = await shot(page, ctx, `flow-${flow.name.replace(/\W+/g, "-")}-end`);
    R.add(failed ? "FAIL" : "PASS", `Flow: ${flow.name}`, failed || `${flow.steps.length} steps`, sh);
    await context.close();
  }
}

export async function uiChecks(ctx) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { ctx.results.section("Browser"); return ctx.results.add("FAIL", "Playwright is installed", "run: npm install && npx playwright install chromium"); }
  fs.mkdirSync(ctx.shotDir, { recursive: true });
  ctx.samples = makeSamples();
  let browser;
  let launchErr;
  for (const opt of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch({ headless: !ctx.headed, ...opt }); break; } catch (e) { launchErr = launchErr || e; }
  }
  if (!browser) { ctx.results.section("Browser"); return ctx.results.add("FAIL", "A browser starts", short(launchErr.message) + " (Noctua needs Microsoft Edge or Google Chrome installed for the browser test)"); }
  try {
    await auditViewport(browser, { name: "desktop", width: 1366, height: 850, probes: true, maxClicks: ctx.maxClicks }, ctx);
    if (!ctx.quick) await auditViewport(browser, { name: "mobile", width: 390, height: 844, mobile: true, probes: false, maxClicks: ctx.mobileClicks }, ctx);
    await outageTests(browser, ctx);
    await runFlows(browser, ctx);
  } finally { await browser.close(); }
}
