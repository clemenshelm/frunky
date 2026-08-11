// The freshness check. Cache headers fix a page that gets REFETCHED stale;
// they do nothing for a car-browser tab that is simply never reloaded — the
// Tesla kept a days-old build alive across drives while every deploy sat
// unseen on the server. fresh.js polls version.json (no-store) and reloads
// the page when a newer build is live, but only when reloading cannot ruin
// anything: parked or not yet playing, at most once per session, and never
// on a payload it does not fully understand.
//
// The decision is a pure function so this file can test every branch without
// a browser: FrunkyFresh.decide(state) -> true = reload now.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../fresh.js", import.meta.url), "utf8");
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// fresh.js publishes to window (browser) — give it one and load it
globalThis.window = {};
new Function(src)();
const Fresh = globalThis.window.FrunkyFresh;

ok("fresh.js publishes window.FrunkyFresh", !!Fresh);
ok("it exposes the pure decision", typeof (Fresh && Fresh.decide) === "function");
ok("and the wiring entry point", typeof (Fresh && Fresh.start) === "function");

const base = {
  local: "27", remote: "28",
  running: false, speed: 0, reloaded: false,
};
const d = (over) => Fresh.decide({ ...base, ...over });

// ---- the case the Tesla proved ---------------------------------------------
ok("a newer build on a parked, idle page reloads", d({}) === true);
ok("a newer build while parked with music running reloads too",
  d({ running: true, speed: 0 }) === true);

// ---- never mid-drive -------------------------------------------------------
ok("never reloads while moving", d({ running: true, speed: 34 }) === false);
ok("not even barely moving", d({ running: true, speed: 3 }) === false);
ok("a stopped car (red light) with a newer build may reload",
  d({ running: true, speed: 0 }) === true);

// ---- once per session ------------------------------------------------------
ok("a session that already reloaded never loops", d({ reloaded: true }) === false);

// ---- only genuinely newer --------------------------------------------------
ok("the same build does nothing", d({ remote: "27" }) === false);
ok("an OLDER remote build does nothing — a rollback must not ping-pong",
  d({ remote: "26" }) === false);
ok("numeric compare, not string compare", d({ local: "9", remote: "27" }) === true);

// ---- hostile or broken payloads --------------------------------------------
for (const bad of [undefined, null, "", "abc", "27x", "-1", {}, [], NaN, "Infinity"]) {
  ok("an unreadable remote build never reloads: " + JSON.stringify(String(bad)),
    d({ remote: bad }) === false);
}
ok("a missing local build never reloads", d({ local: undefined }) === false);

// ---- the wiring, read as text ----------------------------------------------
// the poll must bypass every cache layer, or it asks the cache how stale the
// cache is
ok("the poll fetches version.json", /version\.json/.test(src));
ok("with no-store", /no-store/.test(src));
// visibility is the moment a parked car's tab comes back — poll right then
ok("it re-checks when the page becomes visible", /visibilitychange/.test(src));
// version.json is the ONLY thing this file may ever fetch: everything else
// that leaves the browser goes through trace.js, which the privacy tests
// interrogate. One URL, one GET, no payload.
const fetches = [...src.matchAll(/fetch\s*\(([^)]*)/g)];
ok("fresh.js fetches exactly one URL", fetches.length === 1);
ok("and that URL is version.json", /version\.json/.test((fetches[0] || [""])[0]));
ok("it never sends a body", !/method\s*:|body\s*:|POST/.test(src));

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("FRESH_OK");
