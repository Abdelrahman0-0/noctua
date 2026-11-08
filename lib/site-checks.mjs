// Static checks on the deployed site: reachable, HTML, assets, SPA deep links, headers.
export async function siteChecks(ctx) {
  const { site, results: R } = ctx;
  R.section("Site basics");
  const get = (u) => fetch(u, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  let res, html, ms;
  try {
    const t0 = Date.now(); res = await get(site + "/"); html = await res.text(); ms = Date.now() - t0;
  } catch (e) {
    R.add("FAIL", "Site is reachable", `${e.cause?.code || e.message}. Check the address.`);
    return false;
  }
  R.add(res.status === 200 ? "PASS" : "FAIL", "Home page returns 200", `HTTP ${res.status}, ${ms} ms`);
  if (res.status !== 200) return false;
  R.add(/text\/html/.test(res.headers.get("content-type") || "") ? "PASS" : "FAIL", "Home page is HTML", res.headers.get("content-type") || "no content-type");
  R.add(ms < 3000 ? "PASS" : "WARN", "Home page responds fast", `${ms} ms`);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(site);
  R.add(site.startsWith("https://") || isLocal ? "PASS" : "WARN", "Uses HTTPS", site.startsWith("https://") || isLocal ? "" : "the address is plain http");
  if (!/<title>[^<]+<\/title>/i.test(html)) R.add("WARN", "Page has a <title>", "missing in the HTML (fine only if set later by JavaScript)");

  // Every script and stylesheet the page references must load and not be an HTML fallback page.
  const urls = new Set();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+\.(?:css|js|mjs)[^"']*)["']/gi)) urls.add(m[1]);
  const bad = []; let bytes = 0;
  for (const u of urls) {
    const full = new URL(u, site + "/").href;
    if (new URL(full).origin !== new URL(site).origin) continue;
    try {
      const r = await get(full); const buf = await r.arrayBuffer(); bytes += buf.byteLength;
      if (r.status !== 200) bad.push(`${u} (HTTP ${r.status})`);
      else if (/text\/html/.test(r.headers.get("content-type") || "")) bad.push(`${u} (got HTML instead of a file)`);
    } catch (e) { bad.push(`${u} (${e.message})`); }
  }
  R.add(bad.length ? "FAIL" : urls.size ? "PASS" : "WARN", `Scripts and styles load (${urls.size})`, bad.join("; ") || `${(bytes / 1024).toFixed(0)} KB total`);

  // Refreshing on a deep link should still show the app, not a 404 page.
  try {
    const r = await get(site + "/__mm_check_deep_link__"); const t = await r.text();
    R.add(r.status === 200 && /<div id=["']?(root|app)/i.test(t) ? "PASS" : "WARN", "Deep links fall back to the app", r.status === 200 ? "" : `HTTP ${r.status}: refreshing on a sub-page may show an error (ignore if the site uses #hash routes)`);
  } catch (e) { R.add("WARN", "Deep links fall back to the app", e.message); }

  const missing = ["x-content-type-options", ...(site.startsWith("https://") ? ["strict-transport-security"] : [])].filter((h) => !res.headers.get(h));
  R.add(missing.length ? "WARN" : "PASS", "Basic security headers", missing.length ? "missing: " + missing.join(", ") : "");
  return true;
}
