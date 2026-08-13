// The wash must OVERLAP its successor. Field report after the sparse-
// anticipation change: "wash is weird on the one now — the last chord is
// somehow shortened". Accurate, and self-inflicted: the bar-0 duration in
// push sections still assumed the old anticipate-every-bar scheme (SPB*14,
// leaving the bar's last two steps bare), phrase-head bars lost their tail
// the same way, and pad() shaves every duration by 0.85 on top — so wash
// chords died before their barline and the one opened on a hole with a
// 1.1 s attack. The rule this file pins: in a wash bar, some pad chord must
// still be RINGING past the next barline — the crossfade is the transition.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
function boot(seed) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  globalThis.window = { Tone: globalThis.Tone, localStorage: makeStore() };
  eval(script);
  return globalThis.window.Frunky;
}

{
  const Frunky = boot(0.03);
  await Frunky.start();
  let t = 0, s = 0;
  const uncovered = [];
  const seenHr = new Map(); // hr -> checked wash bars
  while (s < 16 * 16 * 22 && (!Frunky.__set().piece || Frunky.__set().piece.num < 4)) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const pos = s % 16, bar = Math.floor(s / 16);
    if (pos === 15) {
      const d = Frunky.describe();
      const chords = d && d.chips.find((c) => c[0] === "Chords");
      const hrChip = d && d.chips.find((c) => c[0] === "Akkorde");
      const hr = hrChip ? String(hrChip[1]).split("·")[0] : null;
      const isWash = chords && chords[1] === "wash";
      // exclusions, each one a DESIGNED seam rather than a hole: the part
      // boundary (hush owns it), the bridge breakdown, the 48-bar breather
      // window, the first bars of the session (wake-in) — and the AIR
      // window (Build 60): there the carpet deliberately rests whole
      // voicings at full length, so some seams carry silence by design.
      // air.test.mjs owns that behavior (it pins that the rests are real
      // AND that the sounding voicings stay full-length); this file keeps
      // pinning the crossfade rule everywhere else
      const excluded = !d || d.bar >= 16 ||
        (d.partLabel === "C" && d.bar <= 8) ||
        (bar % 48 >= 43) || bar < 4 || Frunky.__drive().air.now;
      if (isWash && !excluded) {
        const calls = Frunky.__world().nodes.pad.calls;
        const barline = (bar + 1) * 16 * SPB;
        // some chord must ring past the barline with margin — the crossfade
        const covered = calls.some((a) =>
          typeof a[1] === "number" && typeof a[2] === "number" &&
          a[2] + a[1] >= barline + SPB * 0.4);
        if (!covered) uncovered.push(`${hr} bar ${d.bar} (${d.partLabel})`);
        seenHr.set(hr, (seenHr.get(hr) || 0) + 1);
      }
    }
    s++;
  }
  const summary = [...seenHr].map(([k, v]) => `${k}:${v}`).join(" ");
  ok("every wash bar rings past its barline — uncovered: " +
    (uncovered.slice(0, 6).join(", ") || "none") + " · checked " + summary,
    uncovered.length === 0);
  // non-vacuity: the run must actually have visited wash bars under the
  // anticipated rhythms (the regression's home) AND the plain ones
  ok("the run checked anticipated wash bars (push/sync), saw " + summary,
    ((seenHr.get("push") || 0) + (seenHr.get("sync") || 0)) >= 3);
  ok("and plain wash bars (bar/twobar), saw " + summary,
    ((seenHr.get("bar") || 0) + (seenHr.get("twobar") || 0)) >= 5);
  // the other half of note-length craft, pinned as source (the stub does
  // not model mono voice-stealing): a dense bass pattern plays DETACHED so
  // the mono voice never rings into its own next hit and gets chopped at
  // the barline; and the arp's downbeats ring longer than its offbeats
  ok("dense bass patterns play detached",
    /SPB \* \(dense \? 0\.95 : 1\.5 \+ Math\.random\(\) \* 0\.4\)/.test(script));
  ok("the arp's note lengths breathe with the beat",
    /SPB \* \(onBeat \? 2\.2 : 1\.6\)/.test(script));
  ok("zero engine errors across the wash survey", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("WASH_OK");
