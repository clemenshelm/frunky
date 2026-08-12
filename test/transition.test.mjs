// Transition craft. The DJ's tension tools, form-anchored on purpose: a
// build-up is a PROMISE with a known payoff instant, so these devices ride
// the form (the engine knows when the final chorus lands) — the drive keeps
// its own continuous tension tools (rise canon, brake filter, growl).
// Four devices:
//   ride   the last four bars before the FINAL chorus pull the lows out
//          slowly (masterHp climbs bar by bar), released on the one — the
//          classic multi-bar DJ filter move; the old one-bar turnover keeps
//          serving every other transition
//   build  the drums steer toward the peak: snare density doubles toward
//          the final chorus and out of the bridge rebuild (8ths, then 16ths,
//          velocity rising) — the oldest "we are going somewhere" signal
//   throw  the hook's last note before its rest window is thrown into the
//          shared delay (a dedicated send opens for one note, closes at the
//          next barline) — the tail answers from the empty bars
//   fall   the drop's release half: a falling sweep after the impact, the
//          mirror of the riser that led in
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

function makeStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    raw: m,
  };
}
function boot(seed, store) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  const w = { Tone: globalThis.Tone };
  if (store) w.localStorage = store;
  globalThis.window = w;
  eval(script);
  return globalThis.window.Frunky;
}

// ---- 1. ride, build and throw, observed across two full pieces --------------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  ok("the __transition seam exists", typeof Frunky.__transition === "function");
  const seam = () => (typeof Frunky.__transition === "function"
    ? Frunky.__transition() : {});

  // drive two full pieces step by step and record what the devices do
  const rideBars = new Map(); // barInPart -> masterHp value in the ride window
  let baselineHp = null;      // masterHp in an ordinary mid-part bar
  let releaseHp = null;       // masterHp on the final chorus's first bar
  let maxThrow = 0, throwLate = [];
  const snareByBar = [];      // {window, label, barInPart, delta}
  const stabByBar = [];       // the opera tremolo: stab strikes per bar
  let rollRoomBuild = null, rollRoomOrdinary = null;
  let prevStabTrigs = 0;
  let prevTrigs = 0, windowsSeen = 0;
  let prevBarMeta = null;     // the delta read at a barline belongs to the PREVIOUS bar
  const bassByBar = [], kickByBar = [];
  let prevBassTrigs = 0, prevKickTrigs = 0;
  let t = 0, s = 0;
  const snareNode = () => (seam().nodes ? seam().nodes.snare : null);
  while (s < 16 * 16 * 15 && (!Frunky.__set().piece || Frunky.__set().piece.num < 3)) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const pos = s % 16;
    const d = Frunky.describe();
    if (d) {
      const finalNext = d.form[d.idx] === "B" && d.idx === d.form.lastIndexOf("B");
      const tr = seam();
      // bass and kick are read at pos 15 instead: a pos-0 delta counts the
      // NEXT bar's downbeat (the drop kick landed in bar 15's ledger)
      if (pos === 15) {
        const bassNow = Frunky.__world().nodes.bass.trigs;
        const kickNow = Frunky.__fills().nodes.kick.trigs;
        bassByBar.push({ window: finalNext, label: d.partLabel,
          barInPart: d.bar, delta: bassNow - prevBassTrigs });
        kickByBar.push({ window: finalNext, label: d.partLabel,
          barInPart: d.bar, delta: kickNow - prevKickTrigs });
        prevBassTrigs = bassNow;
        prevKickTrigs = kickNow;
      }
      if (pos === 0 && snareNode()) {
        const now = snareNode().trigs;
        const stabNow = tr.nodes && tr.nodes.stab ? tr.nodes.stab.trigs : 0;
        if (prevBarMeta) {
          snareByBar.push({ ...prevBarMeta, delta: now - prevTrigs });
          stabByBar.push({ ...prevBarMeta, delta: stabNow - prevStabTrigs });
        }
        prevTrigs = now;
        prevStabTrigs = stabNow;
        prevBarMeta = { window: finalNext, label: d.partLabel,
          barInPart: d.bar, num: d.num,
          fill: !!(Frunky.__fills && Frunky.__fills().current) };
      }
      if (pos === 8) {
        if (finalNext && d.bar === 16 && rollRoomBuild === null) {
          rollRoomBuild = Frunky.__staging().sends.snare;
        }
        if (!finalNext && d.bar === 6 && rollRoomOrdinary === null) {
          rollRoomOrdinary = Frunky.__staging().sends.snare;
        }
        if (finalNext && d.bar >= 13) {
          windowsSeen++;
          rideBars.set(d.bar, tr.masterHpFreq);
        }
        if (!finalNext && d.bar === 6 && baselineHp === null) baselineHp = tr.masterHpFreq;
        if (d.partLabel === "B" && d.idx - 1 === d.form.lastIndexOf("B") && d.bar === 1) {
          releaseHp = tr.masterHpFreq;
        }
      }
      if (typeof tr.throwGain === "number") {
        maxThrow = Math.max(maxThrow, tr.throwGain);
        if (d.bar >= 10) throwLate.push(tr.throwGain);
      }
    }
    s++;
  }

  ok("the run reached a final-chorus run-up (non-vacuity)", windowsSeen > 0);
  const rb = [13, 14, 15, 16].map((b) => rideBars.get(b)).filter((v) => v != null);
  ok("the ride pulls the lows out over MULTIPLE bars, saw " +
    rb.map((v) => Math.round(v)).join("→"),
    rb.length >= 3 && rb.every((v) => v > 40));
  ok("and it climbs bar by bar — tension, not a switch",
    rb.length >= 3 && rb.every((v, i) => i === 0 || v > rb[i - 1]));
  ok("an ordinary bar keeps the lows in (masterHp at 25), got " + baselineHp,
    baselineHp === 25);
  ok("the release lands on the one of the final chorus, got " + releaseHp,
    releaseHp === 25);

  // the drum build: the last bar before the final chorus carries clearly
  // more snare hits than any ordinary bar — density is the message
  const buildBar = snareByBar.find((r) => r.window && r.barInPart === 16);
  // fill bars are excluded on purpose: a dragged-snare fill IS a deliberate
  // half-bar crescendo (a curated event from the classics crate), and this
  // guard exists to catch ACCIDENTAL roll density on plain groove bars
  const ordinary = snareByBar.filter((r) => !r.window && !r.fill &&
    r.barInPart > 2 && r.barInPart < 12);
  const ordMax = Math.max(...ordinary.map((r) => r.delta));
  ok("the build's final bar rolls (≥ 12 snare hits), got " +
    (buildBar && buildBar.delta), !!buildBar && buildBar.delta >= 12);
  ok("ordinary bars stay a groove, not a roll (max " + ordMax + " ≤ 8)",
    ordinary.length > 0 && ordMax <= 8);

  // the throw: it opened for the tail note (≥ 1.2), and it is closed again
  // well after the rest window — a throw is a gesture, not a level
  ok("the hook throw really opened, max " + maxThrow.toFixed(2), maxThrow >= 1.2);
  ok("and closed again after the rest window",
    throwLate.length > 0 && throwLate.every((v) => v === 0));

  // the payoff: after the ride and the roll, a bar of filter release is not
  // a reward. EVERY piece now earns at least one real drop (gap, impact,
  // downlifter, a fast chord stab and the open hat on the one) — the final
  // chorus included, not only the bridge exit
  ok("two pieces earn at least two real drops, got " + seam().drops,
    seam().drops >= 2);
  // the roll swims in GROWING room: the snare's reverb share swells with
  // the build (0.12 glue -> ~0.55 in the last bar) and the gap then cuts
  // the dry signal while the hall tail rings into the breath — the classic
  // crescendo-into-silence edit. Ordinary bars keep the glue only
  ok("the roll swims in growing room, got " + rollRoomBuild,
    typeof rollRoomBuild === "number" && rollRoomBuild >= 0.4);
  ok("ordinary bars keep only the glue, got " + rollRoomOrdinary,
    rollRoomOrdinary === 0.12);
  // the opera tremolo: the last build bars carry a quiet string-style
  // tremolo crescendo on the current chord — stab strikes every 8th,
  // swelling. Ordinary mid-part bars strike no stabs at a steady cruise
  const tremBar = stabByBar.find((r) => r.window && r.barInPart >= 15 && r.delta >= 6);
  // piece 2 onward: the test's instant 0->60 km/h start spikes thrust, and
  // the thrust stabs of that settling second are not tremolo carpet
  const stabOrd = stabByBar.filter((r) => !r.window && r.num >= 2 &&
    r.barInPart > 2 && r.barInPart < 12);
  ok("the tremolo crescendo strikes through the last build bars",
    !!tremBar);
  ok("and stays a build gesture, not a carpet (ordinary bars ≤ 2 stabs)",
    stabOrd.length > 0 && Math.max(...stabOrd.map((r) => r.delta)) <= 2);
  ok("the final chorus earns the same breath-then-impact as the bridge exit",
    /engine\.partLabel === "C" \|\| finalRun/.test(script));
  // drop wall v2 (field report: "the kick on the one after the build just
  // sounds cheap"): the naked sine sweep WAS the cheapness — no attack, no
  // top, no ground. A payoff reads as expensive when the whole spectrum
  // returns at once: the real kick (attack), the sub impact (body), a crash
  // with a reverb tail (top), the bass root (ground), stab and downlifter
  const dropBlock = script.slice(script.indexOf("s === engine.dropAt"),
    script.indexOf("dropCount++"));
  ok("the drop wall opens with the real kick", /kick\(t/.test(dropBlock));
  ok("… carries the sub impact underneath", /impact\(t\)/.test(dropBlock));
  ok("… splashes a crash on top", /crash\(t/.test(dropBlock));
  ok("… and puts the bass root back on the one", /bassNote\(/.test(dropBlock));
  ok("the drop strikes a chord on the one, not only a kick",
    /stabChord\(t, progEff\[ci\], 0\.16\)/.test(script) &&
    /hat\(t, true, 0\.14\)/.test(script));
  // crash v3 (field report: "a torn tin roof, the hiss is foreground and
  // penetrant"): filtered noise IS a tin roof — a cymbal's identity lives
  // in inharmonic metallic partials, which is exactly what MetalSynth is
  // built from. LIFTED from the v2 noise pins: the crash is a synthesized
  // cymbal now, its top rolled off so the shimmer sits behind the wall
  ok("the crash is a cymbal (MetalSynth), not torn noise",
    /crashS = reg\(new Tone\.MetalSynth\(/.test(script));
  ok("… with its hiss rolled off",
    /crashLp = reg\(new Tone\.Filter\(\{ frequency: 8500, type: "lowpass" \}\)\)/.test(script));
  ok("… ringing into the room behind the wall",
    /crashS\.chain\(crashLp, busFx\)/.test(script) &&
    /crashS\.volume\.value = db\(0\.16\)/.test(script));
  ok("the crash really strikes at the drop, " +
    ((seam().nodes && seam().nodes.crash) ? seam().nodes.crash.trigs : "?") +
    " strikes for " + seam().drops + " drops",
    !!seam().nodes && !!seam().nodes.crash &&
    seam().nodes.crash.trigs >= seam().drops && seam().drops >= 2);
  // snare v2 (field report: thin and mechanical, worst in the build): a
  // full backbeat strikes a snap layer on top of noise and body; ghosts and
  // roll hits stay soft AND vary their color per hit, so sixteen of them
  // read as a drummer, not a machine gun
  const sn = seam().nodes || {};
  ok("full snares carry the snap layer, ghosts do not",
    !!sn.snap && sn.snap.trigs > 0 && sn.snap.trigs < sn.snare.trigs);
  // the hook trim ("the hook is much too loud" — 2026-08-12 field test):
  // one gain before hookLp scales the dry path AND every send (delay,
  // reverb, throw) together, so the balance inside the hook's room
  // survives the step back
  ok("the hook steps back through one trim, wet and dry together",
    /hookAir\.connect\(hookTrim\); hookTrim\.connect\(hookLp\);/.test(script) &&
    /hookTrim = reg\(new Tone\.Gain\(0\.74\)\)/.test(script));
  // roll v3 ("the build snare sounds like a tin can"): a bandpassed noise
  // burst ringing at 1500–2000 Hz IS a tin can once sixteen of them stand
  // in the foreground. The producer's classic: the roll STARTS dark and
  // opens with the build — and every roll hit gets a whisper of body so
  // the noise is grounded, not hollow
  ok("roll hits start dark and open with the build",
    /roll >= 0 \? 950 \+ 150 \* roll \+ 200 \* Math\.random\(\)/.test(script));
  ok("groove hits keep their wandering color",
    /: 1500 \+ 500 \* Math\.random\(\)/.test(script));
  ok("roll hits carry a whisper of body",
    /snareBody\.triggerAttackRelease\(150, 0\.05/.test(script));
  ok("the build's roll really passes its segment — and climbs within the bar",
    /snare\(hum\(t, pos\), vel\(v \* wake\), pos % 4 !== 0, buildSeg \+ pos \/ 16\)/.test(script));

  // ---- the DJ school (field report: "learn from the best — maybe the
  // whole path is wrong"): it half was. A four-bar build is a fill-level
  // gesture; the pros build over 16-64 bars in STAGES, and the strongest
  // tools were missing entirely. The final-chorus build now spans EIGHT
  // bars in two halves: the CLEARING (bars 8-11 — the low end leaves, a
  // bar-end snare accent marches, the hook is teased quietly) and the
  // CLIMB (bars 12-15 — the existing ride, roll, room and tremolo). The
  // last bar pulls the kick; the drop returns bass, kick and the world
  // the C-rebuild keeps its designed two-bar tail (the breakdown owns its
  // first half), so the 8-bar clearing rule applies to the NON-bridge road
  // into the final chorus. A single hit per bar stays allowed: the push/
  // sync anticipation pickup plays an octave up — mid register, not the
  // low end the clearing removes
  // describe().bar is 1-based (barInPart + 1): engine build bars 8-15 are
  // ledger rows 9-16
  const fw = (a) => a.filter((r) => r.window && r.label !== "C");
  const buildBass = fw(bassByBar).filter((r) => r.barInPart >= 9 && r.barInPart <= 16);
  const plainBass = bassByBar.filter((r) => !r.window &&
    r.barInPart > 2 && r.barInPart < 9);
  ok("the low end LEAVES the build (bars 8-15 at most a pickup), saw " +
    buildBass.map((r) => r.delta).join(","),
    buildBass.length >= 4 && buildBass.every((r) => r.delta <= 1) &&
    buildBass.filter((r) => r.delta === 0).length >= buildBass.length / 2);
  ok("and plays on plain bars (non-vacuity), max " +
    Math.max(...plainBass.map((r) => r.delta)),
    plainBass.length > 0 && plainBass.some((r) => r.delta > 1));
  const lastBuildKick = fw(kickByBar).filter((r) => r.barInPart === 16);
  const earlyBuildKick = fw(kickByBar).filter((r) => r.barInPart >= 9 && r.barInPart <= 14);
  ok("the kick leaves only the LAST build bar, saw " +
    lastBuildKick.map((r) => r.delta).join(","),
    lastBuildKick.length >= 1 && lastBuildKick.every((r) => r.delta === 0));
  ok("and drives through the rest of the build (non-vacuity)",
    earlyBuildKick.some((r) => r.delta > 0));
  // the kick-out is pinned at source: in THIS walk the 48-bar breather
  // happens to clear the same final bars (48 = 3×16, the B40 collision),
  // so the behavioral zeros alone cannot see the rule — but a drive whose
  // push keeps the breather away still needs it
  ok("the kick-out rule exists and gates the groove",
    /const buildKickOut = !lean && formStage === 7;/.test(script) &&
    /!breather && !bridgeDown && !buildKickOut/.test(script));
  ok("the build spans eight bars at source",
    /finalRun && bar % 16 >= 8 \? bar % 16 - 8/.test(script));
  ok("a bar-end snare accent marches through the clearing (the Pryda mark)",
    /if \(!lean && formStage >= 0 && formStage <= 5 && pos === 12\)/.test(script));
  ok("the hook is teased into the cleared stage",
    /if \(!lean && \(formStage === 0 \|\| formStage === 2\) && pos === 0 &&/.test(script));
  // the machine takes over: a shuffled roll reads as stumbling ("abgehakt"),
  // so the build sheds the groove's swing stage by stage — and the drop
  // brings the swing back with the groove, one more release signal
  ok("the build straightens the swing at source",
    /engine\.groove\.swing \* \(buildOn \? \[0\.7, 0\.45, 0\.2, 0\]\[buildSeg\] : 1\)/.test(script));
  // the woosh ("clicks sometimes, and comes really often"): fillSwell used
  // to STEP from its peak straight to silence — a waveform discontinuity,
  // audible whenever the downbeat did not mask it. And the noise flavors
  // owned two thirds of every phrase end
  ok("the swell ramps down from its peak, never steps",
    /linearRampToValueAtTime\(0\.11, t \+ dur\);\s*\n\s*g\.gain\.exponentialRampToValueAtTime\(0\.0001, t \+ dur \+ 0\.06\)/.test(script) &&
    !/setValueAtTime\(0\.0001, t \+ dur \+ 0\.01\)/.test(script));
  ok("the drum answer owns most phrase ends, noise the exception",
    /FILLS = \["toms", "toms", "toms", "sweep", "swell"\]/.test(script));
  ok("and the flavor draw rides the composition dice",
    /engine\.fill = FILLS\[Math\.floor\(dicer\("flav:" \+ bar\)\(\) \* FILLS\.length\)\]/.test(script));
  ok("two pieces of transitions, zero engine errors", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 2. the drop's release half exists and the drop path stays healthy ------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  // the downlifter lives on native one-shot nodes the stub cannot count, so
  // the wiring is pinned at source level (canary-verified) and the drop path
  // is driven for real to prove it does not hurt the step
  ok("the falling sweep exists and mirrors the riser",
    /function fallSweep\(/.test(script) && /fallSweep\(t, SPB \* 6\)/.test(script));
  let t = 0, s = 0, drops = 0;
  while (s < 16 * 16 * 16) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const tr = Frunky.__transition ? Frunky.__transition() : {};
    drops = tr.drops || 0;
    if (drops > 0 && s % 16 === 15) break;
    s++;
  }
  ok("the run really dropped (non-vacuity), got " + drops, drops >= 1);
  ok("and the drop with its downlifter cost zero errors", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("TRANSITION_OK");
