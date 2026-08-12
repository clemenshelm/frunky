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
  const hatPerBar = { lift: [], pedal: [] };
  const formSeen = new Set();
  const pedalColors = new Set();
  let rhodesPedalTrigs = 0, dropsTotal = 0, largeInFlow = 0;
  let taperWrong = 0, shimmerBars = 0, shimmerInLift = 0;
  const clearAfter = [];
  let lastColor = null, stringBedLift = 0, padTriMark = 0;
  let arias = [];
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
      }
      if (dr.lift.active) {
        const into = bar - dr.lift.start;
        const lastTwo = into >= (dr.lift.len || 8) - 2;
        if (dr.lift.taper !== lastTwo) taperWrong++;
      }
      if (dr.pedalColor) {
        pedalColors.add(dr.pedalColor);
        if (dr.pedalColor === "clear" && lastColor && lastColor !== "clear") {
          clearAfter.push(lastColor);
        }
        lastColor = dr.pedalColor;
      }
      if (dr.nodes && dr.nodes.padTri) {
        const ptNow = dr.nodes.padTri.trigs;
        if (dr.lift.active && ptNow > padTriMark) stringBedLift++;
        padTriMark = ptNow;
      }
      if (dr.arias) arias = dr.arias;
      if (dr.shimmer) {
        shimmerBars++;
        if (dr.lift.active) shimmerInLift++;
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

  const ghostsInFlow = Frunky.__motif().ghosts.filter((e) => e.part === "flow").length;
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
  // (the B48 assertion "every drop belongs to a lift" is superseded by
  // "the highway knows no drops at all" above — v3 removed the lift's drop)
  ok("the 48-bar breather stays off the highway (the pedal IS the breath)",
    /!engine\.flowOn && bar % 48 >= 44/.test(script));
  // frozen-state defense: even with the form paused, the frozen
  // finalRun/nextIsB flags must not keep announcing — pinned as source
  // because the walk's freeze point (part A) cannot reach those states
  ok("the form's build window is silenced in flow",
    /const formStage = engine\.flowOn \? -1/.test(script));
  ok("the form's drop gap is silenced in flow — and no lift arms one",
    /!engine\.flowOn && bar % 16 === 15 && nextIsB/.test(script) &&
    !script.includes("liftK === 3"));
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
  // LIFTED with v3 ("the buildup still doesn't feel right — maybe the form
  // doesn't fit the highway at all"): build→drop is EDM grammar, an EVENT.
  // Sustained music wants WAVES — the crescendo crests INTO the lift (no
  // breath, no impact; a crash marks the arrival like an orchestral cymbal)
  // and the lift recedes instead of stopping. So: the highway knows no
  // drops at all now, and the old every-lift-has-a-drop assertion inverts
  ok("the highway knows no drops at all: " + dropsTotal + " drops across " +
    liftStarts.length + " lifts", dropsTotal === 0 && liftStarts.length > 0);
  ok("the lift's one is marked by the crash, not a gap",
    /engine\.liftStart = bar; engine\.liftArm = -1; crash\(t\);/.test(script));
  ok("no hush at the lift's boundaries — the wave recedes, never stops",
    !/engine\.lastLiftEnd = bar; engine\.liftStart = -1; hush/.test(script) &&
    !/engine\.liftStart = bar; engine\.liftArm = -1; hush/.test(script));
  ok("the lift tapers over its last two bars (seam tracks the walk), " +
    taperWrong + " mismatches", taperWrong === 0);
  // the trigs ratio above proves the ADDED density (open hats); the volume
  // restore of the thinned layers is velocity, which the stub's counters
  // cannot see — pinned as source, one per layer, taper included
  ok("the kick comes back in the lift, then recedes",
    /1 - 0\.18 \* flowHigh \* \(liftPhase \? \(engine\.liftTaper \? 0\.6 : 0\.2\) : 1\)/.test(script));
  ok("the bass comes back in the lift, then recedes",
    /1 - 0\.4 \* flowHigh \* \(liftPhase \? \(engine\.liftTaper \? 0\.65 : 0\.25\) : 1\)/.test(script));
  ok("the hats come back in the lift, then recede",
    /1 - 0\.55 \* flowHigh \* \(liftPhase \? \(engine\.liftTaper \? 0\.7 : 0\.3\) : 1\)/.test(script));
  ok("the arp's offbeats come back in the lift, then recede",
    /1 - ff \* \(liftPhase \? \(engine\.liftTaper \? 0\.7 : 0\.3\) : engine\.shimmerOn \? 0\.55 : 1\)/.test(script));
  // the brightening palette ("the minor pedal turns depressing over time"):
  // between lifts the pedal breathes between its dusk voicings and a DAWN
  // set — thirdless, open, one dorian F# — in long diced windows; and a
  // SHIMMER micro-crest (arp up an octave, offbeats forward, four bars)
  // arrives more often than the lift, as the small light between the big ones
  ok("the pedal breathes both colors across the run, saw " +
    [...pedalColors].join(","), pedalColors.has("dusk") && pedalColors.has("dawn"));
  ok("the dawn set is open, not minor",
    /PEDALDAWN = \[\[57, 64, 71, 76\], \[57, 62, 69, 74\], \[57, 64, 71, 78\], \[57, 64, 69, 76\]\]/.test(script));
  // the one-bar-offset bug of the field report ("instruments seem shifted
  // by a bar, resynced at a lift"): the wash refired on ABSOLUTE bar
  // parity while the lift's harmony is anchored to its own start — an
  // odd-starting lift had the pad one bar behind the band for its whole
  // length. And dawn windows must sit on the absolute 12-bar grid so a
  // color flip always lands on the twobar chord cycle
  ok("the wash refires on the lift's own parity",
    /const chPh = liftPhase \? bar - engine\.liftStart : bar;/.test(script) &&
    /pos === 0 && chPh % 2 === 0/.test(script));
  ok("dawn windows sit on the absolute 12-bar grid",
    /const win = Math\.floor\(bar \/ 12\);/.test(script));
  // the cliff in the beam of light ("we wander questioning through the
  // mystified valley — and suddenly it opens"): sus and quartal dawn
  // colors ASK by construction and never answer. After two consecutive
  // dawn windows the next window RESOLVES into the picardy major — the
  // C# is the light — announced by a two-bar swell, entered on an open
  // hat, with the ghost paused (the light needs no question)
  ok("the pedal reaches the clearing across the run, saw " +
    [...pedalColors].join(","), pedalColors.has("clear"));
  ok("the clearing only ever follows the questioning (dawn), " +
    clearAfter.join(","), clearAfter.length > 0 && clearAfter.every((p) => p === "dawn"));
  ok("the clearing set carries the picardy third",
    /PEDALCLEAR = \[\[57, 61, 64, 69\], \[57, 64, 69, 73\], \[57, 61, 64, 71\], \[57, 64, 71, 73\]\]/.test(script));
  ok("two dawn windows earn the resolution at source",
    /if \(engine\.dawnRun >= 2\)/.test(script));
  ok("the ghost pauses in the light",
    /engine\.liftStart < 0 && engine\.liftArm < 0 && !engine\.clearingOn &&\s*\n\s*!engine\.lean && engine\.setMotif/.test(script));
  ok("the arp's minor third turns major in the light",
    /engine\.clearingOn && arpS0 % 12 === 3 \? arpS0 \+ 1 : arpS0/.test(script));
  // the tear ducts ("the lift doesn't open euphorically — strings?"): the
  // trance answer is the HIGH bed — the lift and the clearing layer the
  // triangle pad an octave above the wash, quiet and long
  ok("the lift carries the high string bed, " + stringBedLift + " refires",
    stringBedLift >= 2);
  ok("… pinned at source for the clearing too — and shed on lite and lean",
    /if \(\(liftPhase \|\| engine\.clearingOn\) && pos === 0 && chPh % 2 === 0 &&\s*\n\s*!opts\.lite && !lean\)/.test(script));
  // stability (field test: Tesla dies in seconds, the phone degrades):
  // BOTH field devices run the lite graph (coarse pointer), and the extra
  // polyphony of the string bed and the aria doubling ran past it. The
  // hook voice always sings; the octave luxuries are shed statically on
  // lite and dynamically under strain
  ok("the aria's doubling is a luxury (lite and lean skip it)",
    /if \(!opts\.lite && !lean\) \{\s*\n\s*padTri\.triggerAttackRelease\(F\(57 \+ an\.s\)/.test(script));
  ok("the flow ghost sheds under strain",
    /!engine\.lean && engine\.setMotif/.test(script));
  ok("per-bar dice streams are pruned on hour-long drives",
    /if \(diceStreams\.size >= 4000\)/.test(script) &&
    /if \(\/:\\d\+\$\/\.test\(k\)\) diceStreams\.delete\(k\);/.test(script));
  // the Freudensturm (Puccini's unison climax — Vincerò: the melody
  // doubled across octaves through the whole orchestra): the ARIA lift.
  // Diced per lift, GUARANTEED when the lift rises out of a clearing
  // (light + lift = the storm): the lap's theme sings augmented over the
  // lift — the hook voice an octave up, the string bed doubling below —
  // call in bars 2-3, answer in bars 6-7, and the answer lands home
  ok("arias really sang across the run, got " + arias.length, arias.length >= 1);
  ok("every aria sang inside a lift, " +
    arias.map((a) => a.bar - a.liftStart).join(","),
    arias.every((a) => a.liftStart >= 0 && a.bar - a.liftStart >= 2));
  ok("a lift out of the clearing always sings",
    /engine\.liftAria = engine\.clearingOn \|\| dicer\("aria:" \+ bar\)\(\) < 0\.35;/.test(script));
  ok("the aria is the theme in octaves (voice up, strings doubling below)",
    /hookNote\(t \+ an\.p \* 2 \* SPB, F\(69 \+ an\.s\)/.test(script) &&
    /padTri\.triggerAttackRelease\(F\(57 \+ an\.s\)/.test(script));
  ok("the shimmer really crests, got " + shimmerBars + " bars", shimmerBars >= 4);
  ok("and never inside a lift, got " + shimmerInLift, shimmerInLift === 0);
  ok("the ghost theme drifts over the pedal too, got " +
    ghostsInFlow + " flow ghosts", ghostsInFlow >= 1);
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
