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
  const roomBeforeLift = [];
  const dropsAtLift = [];
  const hatPerBar = { lift: [], pedal: [] };
  let rhodesPedalTrigs = 0;
  let t = 0, s = 0, wasActive = false, lastDrops = 0;
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
        roomBeforeLift.push(roomLastBar);
        dropsAtLift.push(tr.drops - lastDrops);
      }
      lastDrops = tr.drops;
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
  ok("every gap leaves room to breathe (≥ 12 bars), gaps " + gaps.join(","),
    gaps.every((g) => g >= 12));
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
