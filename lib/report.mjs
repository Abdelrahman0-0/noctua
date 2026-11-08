import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COLORS = { PASS: "#1a7f37", WARN: "#9a6700", FAIL: "#cf222e", SKIP: "#6e7781" };

export function writeReport(outDir, site, R) {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = { site, finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - R.started) / 1000), pass: R.n("PASS"), warn: R.n("WARN"), fail: R.n("FAIL"), skip: R.n("SKIP") };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ summary, rows: R.rows }, null, 2));
  const groups = [...new Set(R.rows.map((r) => r.group))];
  const body = groups.map((g) => `<h2>${esc(g)}</h2><table>${R.rows.filter((r) => r.group === g).map((r) => `<tr><td><b style="color:${COLORS[r.level]}">${r.level}</b></td><td>${esc(r.name)}</td><td class="d">${esc(r.detail)}${r.shot ? ` <a href="${esc(r.shot)}" target="_blank">screenshot</a>` : ""}</td></tr>`).join("")}</table>`).join("");
  const worst = summary.fail ? "FAIL" : summary.warn ? "WARN" : "PASS";
  fs.writeFileSync(path.join(outDir, "report.html"), `<!doctype html><meta charset="utf-8"><title>Noctua check</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Ctext y=%27.9em%27 font-size=%2790%27%3E%F0%9F%A6%89%3C/text%3E%3C/svg%3E"><style>body{font:14px system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#1f2328}h1{margin-bottom:4px}h2{margin-top:28px;font-size:16px;border-bottom:1px solid #d0d7de;padding-bottom:4px}table{border-collapse:collapse;width:100%}td{padding:5px 8px;border-bottom:1px solid #eaeef2;vertical-align:top}td.d{color:#57606a;word-break:break-word}.s{padding:10px 14px;border-radius:8px;background:${COLORS[worst]}1a;border:1px solid ${COLORS[worst]}}</style><h1>&#129417; Noctua check</h1><p>${esc(site)} - ${esc(summary.finishedAt)} - ${summary.seconds}s</p><div class="s"><b>${summary.pass}</b> passed, <b>${summary.warn}</b> warnings, <b>${summary.fail}</b> failed, <b>${summary.skip}</b> skipped</div>${body}`);
  return summary;
}
