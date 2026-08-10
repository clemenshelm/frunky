// A fourteen-second freeze has several possible causes and they need different
// answers. Turning the raw numbers into a verdict is pure logic, so it is
// testable — and a verdict is what a field test can actually bring home.
import { readFileSync } from "node:fs";

globalThis.window = {};
eval(readFileSync(new URL("../diagnose.js", import.meta.url), "utf8"));
const D = globalThis.window.FrunkyDiag;

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const verdictOf = (o) => D.classifyFreeze(o).verdict;

// the page was put in the background: the browser is entitled to stop it
ok("a hidden page is a suspension",
  verdictOf({ ms: 14000, longtaskMs: 0, wasHidden: true, heapDelta: 0 }) === "hidden");

// long tasks covering the gap: our own code blocked the thread
ok("long tasks covering the gap are our own doing",
  verdictOf({ ms: 3000, longtaskMs: 2800, wasHidden: false, heapDelta: 0 }) === "our-js");
ok("mostly covered still counts",
  verdictOf({ ms: 3000, longtaskMs: 2000, wasHidden: false, heapDelta: 0 }) === "our-js");

// the page stayed visible and ran no code at all: the browser stopped it
ok("visible, no long task, is the browser stopping us",
  verdictOf({ ms: 14000, longtaskMs: 0, wasHidden: false, heapDelta: 0 }) === "browser-stopped");
ok("a trace of long task does not change that",
  verdictOf({ ms: 14000, longtaskMs: 300, wasHidden: false, heapDelta: 0 }) === "browser-stopped");

// a large heap drop across the gap points at collection under pressure
ok("a big heap drop is named",
  verdictOf({ ms: 2500, longtaskMs: 2400, wasHidden: false, heapDelta: -180e6 }) === "gc");

// when nothing is measurable, say so rather than guessing
ok("no long-task support is admitted, not guessed",
  verdictOf({ ms: 14000, longtaskMs: null, wasHidden: false, heapDelta: null }) === "unknown");

// every verdict carries a sentence a human can act on
for (const o of [
  { ms: 14000, longtaskMs: 0, wasHidden: true, heapDelta: 0 },
  { ms: 3000, longtaskMs: 2800, wasHidden: false, heapDelta: 0 },
  { ms: 14000, longtaskMs: 0, wasHidden: false, heapDelta: 0 },
  { ms: 14000, longtaskMs: null, wasHidden: false, heapDelta: null },
]) {
  const r = D.classifyFreeze(o);
  ok("verdict " + r.verdict + " explains itself", typeof r.detail === "string" && r.detail.length > 12);
}

// garbage in must not produce a confident answer
ok("nonsense input is unknown",
  verdictOf({ ms: NaN, longtaskMs: undefined, wasHidden: undefined, heapDelta: "x" }) === "unknown");

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("DIAGNOSE_OK");
