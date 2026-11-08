export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const col = (c, s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : s);
const MARK = { PASS: col(32, "✓ PASS"), WARN: col(33, "! WARN"), FAIL: col(31, "✗ FAIL"), SKIP: col(90, "- SKIP") };

// Machine-readable mode used by the app window: one JSON line per event, marked so it cannot be confused with normal text.
export const JSONL = process.env.MM_JSONL === "1";
export const emit = (o) => process.stdout.write("@@MM@@" + JSON.stringify(o) + "\n");

export class Results {
  constructor(quiet = false) { this.rows = []; this.group = ""; this.quiet = quiet; this.started = Date.now(); }
  section(title) { this.group = title; if (JSONL && !this.quiet) return emit({ type: "section", title }); if (!this.quiet) console.log(`\n${col(1, title)}`); }
  add(level, name, detail = "", shot = null) {
    this.rows.push({ group: this.group, level, name, detail, shot });
    if (JSONL && !this.quiet) return emit({ type: "row", level, name, detail, shot });
    if (!this.quiet) console.log(`${MARK[level]}  ${name}${detail ? "  → " + detail : ""}`);
  }
  // A short live message such as "waiting for the AI limit to reset (42s)". Shown in the app under the title.
  status(text) {
    if (this.quiet) return;
    if (JSONL) emit({ type: "status", text });
    else if (text && !this._busy) console.log(col(90, `  … ${String(text).replace(/\s*\(\d+s\)$/, "")}`));
    this._busy = !!text;
  }
  n(level) { return this.rows.filter((r) => r.level === level).length; }
}

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) o[k] = true;
      else { o[k] = next; i++; }
    } else o._.push(a);
  }
  return o;
}
export const short = (t) => String(t ?? "").replace(/\x1b\[[0-9;]*m/g, "").split(/Call log:/)[0].replace(/\s+/g, " ").trim().slice(0, 110);
