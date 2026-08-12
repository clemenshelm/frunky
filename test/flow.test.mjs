// The highway earns its drama. Field report: "the lift always comes at the
// expected moment, and otherwise the mode gets boring — and after a build
// the reward is one kick, then boring again." The old lift ran on a 24-bar
// clock; predictability of the MOMENT is what kills tension (the boundary
// may be predictable, the moment must not be). Now the pedal phase carries
// a hazard — the longer it carries, the likelier the lift — every lift is
// preceded by the same four build bars the final chorus earns, its entry
// IS the drop, and the lift itself is the DENSE reward: the deliberately
// thinned highway layers (kick, bass, hats, arp offbeats) come back for
// its eight bars. Between lifts the carrier rotates so the pedal phase
// never falls asleep.
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
  ok("the 24-bar lift clock is gone", !script.includes("bar % 24"));

  const liftStarts = [];
  const liftLens = [];
  const roomBeforeLift = [];
  const dropsAtLift = [];
  const hatPerBar = { lift: [], pedal: [] };
  const formSeen = new Set();
  let rhodesPedalTrigs = 0, dropsTotal = 0, largeInFlow = 0;
  let t = 0, s = 0, wasActive = false, lastDrops = 0, liftBegan = -1;
  let hatMark = 0, rhodesMark = 0, roomLastBar = 0.12;
  const BARS = 300;
  while (s < BARS * 16) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 150, lateralG: 0 });
    transport.cb(t); t += SPB;
    const pos = s % 16, bar = Math.floor(s / 16);
    if (pos === 15) {
      const dr = Frunky.__drive();
      const tr = Frunky.__transition();
      const st = Frunky.__staging();
      const w = Frunky.__world();
      const hats = w.nodes.hatC.trigs + w.nodes.hatO.trigs;
      const rhod = Frunky.__album().nodes.rhodes.trigs;
      const flowOn = bar > 30; // energy has long settled at 150 km/h
      if (dr.lift.active && !wasActive) {
        liftStarts.push(bar);
        liftBegan = dr.lift.start;
        roomBeforeLift.push(roomLastBar);
        dropsAtLift.push(tr.drops - lastDrops);
      }
      if (!dr.lift.active && wasActive && liftBegan >= 0) {
        liftLens.push(dr.lift.lastEnd - liftBegan);
      }
      lastDrops = tr.drops;
      dropsTotal = tr.drops;
      // the FORM must hold still on the highway: part changes perform a
      // ceremony (hush, statement fill, at piece boundaries a new key and
      // a new orchestra) whose payoff the pedal harmony deliberately never
      // delivers — announcements without arrivals read as random
      if (flowOn) {
        const d = Frunky.describe();
        if (d) formSeen.add(Frunky.__set().piece.num + ":" + d.partLabel);
      }
      if (flowOn && Frunky.__fills().current &&
          Frunky.__fills().current.length >= 7) largeInFlow++;
      roomLastBar = st.sends.snare;
      if (flowOn) {
        (dr.lift.active ? hatPerBar.lift : hatPerBar.pedal).push(hats - hatMark);
        if (!dr.lift.active) rhodesPedalTrigs = rhod - rhodesMark >= 0 ? rhodesPedalTrigs + (rhod - rhodesMark) : rhodesPedalTrigs;
      }
      hatMark = hats; rhodesMark = rhod;
      wasActive = dr.lift.active;
    }
    s++;
  }

  ok("the highway earned at least two lifts, got " + liftStarts.length,
    liftStarts.length >= 2);
  const gaps = liftStarts.slice(1).map((b, i) => b - liftStarts[i]);
  ok("and their spacing VARIES — earned, never metronomic, gaps " + gaps.join(","),
    gaps.length >= 1 && (new Set(gaps).size >= 2 || gaps.length < 2));
  ok("every gap leaves room to breathe (≥ 24 bars — 'too often' was the " +
    "field report), gaps " + gaps.join(","),
    gaps.every((g) => g >= 24));
  // "too samey": the lift's length is diced per lift now — 8 or 12 bars —
  // and a 300-bar run must see both
  ok("lift lengths stay in the vocabulary {8, 12}, got " + liftLens.join(","),
    liftLens.length > 0 && liftLens.every((l) => l === 8 || l === 12));
  ok("and really vary across the run, got " + liftLens.join(","),
    new Set(liftLens).size >= 2);
  // "a puzzling chord change right after the build": the lift used to read
  // its progression off the ABSOLUTE bar number, so it entered at a random
  // point of its own cycle — and its first chord differed from the pedal's.
  // Anchored now, and it opens on the pedal's root: the drop's one lands
  // on harmonic ground the ear already stands on, the journey (F, G, home)
  // happens INSIDE the lift
  ok("the lift progression is anchored to the lift's own start",
    /liftPhase \? Math\.floor\(\(bar - engine\.liftStart\) \/ 2\) % 4/.test(script));
  ok("and opens on the pedal's root",
    /LIFTROOTS = \[33, 29, 31, 33\]/.test(script));
  // "buildups into nothing": the form kept announcing on the highway —
  // ride/gap/swell for a final chorus the pedal harmony never delivers,
  // and with the form clock frozen those announcements repeated every 16
  // bars. The form holds still in flow, so every drop belongs to a lift
  ok("the form holds still on the highway, saw " + [...formSeen].join(","),
    formSeen.size === 1);
  ok("every drop on the highway belongs to a lift: " + dropsTotal +
    " drops for " + liftStarts.length + " lifts",
    dropsTotal === liftStarts.length && dropsTotal > 0);
  ok("the 48-bar breather stays off the highway (the pedal IS the breath)",
    /!engine\.flowOn && bar % 48 >= 44/.test(script));
  // frozen-state defense: even with the form paused, the frozen
  // finalRun/nextIsB flags must not keep announcing — pinned as source
  // because the walk's freeze point (part A) cannot reach those states
  ok("the form's build window is silenced in flow",
    /const formSeg = engine\.flowOn \? -1/.test(script));
  ok("the form's drop gap is silenced in flow",
    /!engine\.flowOn && bar % 16 === 15 && nextIsB/.test(script));
  // a full-bar statement announces a new part, and on the highway no new
  // part arrives — behavioral count plus source pin (the walk's frozen
  // part may sit below the stage the large fill needs)
  ok("no full-bar statement fills on the highway, got " + largeInFlow,
    largeInFlow === 0);
  ok("… pinned at source",
    /!engine\.flowOn && bar % 16 === 15 && engine\.stage >= 0\.5/.test(script));
  ok("the phrase-tail swell stays off the highway too",
    /!engine\.flowOn && \(nextIsB \|\| pieceEnd\)/.test(script));
  ok("every lift was preceded by the build (the roll's room was open), saw " +
    roomBeforeLift.map((r) => r.toFixed(2)).join(","),
    roomBeforeLift.length > 0 && roomBeforeLift.every((r) => r > 0.3));
  ok("every lift entered through the drop, saw " + dropsAtLift.join(","),
    dropsAtLift.length > 0 && dropsAtLift.every((d) => d >= 1));
  // the trigs ratio above proves the ADDED density (open hats); the volume
  // restore of the thinned layers is velocity, which the stub's counters
  // cannot see — pinned as source, one per layer
  ok("the kick comes back in the lift",
    /1 - 0\.18 \* flowHigh \* \(liftPhase \? 0\.2 : 1\)/.test(script));
  ok("the bass comes back in the lift",
    /1 - 0\.4 \* flowHigh \* \(liftPhase \? 0\.25 : 1\)/.test(script));
  ok("the hats come back in the lift",
    /1 - 0\.55 \* flowHigh \* \(liftPhase \? 0\.3 : 1\)/.test(script));
  ok("the arp's offbeats come back in the lift",
    /1 - ff \* \(liftPhase \? 0\.3 : 1\)/.test(script));
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
  ok("the lift is the DENSE reward: hats per bar " + avg(hatPerBar.lift).toFixed(1) +
    " in the lift vs " + avg(hatPerBar.pedal).toFixed(1) + " on the pedal",
    hatPerBar.lift.length > 8 && avg(hatPerBar.lift) > avg(hatPerBar.pedal) * 1.4);
  ok("the carrier rotates: the Rhodes answers in the pedal phase, got " +
    rhodesPedalTrigs, rhodesPedalTrigs > 0);
  ok("zero engine errors across 300 highway bars", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("FLOW_OK");
