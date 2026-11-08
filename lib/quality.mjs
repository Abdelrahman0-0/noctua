// Judging AI answers from the outside: loops, gibberish, leaks, canned answers, and reading the server's failure messages.

export const words = (t) => String(t ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

export function jaccard(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}

// Returns { hard: [...], soft: [...] }. hard = the model is producing nonsense. soft = worth a look.
export function sanity(text, kind = "chat") {
  const hard = [], soft = [], t = String(text ?? ""), w = words(t);
  if (t.trim().length < 2) hard.push("empty answer");
  const grams = new Map();
  for (let i = 0; i + 2 < w.length; i++) { const g = w.slice(i, i + 3).join(" "); grams.set(g, (grams.get(g) || 0) + 1); }
  const worst = [...grams].sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 4) hard.push(`loops: repeats "${worst[0]}" ${worst[1]} times`);
  const sents = t.split(/[.!?\u061f\n]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 12);
  const sc = new Map(); for (const x of sents) sc.set(x, (sc.get(x) || 0) + 1);
  if ([...sc.values()].some((n) => n >= 3)) hard.push("loops: the same sentence three times");
  if (/\uFFFD/.test(t) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t)) hard.push("broken characters");
  if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0900-\u097F\u0E00-\u0E7F]/.test(t)) hard.push("contains unrelated scripts (Chinese, Cyrillic, ...)");
  if (/(^|\s)[^\s]{45,}/.test(t.replace(/https?:\/\/\S+/g, ""))) hard.push("very long unbroken text");
  if (/<\/?(user_message|submission)\b|system prompt|system instruction/i.test(t)) soft.push("leaks internal instructions");
  if (/\bas an ai\b|\blanguage model\b|\bi am an ai\b|\bi'm an ai\b/i.test(t)) soft.push("breaks character (says it is an AI)");
  if (/```/.test(t)) soft.push("contains a code block");
  if (w.length > 220) soft.push(`very long (${w.length} words)`);
  if ((kind === "chat" || kind === "meeting") && t.trim().length > 140 && !/[.!?\u061f\u2026)"'\u201d]$/.test(t.trim())) soft.push("may be cut off mid-sentence");
  return { hard, soft };
}

// Any 6-word run of the site's own instructions showing up in a reply means the instructions leaked.
export function leaksInstructions(reply, system) {
  const r = words(reply), s = words(system), set = new Set();
  for (let i = 0; i + 5 < s.length; i++) set.add(s.slice(i, i + 6).join(" "));
  for (let i = 0; i + 5 < r.length; i++) if (set.has(r.slice(i, i + 6).join(" "))) return true;
  return false;
}

// "all providers unavailable: gemini:x The operation was aborted due to timeout, groq:y 404"  ->  [{id, why}]
export function parseFailures(reason) {
  const s = String(reason || "").replace(/^.*?unavailable:\s*/i, "");
  const re = /(groq|gemini):[^\s,]+/g, hits = []; let m;
  while ((m = re.exec(s))) hits.push({ id: m[0], from: m.index, to: m.index + m[0].length });
  return hits.map((h, k) => ({ id: h.id, why: s.slice(h.to, hits[k + 1] ? hits[k + 1].from : s.length).replace(/^[\s,]+|[\s,]+$/g, "") }));
}
export function explainWhy(why) {
  if (/timeout|aborted/i.test(why)) return "did not answer within the site's 6 seconds, so it was skipped";
  if (/\b404\b/.test(why)) return "HTTP 404: this model name does not exist for that key, or the key has no access to it";
  if (/\b(401|403)\b/.test(why)) return `HTTP ${why.match(/\b(401|403)\b/)[1]}: the key was rejected`;
  if (/\b429\b/.test(why)) return "HTTP 429: the provider's own limit was reached";
  if (/\b5\d\d\b/.test(why)) return `provider error (${why.match(/\b5\d\d\b/)[0]})`;
  if (/empty/i.test(why)) return "answered with an empty text";
  return why || "failed";
}

export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] : 0; };
