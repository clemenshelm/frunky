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
          barInPart: d.bar, num: d.num };
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
  const ordinary = snareByBar.filter((r) => !r.window && r.barInPart > 2 && r.barInPart < 12);
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
  ok("the crash is high noise with a real tail into the room",
    /function crash\(t\)[\s\S]{0,700}?highpass[\s\S]{0,700}?busFx/.test(script));
  // crash v2 (field report: "sounds like a small splash, not a solid
  // crash — and a bit too present"): a highpass at 5200 removed ALL body,
  // which is exactly the difference between a splash and a crash. The
  // body starts at 3400, the tail rings a full two seconds, and the level
  // steps back so the wall carries the hit, not the cymbal
  ok("the crash keeps its body (highpass at 3400, not splash-high)",
    /function crash\(t\)[\s\S]{0,400}?hp\.frequency\.value = 3400/.test(script));
  ok("… rings a real tail (2 s)",
    /function crash\(t\)[\s\S]{0,700}?exponentialRampToValueAtTime\(0\.0001, t \+ 2\)/.test(script));
  ok("… and steps back in the mix",
    /function crash\(t\)[\s\S]{0,600}?setValueAtTime\(0\.22, t\)/.test(script));
  // snare v2 (field report: thin and mechanical, worst in the build): a
  // full backbeat strikes a snap layer on top of noise and body; ghosts and
  // roll hits stay soft AND vary their color per hit, so sixteen of them
  // read as a drummer, not a machine gun
  const sn = seam().nodes || {};
  ok("full snares carry the snap layer, ghosts do not",
    !!sn.snap && sn.snap.trigs > 0 && sn.snap.trigs < sn.snare.trigs);
  ok("roll hits vary their color per hit",
    /snareBp\.frequency\.setValueAtTime\(1500/.test(script));
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
