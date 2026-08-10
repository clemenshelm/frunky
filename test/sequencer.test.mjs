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
import { transport, meter } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];

// each seed is a different walk through every pool in the engine
const SEEDS = [0.377, 0.113, 0.641, 0.209, 0.888, 0.05, 0.5, 0.731];
const BARS = 160; // ~10 pieces' worth of sections per seed

const styles = new Set(), rhythms = new Set(), parts = new Set(), moods = new Set();
let steps = 0, liteRuns = 0;
// mix consistency: the family levels that hold every layer combination to the
// same loudness, and how many notes each bar actually fires
const seenHarm = [], seenDrums = [], seenMakeup = [], barNotes = [];

for (const [si, seed] of SEEDS.entries()) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  globalThis.window = { Tone: globalThis.Tone };
  eval(script);
  const Frunky = globalThis.window.Frunky;
  // half the seeds build the low-power graph. It is a DIFFERENT graph — no
  // chorus, plain oscillators, lower voice ceilings — and an untested second
  // graph is exactly the kind of thing that only breaks on the device that
  // needs it
  const lite = si % 2 === 1;
  Frunky.setOption("lite", lite);
  if (lite) liteRuns++;
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
    seenHarm.push(lv.harm); seenDrums.push(lv.drums); seenMakeup.push(lv.makeup);
    if (s % 16 === 15) { barNotes.push(meter.notes); meter.notes = 0; }

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

console.log("stepped:", steps, "sixteenths across", SEEDS.length,
  "seeds (" + liteRuns + " on the low-power graph)");
console.log("chord styles seen:", [...styles].sort().join(", "));
console.log("harmonic rhythms seen:", [...rhythms].sort().join(", "));
console.log("parts seen:", [...parts].sort().join(", "));
console.log("moods seen:", [...moods].sort().join(", "));

// ---- mix consistency --------------------------------------------------------
// A generative arrangement never has the same voice count twice, so a static
// balance cannot be right for all of them. These are the levellers that keep
// every combination landing in the same place; if they stop moving, the
// levelling has been disconnected and nothing else would say so.
const span = (a) => [Math.min(...a), Math.max(...a)];
const [hMin, hMax] = span(seenHarm);
const [dMin, dMax] = span(seenDrums);
const [mMin, mMax] = span(seenMakeup);
const notesSorted = barNotes.slice().sort((a, b) => a - b);
const median = notesSorted[Math.floor(notesSorted.length / 2)] || 0;
const busiest = notesSorted[notesSorted.length - 1] || 0;
console.log(`harmony bus ${hMin.toFixed(2)}–${hMax.toFixed(2)} · ` +
  `drum bus ${dMin.toFixed(2)}–${dMax.toFixed(2)} · ` +
  `scene makeup ${mMin.toFixed(2)}–${mMax.toFixed(2)}`);
console.log(`notes per bar: median ${median}, busiest ${busiest}`);

if (!(hMax - hMin > 0.02)) failures.push("harmony bus never re-levels — density compensation is not wired");
if (!(mMax - mMin > 0.02)) failures.push("scene makeup never moves — speed compensation is not wired");
if (hMin < 0.7 || hMax > 1.25) failures.push(`harmony bus left its band: ${hMin}–${hMax}`);
if (dMin < 0.85 || dMax > 1.05) failures.push(`drum bus left its band: ${dMin}–${dMax}`);
if (mMin < 0.95 || mMax > 1.25) failures.push(`scene makeup left its band: ${mMin}–${mMax}`);
// levelling cannot rescue an arrangement that piles everything on at once
if (median > 0 && busiest > median * 2.5) {
  failures.push(`busiest bar fires ${busiest} notes against a median of ${median} — ` +
    "some layer combination is far denser than the rest");
}

// a fuzz that never reached the interesting branches proves nothing
for (const s of ["wash", "keys", "broken", "gate"]) {
  if (!styles.has(s)) failures.push(`fuzz never exercised the "${s}" chord style`);
}
for (const r of ["bar", "twobar", "push", "sync"]) {
  if (!rhythms.has(r)) failures.push(`fuzz never exercised the "${r}" harmonic rhythm`);
}
if (liteRuns === 0) failures.push("the low-power graph was never built");
for (const p of ["A", "B", "C"]) {
  if (!parts.has(p)) failures.push(`fuzz never exercised part ${p}`);
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SEQUENCER_OK");
