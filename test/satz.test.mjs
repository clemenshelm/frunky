// The score, not the organ (Build 68). Field report on the highway bed:
// "the strings sound better now, but the long drawn-out chords are primitive
// and boring — there is so much more we can do; take inspiration from opera,
// operetta and symphony scores." And the report is right about the mechanism:
// a long hold today is ONE block trigger — every voice at once, one filter
// ride, 2.5 bars of nothing happening. That is how an organ holds a chord.
//
// A section never does. The devices, straight from the pit:
//   - staggered entries: desks enter one after another, bottom up (the
//     Bruckner opening, the operatic tutti swell),
//   - the suspension: at a chord change one inner voice arrives LATE — it
//     holds its old tone against the new chord and resolves downward after
//     a breath (4-3 / 9-8). Where the old chord offers no dissonance, the
//     voice enters on the upper second and leans in (appoggiatura),
//   - the inner stir: at the half, one voice steps to its neighbor tone and
//     back — the horn player's half-bar Wechselnote,
//   - and the strings' bed staggers its desks too, instead of one sample
//     block.
// The plan is PURE — planHold(midis, prev, dur, dice) returns the written-out
// voice plan {m, at, d, vel} — so a test can read the score before a single
// sample plays. The engine then merely performs it.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");

function makeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
let rc = 0;
Math.random = () => (rc = (rc + 0.03) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone, localStorage: makeStore() };
eval(script);
const Frunky = globalThis.window.Frunky;

ok("the __satz seam exists", typeof Frunky.__satz === "function");
const plan = typeof Frunky.__satz === "function"
  ? Frunky.__satz().plan : () => [];

const CHORD = [48, 55, 60, 64];        // C: root, fifth, third, seventh-ish top
const PREV = [50, 57, 62, 65];        // D-ish: every voice a step above
const DUR = 4.5;                       // a 2.5-bar hold in seconds
const dice = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

// ---- 1. every chord tone is in the plan, and the plan is playable ----------
{
  const p = plan(CHORD, null, DUR, dice([0.9]));
  ok("a plan comes back", Array.isArray(p) && p.length >= CHORD.length);
  ok("every chord tone is voiced",
    CHORD.every((m) => p.some((e) => e.m === m)));
  ok("entries are playable (times and durations inside the hold, vel 0..1.2)",
    p.every((e) => e.at >= 0 && e.d > 0 && e.at + e.d <= DUR + 1e-6 &&
      e.vel > 0 && e.vel <= 1.2));
  ok("every chord tone still sounds at the end of the hold (no voice dies)",
    CHORD.every((m) => p.filter((e) => e.m === m)
      .some((e) => e.at + e.d >= DUR * 0.94)));
}

// ---- 2. staggered entries, bottom up ----------------------------------------
{
  const p = plan(CHORD, null, DUR, dice([0.9]));
  const first = CHORD.map((m) => Math.min(...p.filter((e) => e.m === m).map((e) => e.at)));
  ok("the desks enter one after another (distinct entry times)",
    new Set(first.map((x) => Math.round(x * 1000))).size >= 3);
  ok("… bottom up (the bass leads, the top arrives last of the base voices)",
    first[0] <= first[1] && first[1] <= first[3]);
  ok("… and the spread stays a gesture, not an arpeggio (<= 400 ms)",
    Math.max(...first) - Math.min(...first) <= 0.4);
}

// ---- 3. the suspension: one voice arrives late on the OLD tone -------------
{
  // dice low = every device on; prev chord sits a step above everywhere, so
  // a true suspension exists: the voice holds the old tone, then resolves
  const p = plan(CHORD, PREV, DUR, dice([0.1]));
  const foreign = p.filter((e) => !CHORD.includes(e.m));
  ok("a non-chord tone leans over the change", foreign.length >= 1);
  const sus = foreign[0];
  ok("… it is the OLD chord's tone (a real suspension, not noise)",
    !!sus && PREV.includes(sus.m));
  const target = sus ? p.find((e) => CHORD.includes(e.m) && e.m < sus.m &&
    sus.m - e.m <= 2 && e.at >= sus.at + sus.d - 0.15) : null;
  ok("… and it RESOLVES downward onto its chord tone", !!target);
  ok("… after a real breath (>= 15% of the hold, <= half)",
    !!sus && sus.d >= DUR * 0.15 && sus.d <= DUR * 0.55);
}

// ---- 4. the appoggiatura: no previous chord still gets a leaning voice -----
{
  const p = plan(CHORD, null, DUR, dice([0.1]));
  const foreign = p.filter((e) => !CHORD.includes(e.m));
  ok("without a previous chord the lean comes from the upper second",
    foreign.length >= 1 && foreign.every((e) =>
      CHORD.some((m) => e.m - m >= 1 && e.m - m <= 2)));
}

// ---- 5. the inner stir: a neighbor tone at the half, then home -------------
{
  const p = plan(CHORD, null, DUR, dice([0.1]));
  const stir = p.find((e) => !CHORD.includes(e.m) && e.at >= DUR * 0.35);
  ok("an inner voice stirs past the half of the hold", !!stir);
  if (stir) {
    const home = p.find((e) => CHORD.includes(e.m) &&
      Math.abs(e.m - stir.m) <= 2 && e.at >= stir.at + stir.d - 0.15);
    ok("… and comes home to its chord tone", !!home);
    ok("… the stir is a gesture, not a new chord (short, soft)",
      stir.d <= DUR * 0.3 && stir.vel <= 1);
  }
}

// ---- 6. high dice = a plain (but still staggered) hold ----------------------
{
  const p = plan(CHORD, PREV, DUR, dice([0.95]));
  ok("devices are dosed: high dice keeps the hold plain",
    p.every((e) => CHORD.includes(e.m)));
}

// ---- 6b. the score is written in time order ---------------------------------
// The performer schedules the plan as given, and audio nodes refuse start
// times that run backwards: an unsorted plan (resolution pushed before the
// next desk's earlier entry) swallowed whole sequencer steps on the highway
{
  const p = plan(CHORD, PREV, DUR, dice([0.1]));
  ok("entries never step back in time",
    p.every((e, i, a) => i === 0 || e.at >= a[i - 1].at));
}

// ---- 7. determinism: the same dice writes the same score --------------------
{
  const a = JSON.stringify(plan(CHORD, PREV, DUR, dice([0.3, 0.6])));
  const b = JSON.stringify(plan(CHORD, PREV, DUR, dice([0.3, 0.6])));
  ok("the plan is deterministic under a seeded dice", a === b);
}

// ---- 8. the engine performs the score ---------------------------------------
{
  ok("long holds route through the orchestral hold, short ones stay light",
    /if \(!engine\.lean && dur >= SPB \* 16\) \{ orchHold\(t, midis, dur, vol, cut\); return; \}/.test(script));
  ok("the performer remembers the previous hold for the suspension",
    /engine\.lastHold = midis/.test(script));
  ok("the string desks stagger their entries too",
    /at\("strHi", t \+ i \* 0\.05\)/.test(script) &&
    /at\("strLo", t \+ i \* 0\.07\)/.test(script));
}

Frunky.stop && Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SATZ_OK");
