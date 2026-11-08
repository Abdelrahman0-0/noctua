// A tiny fake website used only by `npm run selftest`.
// bug=false: a healthy site. bug=true: deliberate faults in the page and API.
// Other modes only change the AI: "canned" (same answer to everything), "ramble" (loops), "resting" (a model dies, then the site rests),
// "slow" (answers slower than the limit). Options: rateLimit {n, ms} makes the fake server answer 429 like the real one; delayMs slows replies.
import http from "node:http";

const APP_JS = (bug) => `
const root = document.getElementById("root");
const views = {
  Home: () => '<h1>Welcome Sara</h1><p>Pick a section above to start your virtual internship.</p>' + (${bug} ? '<img src="/missing.png" alt="logo">' : ''),
  Tasks: () => { if (${bug}) setTimeout(() => { throw new Error("Cannot read properties of undefined (reading 'map')"); }, 50); return '<h1>Tasks</h1><p>PH-102 Fix price formatting</p><button id="hint">Ask for a hint</button><div id="out"></div>'; },
  Inbox: () => '<h1>Inbox</h1><div id="log"></div><textarea id="msg" placeholder="Message Salma"></textarea><button id="send">Send</button>',
  Profile: () => '<h1>Profile</h1><label>Upload CV <input type="file" id="cv" accept=".pdf,.docx,.txt"></label><div id="cvout"></div><button id="del">Delete account</button>',
};
function show(name) {
  root.innerHTML = '<nav>' + Object.keys(views).map(n => '<button class="nav">' + n + '</button>').join('') + '</nav><main>' + views[name]() + '</main>';
  document.querySelectorAll('.nav').forEach(b => b.onclick = () => show(b.textContent));
  const $ = (id) => document.getElementById(id);
  async function ai(body) {
    try {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: { name: 'Salma', role: 'Manager', company: 'Pharos', field: 'Web', culture: 'startup' }, context: [], history: [], extra: { user: 'Sara' }, ...body }) });
      if (!r.ok) throw new Error('ai ' + r.status);
      return (await r.json()).text;
    } catch { return 'Thanks, I will get back to you soon. (built-in reply)'; }
  }
  if ($('send')) $('send').onclick = async () => { const v = $('msg').value.trim(); if (!v) return; $('log').innerHTML += '<p>You: ' + v + '</p>'; $('msg').value = ''; const t = await ai({ kind: 'chat', message: v }); $('log').innerHTML += '<p>Salma: ' + t + '</p>'; };
  if ($('hint')) $('hint').onclick = async () => { $('out').textContent = await ai({ kind: 'hint', message: 'Can I get a hint?', extra: { title: 'PH-102', criteria: ['a'], code: 'x', user: 'Sara' } }); };
  if ($('cv')) $('cv').onchange = () => { $('cvout').textContent = 'CV loaded: ' + $('cv').files[0].name; };
  if ($('del')) $('del').onclick = () => { root.innerHTML = '<p>ACCOUNT DELETED</p>'; };
}
show('Home');
`;
const INDEX = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock Site</title><meta name="description" content="mock"><style>nav{display:flex;gap:8px;margin-bottom:12px}main{max-width:600px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

const FAST = ["chat", "meeting", "mail"];
function reply(mode, b) {
  const bug = mode === true, m = String(b.message || "");
  const ctx = (b.context || []).map((c) => c.text).join(" "), hist = (b.history || []).map((h) => h.text).join(" ");
  if (mode === "canned" && FAST.includes(b.kind)) return { text: "Thanks for your message Sara, I will get back to you soon." };
  if (mode === "ramble" && FAST.includes(b.kind)) return { text: "I think " + "the release ".repeat(10) + "is on Monday." };
  if (b.kind === "chat") {
    if (/[\u0600-\u06ff]/.test(m)) return { text: "الريليز بيكون كل يوم اتنين الساعة تسعة الصبح يا سارة." };
    if (/what number/i.test(m)) return { text: `You told me ${(hist.match(/\d+/) || ["?"])[0]}.` };
    if (/who are you/i.test(m)) return { text: `I'm ${b.persona.name}, the ${b.persona.role} here at ${b.persona.company}.` };
    if (/system instructions/i.test(m)) return { text: "I'd rather keep our chat focused on your task, Sara." };
    if (/\bceo\b/i.test(m)) return { text: "I'm not sure about that, I would have to check with HR." };
    if (/project codeword/i.test(m)) return { text: `The codeword is ${((ctx.match(/codeword is (\S+?)\./) || [])[1]) || "unknown"}.` };
    if (/design review/i.test(m) && ctx) return { text: ctx };
    if (/about the team/i.test(m)) return { text: "We are a small team of six. Releases are weekly and every change gets a peer review before it ships." };
    if (/release/i.test(m)) return { text: "Releases go out every Monday at 09:00." };
    if (/salary/i.test(m)) return { text: bug ? "The salary is $90,000 a year." : "I do not have that information." };
    if (/ignore all/i.test(m)) return { text: "Let's get back to work, Sara." };
    return { text: "Happy to help. Ask me about the team or your tasks." };
  }
  if (b.kind === "meeting") return { text: /cach/i.test(m) ? "Good point on the caching layer, Sara. Let's try it on the dashboard first." : "Thanks. Let's sort out the API docs blocker today." };
  if (b.kind === "mail") return { text: /design review/i.test(m) && ctx ? `Hi Sara, ${ctx}` : "Hi Sara, the style guide is in the shared drive under Design." };
  if (b.kind === "hint") return { text: "Look at what the function returns. What happens to the currency sign and the decimals?" };
  if (b.kind === "review") { const ok = /toFixed/.test(m); return { pass: ok, text: ok ? "Good work, this covers the criteria." : "This does not address the task yet." }; }
}

export function startMock({ port, bug = false, adminToken = "mock-admin-token-1234567890", rateLimit = null, delayMs = 0 }) {
  const calls = [], rest = { done: false, until: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (url.pathname === "/app.js") return send(200, APP_JS(bug === true), "application/javascript");
    if (url.pathname === "/api/ai-check") {
      if (bug === true) return send(200, { keys: { groq: true, gemini: false }, results: [], lanes: {} }); // bug: open to everyone
      if ((req.headers.authorization || "") !== "Bearer " + adminToken) return send(401, { error: "unauthorized" });
      return send(200, { keys: { groq: true, gemini: false }, results: [{ id: "groq:llama-3.1-8b-instant", ok: true, ms: 180, kinds: ["chat", "mail"] }, { id: "groq:llama-3.3-70b-versatile", ok: true, ms: 420, kinds: ["review", "hint"] }], lanes: { chat: ["groq:llama-3.1-8b-instant"], review: ["groq:llama-3.3-70b-versatile"] } });
    }
    if (url.pathname === "/api/ai") {
      if (req.method !== "POST") return send(405, { error: "method" });
      let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", async () => {
        let b; try { b = JSON.parse(raw); } catch { return send(400, { error: "bad json" }); }
        if (!["chat", "meeting", "mail", "hint", "review"].includes(b.kind) || !b.persona || !String(b.message || "").trim()) return send(400, { error: "bad input" });
        if (rateLimit) { const now = Date.now(); while (calls.length && now - calls[0] > rateLimit.ms) calls.shift(); if (calls.length >= rateLimit.n) return send(429, { error: "rate limit" }); calls.push(now); }
        if (bug === "resting") {
          if (b.kind === "meeting" && !rest.done) { rest.done = true; rest.until = Date.now() + 1200; return send(502, { error: "ai failed", reason: "all providers unavailable: gemini:gemini-mock-lite The operation was aborted due to timeout, groq:llama-mock-70b 404" }); }
          if (Date.now() < rest.until) return send(502, { error: "ai failed", reason: "all providers unavailable: all resting after earlier failures" });
        }
        if (bug === true && b.kind === "hint") return send(502, { error: "all models failed", reason: "groq 401" });
        const wait = delayMs || (bug === "slow" ? 700 : 0);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        return send(200, { ...reply(bug, b), model: bug === true ? "gemini:gemini-mock-lite" : "groq:llama-3.1-8b-instant" });
      });
      return;
    }
    if (url.pathname === "/" || url.pathname.startsWith("/__mm_check_deep_link__")) return send(200, INDEX, "text/html; charset=utf-8");
    if (url.pathname === "/missing.png") return send(404, "nope", "text/plain");
    send(404, "not found", "text/plain");
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
