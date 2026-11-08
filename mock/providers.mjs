// Fake Groq and Gemini servers for the selftest. Different "models" behave differently on purpose.
import http from "node:http";

const MODELS = {
  "llama-3.1-8b-instant": { delay: 40, good: true },
  "llama-3.3-70b-versatile": { delay: 120, good: true },
  "mock-bad": { delay: 30, good: false },       // invents a salary and breaks the review JSON
  "mock-slow": { delay: 900, good: true },      // slower than the (shortened) site limit
  "gemini-mock-lite": { delay: 200, good: true },
};
function answer(good, system, user) {
  const msg = (user.match(/<(?:user_message[^>]*|submission)>\n([\s\S]*?)\n<\/(?:user_message|submission)>/) || [])[1] || "";
  const kind = /Reply with ONLY a JSON/.test(system) ? "review" : /Give a hint/.test(system) ? "hint" : /live meeting/.test(system) ? "meeting" : /email reply/.test(system) ? "mail" : "chat";
  if (/single word: ok/.test(msg)) return "ok";
  if (kind === "review") {
    const pass = /toFixed/.test(msg);
    return good ? JSON.stringify({ pass, feedback: pass ? "Good work covering the criteria. Add a test for negative prices." : "This does not address the task. Name the fix you made." }) : "Looks fine to me, nice try!";
  }
  if (kind === "hint") return "Look at what the function returns and check how the price is formatted against the criteria.";
  if (kind === "meeting") return "Thanks Sara. Let's fix the API docs blocker right after standup.";
  if (kind === "mail") return "Hi Sara, I am not sure where the style guide is, I will check and reply today. Salma";
  if (/[\u0600-\u06ff]/.test(msg)) return "الريليز بيكون كل يوم اتنين الساعة 9.";
  if (/release/i.test(msg)) return "Releases go out every Monday at 09:00.";
  if (/salary/i.test(msg)) return good ? "I am not sure about that, I will check." : "Senior salary is $95,000 a year.";
  if (/ignore all/i.test(msg)) return "Let's get back to the task, Sara.";
  return "Happy to help with the team and releases.";
}
export function startProviders({ port, keys = { groq: "gk-test-secret", gemini: "mk-test-secret" } }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const groq = url.pathname.startsWith("/groq"), path = url.pathname.replace(/^\/(groq|gemini)/, "");
      const auth = groq ? req.headers.authorization === "Bearer " + keys.groq : req.headers["x-goog-api-key"] === keys.gemini;
      if (!auth) return send(401, { error: { message: "Invalid API Key" } });
      if (path === "/models") return send(200, groq ? { data: Object.keys(MODELS).filter((m) => !m.startsWith("gemini")).map((id) => ({ id })) } : { models: Object.keys(MODELS).filter((m) => m.startsWith("gemini")).map((n) => ({ name: "models/" + n, supportedGenerationMethods: ["generateContent"] })) });
      let body = {}; try { body = JSON.parse(raw); } catch { /* ignore */ }
      const m = groq ? body.model : (path.match(/models\/([^:]+):/) || [])[1];
      const cfg = MODELS[m];
      if (!cfg) return send(404, { error: { message: `The model ${m} does not exist` } });
      await new Promise((r) => setTimeout(r, cfg.delay));
      const system = groq ? body.messages[0].content : body.systemInstruction.parts[0].text;
      const user = groq ? body.messages[1].content : body.contents[0].parts[0].text;
      const text = answer(cfg.good, system, user);
      if (groq) return send(200, { choices: [{ message: { content: text } }], usage: { completion_tokens: Math.ceil(text.length / 4) } }, { "x-ratelimit-limit-requests": "14400", "x-ratelimit-remaining-requests": "14390", "x-ratelimit-limit-tokens": "6000", "x-ratelimit-remaining-tokens": "5900", "x-ratelimit-reset-tokens": "2s" });
      return send(200, { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { candidatesTokenCount: Math.ceil(text.length / 4) } });
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
