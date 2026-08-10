// Wiring guard. The engine now lives in its own file and two pages call into
// it, so a renamed or dropped API method breaks a page that no other test
// loads — silently, because a static site has no build step to notice.
// This asserts that every Frunky.* / FrunkyGeo.* a page calls actually exists,
// and that each page loads the scripts it needs.
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const engine = read("engine.js");
const geo = read("geo.js");
const drive = read("index.html");
const diagnose = read("diagnose.js");
const bench = read("bench.html");
const tracer = read("trace.js");
const traceSchema = read("trace-schema.js");
const privacy = read("privacy.html");

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// what the modules publish. Two spellings are in use: an object literal
// assigned straight to window (engine, geo, diagnose) and a named object
// published to both window and globalThis, because the tracing files are read
// by the collector in node as well as by the browser.
const members = (body) => new Set(
  body.split(",").map((part) => (part.split(":")[0] || "").trim())
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
);
const published = (src, global) => {
  const direct = src.match(new RegExp("window\\." + global + "\\s*=\\s*\\{([\\s\\S]*?)\\};"));
  if (direct) return members(direct[1]);
  const named = src.match(new RegExp("window\\." + global + "\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*;"));
  if (!named) return null;
  const decl = src.match(new RegExp("const\\s+" + named[1] + "\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;"));
  return decl ? members(decl[1]) : null;
};
const engineApi = published(engine, "Frunky");
const geoApi = published(geo, "FrunkyGeo");
const diagApi = published(diagnose, "FrunkyDiag");
const traceApi = published(tracer, "FrunkyTrace");
const schemaApi = published(traceSchema, "FrunkyTraceSchema");
ok("trace.js publishes a window.FrunkyTrace object", traceApi && traceApi.has("create"));
ok("trace-schema.js publishes a window.FrunkyTraceSchema object",
  schemaApi && schemaApi.has("redactTrace"));
ok("diagnose.js publishes a window.FrunkyDiag object", diagApi && diagApi.size > 0);
ok("engine.js publishes a window.Frunky object literal", engineApi && engineApi.size > 0);
ok("geo.js publishes a window.FrunkyGeo object literal", geoApi && geoApi.size > 0);

// what the pages call
const calls = (src, global) =>
  [...src.matchAll(new RegExp(global + "\\.([A-Za-z_$][\\w$]*)", "g"))].map((m) => m[1]);

for (const [name, src] of [["index.html", drive], ["bench.html", bench]]) {
  for (const fn of calls(src, "Frunky")) {
    if (engineApi && !engineApi.has(fn)) failures.push(`${name} calls Frunky.${fn}, which engine.js does not export`);
  }
  for (const fn of calls(src, "FrunkyGeo")) {
    if (geoApi && !geoApi.has(fn)) failures.push(`${name} calls FrunkyGeo.${fn}, which geo.js does not export`);
  }
  for (const fn of calls(src, "FrunkyDiag")) {
    if (diagApi && !diagApi.has(fn)) failures.push(`${name} calls FrunkyDiag.${fn}, which diagnose.js does not export`);
  }
  for (const fn of calls(src, "FrunkyTrace")) {
    if (traceApi && !traceApi.has(fn)) failures.push(`${name} calls FrunkyTrace.${fn}, which trace.js does not export`);
  }
}

// a page that forgets a <script> fails with a bare ReferenceError in the car
ok("driver page loads Tone", drive.includes('src="vendor/Tone.js"'));
// the version query is how a car browser with no hard reload gets fresh code
ok("driver page loads the engine", /src="engine\.js(\?v=\d+)?"/.test(drive));
ok("driver page loads the GPS reader", /src="geo\.js(\?v=\d+)?"/.test(drive));
ok("driver page loads the freeze diagnosis", /src="diagnose\.js(\?v=\d+)?"/.test(drive));

// the four measurements that separate the causes of a frozen page — without
// them a freeze is a number with no explanation, which is where we were
ok("it watches for long tasks", drive.includes("longtask"));
ok("it watches the page lifecycle", drive.includes("visibilitychange"));
ok("it samples the heap", drive.includes("usedJSHeapSize"));
ok("and it reports a verdict", drive.includes("classifyFreeze"));
ok("bench loads Tone", bench.includes('src="vendor/Tone.js"'));
ok("bench loads the engine", /src="engine\.js(\?v=\d+)?"/.test(bench));

// the two pages must stay distinct in role: only the driver page reads real
// GPS, only the bench simulates one. Mixing them up is how a "fixed" bug turns
// out to have been fixed on the page nobody drives with
ok("driver page watches real position", drive.includes("watchPosition"));
ok("bench does not read real GPS", !bench.includes("watchPosition"));
ok("bench still simulates the degraded signal", bench.includes("advanceSim"));
ok("driver page does not simulate a drive", !drive.includes("advanceSim"));

// the engine must stay host-agnostic — the moment it touches the DOM it can
// only be tested through a page again
ok("engine.js touches no DOM", !/\bdocument\.|getElementById|requestAnimationFrame/.test(engine));

// both pages carry a build stamp: reviewing a stale cached copy has cost this
// project two full feedback rounds already
ok("driver page stamps its build", drive.includes("lastModified"));
// the build number must reach the report, or a stale run is indistinguishable
// from a fresh one — which cost three field tests
ok("the driver page reports its build number", /const BUILD = "\d+"/.test(drive));
// It has to be readable BEFORE driving. A stale copy that only reveals itself
// in the trip summary costs a whole test drive to discover — it cost four.
ok("the start screen shows the build", /id="buildNote"/.test(drive));
ok("and it is filled from BUILD", /buildNote[\s\S]{0,400}BUILD/.test(drive));
ok("and the script query matches it",
  (drive.match(/const BUILD = "(\d+)"/) || [])[1] === (drive.match(/engine\.js\?v=(\d+)/) || [])[1]);
ok("bench stamps its build", bench.includes("lastModified"));

// ---- the inline scripts have to parse -------------------------------------
// A static site has no build step, so a stray brace in a page's inline script
// is discovered by opening it — which for the driver page means in a car. Every
// other test here loads the .js modules and never the pages' own code.
for (const [name, src] of [["index.html", drive], ["bench.html", bench], ["privacy.html", privacy]]) {
  for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = m[1];
    if (!code.trim() || /application\/json/.test(m[0])) continue;
    try { new Function(code); } catch (err) {
      failures.push(name + " has an inline script that does not parse: " + err.message);
    }
  }
}

// ---- tracing ---------------------------------------------------------------
const BUILD = (drive.match(/const BUILD = "(\d+)"/) || [])[1];
ok("driver page loads the trace schema", /src="trace-schema\.js(\?v=\d+)?"/.test(drive));
ok("driver page loads the tracer", /src="trace\.js(\?v=\d+)?"/.test(drive));
// generalised from the single engine.js check: a page with four local scripts
// and one stale version query loads three fresh files and one old one, which is
// the worst of both — it looks updated and behaves like the previous build
for (const m of drive.matchAll(/src="([\w.-]+)\.js\?v=(\d+)"/g)) {
  ok("the version query on " + m[1] + ".js matches BUILD", m[2] === BUILD);
}

// The single most important structural guarantee on this page: everything that
// leaves the browser goes through trace.js, which is the file the privacy tests
// interrogate. A stray fetch on the page would be an unexamined second exit.
const driveScript = drive.slice(drive.indexOf("<script>"));
// The one permitted form is the adapter handed to the tracer — named exactly,
// so a second way out has to be added in the open rather than blending in
const egress = driveScript.replace(/fetch:\s*\(\.\.\.args\)\s*=>\s*fetch\(\.\.\.args\),/, "");
ok("the driver page never sends anything itself",
  !/\bfetch\s*\(/.test(egress) && !/XMLHttpRequest|sendBeacon/.test(egress));

// consent has to be an act, not a default. A page that switches tracing on and
// offers an off switch has already sent the first drive.
ok("the page never turns tracing on by itself",
  !/setConsent\(\s*true\s*\)/.test(driveScript.replace(/askConsent[\s\S]{0,200}?onclick/g, "")) ||
  /consentYes|btnTraceYes|traceYes/.test(driveScript));
ok("consent is asked for on the start screen", /id="consent/.test(drive));
ok("and the answer can be no, right there", /id="consentNo"/.test(drive));
ok("the tracer is only created once, in one place",
  (driveScript.match(/FrunkyTrace\.create/g) || []).length === 1);

// the endpoint is stated once, and is not plain http
const endpoint = (drive.match(/TRACE_ENDPOINT\s*=\s*"([^"]*)"/) || [])[1];
ok("the endpoint is configured in one named constant", typeof endpoint === "string");
ok("and it is https", endpoint === "" || endpoint.startsWith("https://"));

// ---- the privacy page ------------------------------------------------------
// A consent that cannot be read before it is given is not informed consent, so
// the page it links to has to actually answer the questions the law asks.
ok("the driver page links to the privacy page", /href="privacy\.html/.test(drive));
ok("the privacy page names what is stored", /Geschwindigkeitsklasse|Tempoklasse/.test(privacy));
ok("it says what is NOT stored", /kein[e]? (Position|Standort)/i.test(privacy));
ok("it names the retention period", /30 Tage/.test(privacy));
ok("it explains withdrawal", /widerruf/i.test(privacy));
ok("it offers deletion right there", /id="erase"/.test(privacy));
ok("it names a responsible party to contact", /@/.test(privacy));
ok("it names the legal basis", /Einwilligung/.test(privacy));
ok("it says where the server stands", /Hetzner|Deutschland|EU/.test(privacy));
ok("the privacy page is reachable without consenting to anything",
  !/setConsent\(\s*true\s*\)/.test(privacy));

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PAGES_OK");
