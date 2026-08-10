// Exhaustive sequencer fuzz. The smoke test runs one drive in real time and
// therefore only ever visits the handful of section combinations that one
// random walk happens to roll. A branch that throws — a chord style crossed
// with a harmonic rhythm, a bridge landing on a piece boundary — silently
// waits for the listener to find it, and in the browser a throw inside the
// transport callback stops the music dead.
//
// So this drives the callback by hand at thousands of steps per second, across
// many random seeds and a gas pedal being thrashed, and asserts two things a
// listener would call "it broke": nothing throws, and nothing goes silent.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];

// each seed is a different walk through every pool in the engine
const SEEDS = [0.377, 0.113, 0.641, 0.209, 0.888, 0.05, 0.5, 0.731];
const BARS = 160; // ~10 pieces' worth of sections per seed

const styles = new Set(), rhythms = new Set(), parts = new Set(), moods = new Set();
let steps = 0;

for (const seed of SEEDS) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  globalThis.window = { Tone: globalThis.Tone };
  eval(script);
  const Frunky = globalThis.window.Frunky;
  await Frunky.start();

  // a gas pedal being shoved around: standstill, launches, hard braking,
  // highway, and the mid-corner reversals a slider drag produces
  let speed = 0;
  const profile = (bar) => {
    const phase = bar % 40;
    if (phase < 4) return 0;
    if (phase < 8) return 50;
    if (phase < 14) return 130;
    if (phase < 16) return 20;
    if (phase < 24) return 95;
    if (phase < 26) return 0;
    if (phase < 34) return 45;
    return 140;
  };

  let t = 0, lowMaster = 0, lowDuck = 0;
  for (let s = 0; s < BARS * 16; s++) {
    const bar = Math.floor(s / 16);
    const target = profile(bar);
    // four frames of engine update per 16th, as the page's loop would
    for (let f = 0; f < 4; f++) {
      speed += (target - speed) * 0.09;
      const lat = Math.sin(s * 0.11) * 0.6;
      try {
        Frunky.update(SPB / 4, { speed, lateralG: lat });
      } catch (err) {
        failures.push(`seed ${seed} step ${s}: update threw ${err && err.message}`);
        s = BARS * 16;
        break;
      }
    }
    try {
      transport.cb(t);
    } catch (err) {
      failures.push(`seed ${seed} step ${s} (bar ${bar}, pos ${s % 16}): ` +
        `onStep threw ${err && err.message}\n    ${(err && err.stack || "").split("\n")[1] || ""}`);
      break;
    }
    t += SPB;
    steps++;

    // "it just stops" is a level left parked low, not an exception. Both of
    // these gains are automated by the music and must always come back up
    const lv = Frunky.levels();
    if (lv.master < 0.5) {
      lowMaster++;
      if (lowMaster > 4) {
        failures.push(`seed ${seed} step ${s}: master gain stuck at ${lv.master}` +
          ` for ${lowMaster} steps — the mix went silent and stayed silent`);
        break;
      }
    } else lowMaster = 0;
    if (lv.duck < 0.5) {
      lowDuck++;
      if (lowDuck > 4) {
        failures.push(`seed ${seed} step ${s}: duck gain stuck at ${lv.duck}` +
          ` for ${lowDuck} steps — the melodic bus never recovers from the sidechain`);
        break;
      }
    } else lowDuck = 0;

    const d = Frunky.describe();
    if (d) {
      parts.add(d.partLabel);
      for (const [k, v] of d.chips) {
        if (k === "Chords") styles.add(v);
        if (k === "Akkorde") rhythms.add(String(v).split("·")[0]);
        if (k === "Mood") moods.add(v);
      }
      if (!d.chips.some(([k]) => k === "Mood")) moods.add("neutral");
    }
  }
  Frunky.stop();
  transport.clear();
}

console.log("stepped:", steps, "sixteenths across", SEEDS.length, "seeds");
console.log("chord styles seen:", [...styles].sort().join(", "));
console.log("harmonic rhythms seen:", [...rhythms].sort().join(", "));
console.log("parts seen:", [...parts].sort().join(", "));
console.log("moods seen:", [...moods].sort().join(", "));

// a fuzz that never reached the interesting branches proves nothing
for (const s of ["wash", "keys", "broken", "gate"]) {
  if (!styles.has(s)) failures.push(`fuzz never exercised the "${s}" chord style`);
}
for (const r of ["bar", "twobar", "push", "sync"]) {
  if (!rhythms.has(r)) failures.push(`fuzz never exercised the "${r}" harmonic rhythm`);
}
for (const p of ["A", "B", "C"]) {
  if (!parts.has(p)) failures.push(`fuzz never exercised part ${p}`);
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SEQUENCER_OK");
