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

// ---- the measurement outlives the readouts --------------------------------
// The trip summary, the log view and the diagnostics line are gone: they were
// the offline answer, and a trace that arrives on its own is a better one. What
// must NOT go with them is the instrumentation, which now feeds the tracer
// instead of a screen. Nothing renders it any more, so it looks like dead code
// to the next person reading this file — these assertions are what says it is
// not, and they name the consumer so the link is findable.
ok("it watches for long tasks", drive.includes("longtask"));
ok("it watches the page lifecycle", drive.includes("visibilitychange"));
ok("it samples the heap", drive.includes("usedJSHeapSize"));
ok("and it reports a verdict", drive.includes("classifyFreeze"));
ok("the freeze verdict reaches the trace, not just a screen",
  /tracer\.event\("freeze"/.test(drive));
ok("the long-task total reaches the trace", /lt:\s*Math\.max\(0, ltNow/.test(drive));
ok("the note counter reaches the trace", /notes:\s*notesPerSec/.test(drive));
ok("and the GPS diagnostics reach the trace", /gps:\s*d\.fixes\s*\?\s*d\.speedSource/.test(drive));

// ---- the page's own life is now the thing under investigation -------------
// Nine Tesla runs: engine perfectly healthy in all 109 samples — zero late
// steps, zero stalls, zero errors, notes flowing to the very last one — and
// four of them ending in `pagehide` after 11 to 44 seconds. The music does not
// die. The page is taken away. So the page reports its own lifecycle.
for (const kind of ["hidden", "visible", "pagehide", "pageshow"]) {
  ok("the page reports " + kind + " to the trace",
    new RegExp('tracer\\.event\\("' + kind + '"').test(drive));
}
ok("a discarded tab says so on the next load", /wasDiscarded/.test(drive));
ok("and the audio context's state travels with every sample", /audio:\s*h\.audio/.test(drive));
// the render thread's own account: every other number in a sample measures
// the main thread, and a crackle is made on the render thread
ok("the render load travels with every sample", /rload:\s*h\.renderLoad/.test(drive));
ok("and so does the underrun count", /under:\s*h\.underruns/.test(drive));

// `pagehide` is NOT the end of a drive. It fires whenever the page is
// backgrounded — on a car browser, every time the driver looks at the map — and
// ending the trace there writes an `end` block onto a drive that is still
// happening. Only a pagehide WITHOUT bfcache is a real ending.
ok("pagehide reads the persisted flag before deciding anything",
  /pagehide[\s\S]{0,400}persisted/.test(drive));
ok("and only ends the drive when the page is really being thrown away",
  /persisted[\s\S]{0,200}end\("unload"\)/.test(drive));

// ---- what is being done about it ------------------------------------------
// A tab that declares itself a media player is treated very differently by a
// Chromium-based browser than one that merely happens to make noise — and on a
// car it also puts the drive on the steering-wheel controls, which it should
// have been on anyway.
ok("the page declares a media session", /mediaSession/.test(drive));
ok("with metadata, so the car knows what is playing", /MediaMetadata/.test(drive));
ok("and it answers the car's transport controls",
  /setActionHandler\("pause"/.test(drive) && /setActionHandler\("play"/.test(drive));
// a context that goes to sleep must be caught the moment it does, not at the
// next visibilitychange
ok("a suspended audio context is noticed and resumed",
  /onstatechange|"statechange"/.test(drive));
// the Tesla is not recognisable from its agent string, but its weakness is
// measurable — and the low-power graph existed all along with nothing to switch
// it on
ok("a weak device switches the low-power graph on by itself",
  /hardwareConcurrency/.test(drive) && /setOption\("lite"/.test(drive));

// ---- and the readouts really are gone -------------------------------------
for (const [what, marker] of [
  ["the trip summary screen", 'id="trip"'],
  ["the log view", 'id="logView"'],
  ["the diagnostics line", 'id="diag"'],
]) {
  ok(what + " is no longer in the driver page", !drive.includes(marker));
}
ok("nor the code that rendered them",
  !/function showTrip|function renderLog/.test(drive));

// ---- withdrawal stays reachable, whatever else is removed -----------------
// Consent must be as easy to take back as it was to give. That makes this one
// control legally load-bearing rather than a debug leftover, so it does not get
// swept out with the panel it used to share.
ok("the tracing switch survives", /id="optTrace"/.test(drive));
ok("and something opens the panel it lives in", /classList\.toggle\("settings"\)/.test(drive));
ok("bench loads Tone", bench.includes('src="vendor/Tone.js"'));
ok("bench loads the engine", /src="engine\.js(\?v=\d+)?"/.test(bench));

// The car voicing is ON by default everywhere (every target room is a car),
// so the A/B needs a switch on BOTH pages: the bench for desk listening, the
// driver page because the final decibel is decided by ears in the actual car.
for (const [name, src] of [["index.html", drive], ["bench.html", bench]]) {
  ok(name + " offers the car-mix A/B", /id="optCarMix"/.test(src));
  ok(name + " wires it to the option", /setOption\("carMix"/.test(src));
}

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

// Reviewing a stale cached copy has cost this project four field tests, so the
// build has to be identifiable. The driver page used to carry two stamps: the
// file's lastModified in the footer, and BUILD on the start screen. The footer
// one is gone with the rest of the debug readouts — the remaining two signals
// are both stronger, because BUILD is the deployed constant rather than a file
// mtime, and it now travels home in every trace as well.
ok("the build reaches the trace, so a stale run is visible without asking",
  /build:\s*BUILD/.test(drive));
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

// ---- every element the script reaches for has to exist --------------------
// Parsing is not enough, and this was proved the expensive way: removing the
// trip summary left `el("again").addEventListener(...)` behind. The file still
// parsed perfectly, so the parse guard above was green — and the page threw
// during initialisation, which aborted the rest of the script, which left a
// `let` further down uninitialised, which made "Losfahren" silently do nothing.
// One dead line, three symptoms, none of them visible in a static check.
//
// A car browser reports that as a blank screen after a tap, and nothing else.
for (const [name, src] of [["index.html", drive], ["bench.html", bench], ["privacy.html", privacy]]) {
  const ids = new Set([...src.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const reached = new Set([
    ...[...src.matchAll(/\bel\("([\w-]+)"\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/getElementById\("([\w-]+)"\)/g)].map((m) => m[1]),
  ]);
  for (const id of reached) {
    if (!ids.has(id)) failures.push(`${name} reaches for #${id}, which the page does not contain`);
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
ok("consent is asked for", /id="consent/.test(drive));
ok("and the answer can be no", /id="consentNo"/.test(drive));

// ---- the ask must not become a dark pattern -------------------------------
// The rules that are actually enforced, made structural so a later styling
// tweak cannot quietly cross them.
//
// 1. Equal effort. One tap against one tap, same level, no submenu — this is
//    the one regulators have fined over (CNIL vs Google/Facebook, 2022).
// 2. Equal prominence. Both answers share ONE css rule, so they cannot drift
//    into a coloured bar next to a pale grey link. Emphasis on "yes" is fine;
//    hiding "no" is not.
// 3. Saying no must still start the drive. The moment the music depends on the
//    answer, consent is no longer freely given (Art. 7(4) GDPR) and the whole
//    thing is void — the worst of both worlds.
const style = drive.slice(drive.indexOf("<style>"), drive.indexOf("</style>"));
ok("neither answer is sized or coloured on its own",
  !/#consent(Yes|No)\s*\{[^}]*(padding|font-size|width|display\s*:\s*none)/.test(style));
ok("both answers are styled by one shared rule",
  /#consentBtns\s+button\s*\{/.test(style));
// both must reach the same continuation, so refusing is not a dead end
const yesPath = /consentYes[\s\S]{0,220}?answerConsent\(true\)/.test(driveScript);
const noPath = /consentNo[\s\S]{0,220}?answerConsent\(false\)/.test(driveScript);
ok("yes is one tap", yesPath);
ok("no is one tap, to the same place", noPath);
ok("and the drive proceeds either way — one continuation, not two",
  (driveScript.match(/function answerConsent/g) || []).length === 1);
// the ask must give a reason, not a slogan: a concrete one is what actually
// moves the answer, and a generic one is what trains people to dismiss prompts
ok("the ask states a concrete reason", /Tesla|Auto|Fahrzeug/.test(
  (drive.match(/<div id="consentModal"[\s\S]*?<\/div>\s*<\/div>/) || [""])[0]));
ok("and links to the full text before the choice",
  /id="consentModal"[\s\S]*?href="privacy\.html/.test(drive));
ok("the tracer is only created once, in one place",
  (driveScript.match(/FrunkyTrace\.create/g) || []).length === 1);

// the endpoint is stated once, and is not plain http
const endpoint = (drive.match(/TRACE_ENDPOINT\s*=\s*"([^"]*)"/) || [])[1];
ok("the endpoint is configured in one named constant", typeof endpoint === "string");
ok("and it is https", endpoint === "" || endpoint.startsWith("https://"));

// ---- freshness: the deploy must be able to REACH a car ---------------------
// The Tesla drove build 21 on the day build 26 shipped: its browser neither
// refetches the HTML nor ever reloads the tab. The server now sends the HTML
// no-store (hosting.test.mjs pins that), and fresh.js reloads a long-lived
// tab when version.json says a newer build is live. Both halves need wiring.
const versionJson = JSON.parse(read("version.json"));
ok("version.json carries the build as a string", typeof versionJson.build === "string");
ok("and it matches the driver page's BUILD", versionJson.build === BUILD);
ok("the driver page loads the freshness check", /src="fresh\.js\?v=\d+"/.test(drive));
ok("and starts it with its own build", /FrunkyFresh\.start\(\s*\{[^}]*build:\s*BUILD/.test(drive));
ok("the reload gate reads the real drive state",
  /FrunkyFresh\.start\([\s\S]{0,400}(speed|running)/.test(drive));

// the old GitHub Pages URL must keep working — as a signpost, not a copy. A
// bookmark in a car cannot be edited from here; a redirect can reach it.
for (const [name, src] of [["index.html", drive], ["bench.html", bench], ["privacy.html", privacy]]) {
  ok(name + " redirects github.io visitors to the canonical host",
    /github\.io/.test(src) && /frunky\.clemenshelm\.com/.test(src) &&
    /location\.replace/.test(src));
}

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
