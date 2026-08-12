// The hosting contract. frunky.clemenshelm.com serves the app itself now —
// GitHub Pages could not stop a car browser from caching the HTML, and the
// Tesla drove build 21 on the day build 26 shipped. The Caddy vhost in
// deploy/frunky-app.Caddyfile is the canonical copy of what the box serves,
// and this test pins the properties that make the setup correct:
//
//   * HTML and version.json go out no-store — the page IS the version
//     pointer, and a cached copy pins every ?v= query to the past.
//   * The ?v=-versioned scripts are immutable: their URL changes when their
//     content does. The deploy script REFUSES to ship changed files under an
//     unchanged build, which is what makes "immutable" a promise, not a bet.
//   * Unversioned assets (vendor/, samples/) must NOT be immutable.
//   * geolocation=(self) — the shared security snippet on the box says
//     geolocation=() and would silently kill the app's one sensor.
//   * The collector keeps /api/* and gets /traces for its viewer.
//
// The deploy script then verifies the RESOLVED headers with curl after every
// deploy — this test checks the asked-for config, the script checks reality.
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const caddy = read("deploy/frunky-app.Caddyfile");
const script = read("deploy/deploy-app.sh");
const drive = read("index.html");
const privacy = read("privacy.html");

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// ---- the vhost -------------------------------------------------------------
ok("the vhost names the canonical host", caddy.includes("frunky.clemenshelm.com {"));
ok("geolocation stays allowed for the app itself", caddy.includes("geolocation=(self)"));
ok("and the blocking form is nowhere in the file", !caddy.includes("geolocation=()"));
ok("the access log stays discarded", /log\s*\{[^}]*output discard/.test(caddy));

// cache rules
const pageMatcher = caddy.match(/@page path ([^\n]*)/);
ok("a matcher covers the HTML pages", !!pageMatcher && pageMatcher[1].includes("*.html"));
ok("and version.json", !!pageMatcher && pageMatcher[1].includes("/version.json"));
ok("and the bare root path", !!pageMatcher && /(^|\s)\/(\s|$)/.test(pageMatcher[1]));
ok("pages go out no-store", /header @page Cache-Control "no-store"/.test(caddy));
ok("versioned scripts are immutable",
  /header @versioned Cache-Control "public, max-age=31536000, immutable"/.test(caddy));
ok("unversioned assets get a bounded cache",
  /header @assets Cache-Control "public, max-age=86400"/.test(caddy));

// drift guard: every script a page loads with ?v= must be in the immutable
// list, and nothing unversioned may be — a new page script that misses the
// list silently ships with file_server's default (no Cache-Control at all)
const versionedMatcher = (caddy.match(/@versioned path ([^\n]*)/) || [])[1] || "";
const tags = new Set();
for (const src of [drive, privacy]) {
  for (const m of src.matchAll(/src="([\w.-]+\.js)\?v=\d+"/g)) tags.add("/" + m[1]);
}
ok("pages actually load versioned scripts (corpus check)", tags.size >= 5);
for (const t of tags) {
  ok(`versioned script ${t} is in the immutable list`, versionedMatcher.includes(t + " ") ||
    versionedMatcher.trim().endsWith(t));
}
for (const never of ["/vendor", "/samples", "*.html", "version.json"]) {
  ok(`the immutable list never covers ${never}`, !versionedMatcher.includes(never));
}
const assetsMatcher = (caddy.match(/@assets path ([^\n]*)/) || [])[1] || "";
ok("vendor/ is in the bounded-cache list", assetsMatcher.includes("/vendor/*"));
ok("samples/ too", assetsMatcher.includes("/samples/*"));

// the collector: same origin, prefixed paths, viewer not indexable
ok("/api/* reaches the collector", /handle \/api\/\* \{\s*\n\s*reverse_proxy frunky-trace:8099/.test(caddy));
ok("the viewer lives under /traces with the prefix stripped",
  /handle_path \/traces\* \{[\s\S]*?reverse_proxy frunky-trace:8099/.test(caddy));
ok("the viewer stays unindexed", /handle_path \/traces\* \{[\s\S]*?X-Robots-Tag "noindex/.test(caddy));
ok("the app pages are NOT marked noindex",
  !/handle \{[\s\S]*?X-Robots-Tag/.test(caddy.slice(caddy.indexOf("\thandle {"))));
ok("the API handle comes before the static file server",
  caddy.indexOf("handle /api/*") < caddy.indexOf("file_server"));
ok("static serving is compressed", /encode zstd gzip/.test(caddy));

// ---- the deploy script -----------------------------------------------------
ok("the deploy fails on the first error", script.includes("set -euo pipefail"));
ok("it ships to /srv/frunky", script.includes("/srv/frunky"));
for (const f of [...tags].map((t) => t.slice(1)).concat(["index.html", "bench.html",
  "privacy.html", "version.json", "vendor", "samples"])) {
  ok(`the deploy ships ${f}`, script.includes(f));
}
// the guard that makes immutable safe: same build + changed files = refusal
ok("it refuses changed files under an unchanged build",
  /REFUSED/.test(script) && /version\.json/.test(script));
// and it verifies what a browser actually receives, not what the config asks
ok("it verifies no-store on the page", /check "\/" *"cache-control: no-store"/i.test(script));
ok("it verifies immutability on the engine", /engine\.js\?v=.*immutable/i.test(script));
ok("it verifies the collector still answers", /api\/health/.test(script));
// the origin lesson (field test 2026-08-12: two drives' traces met a 403 and
// survived only in the devices' pending slots): the app moved to its own
// domain, and the collector's allowed origin silently did not — every upload
// from the new origin was refused. The compose definition must name the
// origin the app is actually served from
{
  const compose = readFileSync(
    new URL("../collector/deploy/frunky-trace.compose.yml", import.meta.url), "utf8");
  ok("the collector accepts the canonical app origin",
    /TRACE_ORIGINS:.*https:\/\/frunky\.clemenshelm\.com/.test(compose));
}
ok("the verification cannot be shrugged off", !/\|\|\s*true/.test(
  script.split("\n").filter((l) => /curl|check /.test(l)).join("\n")));

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("HOSTING_OK");
