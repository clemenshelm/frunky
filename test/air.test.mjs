// The air — arrangement breathing. Field report 2026-08-13: "very many
// CONTINUOUS organs and flutes — tiring over time. The background
// eighth-runs get on the nerves too. We need much more variation."
//
// The craft answer is subtraction, not new layers: a band breathes at
// phrase ends, a synth carpet does not unless told to. Per absolute
// 8-bar window (the dawn lesson: window phase must never depend on entry
// time), keyed dice decide two independent things:
//   – the PAD breathes: the wash swells and RELEASES, ringing only part
//     of its slot — the air before the next voicing is arrangement, not
//     a dropout — and the octave-up triangle layer (the "flute") rests;
//   – the ARP rests the phrase end: bars 7-8 of the phrase go tacet
//     after one long exhale note on the first of bar 7.
// Never under the lift, the clearing, a breather, the bridge or the DJ
// build — those states own the floor.
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

// ---- 1. the air windows breathe the carpet and rest the arp -----------------
// One long town drive (no flow, no lift), read per bar: the window state,
// the pad's scheduled ring time, the flute layer, and the arp's phrase ends.
{
  const Frunky = boot(0.03);
  await Frunky.start();
  const dn = Frunky.__drive();
  ok("the air seam exists", !!dn.air && typeof dn.air.win === "number");
  ok("the arp node is on the drive seam", !!dn.nodes && !!dn.nodes.arp);

  const BARS = 224;
  const perBar = []; // {airNow, padAir, arpAir, win, style, fill, padCalls:[{t,d}], triD, arpBar6}
  let t = 0;
  let prevPadTrigs = 0, prevTriTrigs = 0, prevArpTrigs = 0;
  let padCallsSeen = 0;
  let cur = null;
  for (let s = 0; s < BARS * 16; s++) {
    const pos = s % 16, bar = Math.floor(s / 16);
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    if (pos === 0) {
      // read AFTER the barline callback: the latch moves inside it
      const d = Frunky.__drive();
      cur = { bar, airNow: d.air.now, padAir: d.air.pad, arpAir: d.air.arp,
        win: d.air.win, style: d.padStyle, lift: d.lift.active,
        padCalls: [], triD: 0, arpD: 0 };
      perBar.push(cur);
    }
    const pad = Frunky.__drive().nodes.pad;
    const tri = Frunky.__drive().nodes.padTri;
    const arp = Frunky.__drive().nodes.arp;
    if (pad.trigs > prevPadTrigs) {
      const fresh = pad.calls.slice(-(pad.trigs - prevPadTrigs));
      for (const c of fresh) cur.padCalls.push({ t: c[2], d: c[1] });
      prevPadTrigs = pad.trigs;
      padCallsSeen += fresh.length;
    }
    if (tri && tri.trigs > prevTriTrigs) { cur.triD += tri.trigs - prevTriTrigs; prevTriTrigs = tri.trigs; }
    if (arp.trigs > prevArpTrigs) { cur.arpD += arp.trigs - prevArpTrigs; prevArpTrigs = arp.trigs; }
    // the airNow latch may only move at a barline: read it back mid-bar
    if (pos === 8) {
      ok("airNow holds inside bar " + bar,
        Frunky.__drive().air.now === cur.airNow);
    }
  }
  ok("the drive really produced wash chords", padCallsSeen > 50);

  // window state moves only when the absolute 8-bar window moves
  for (let i = 1; i < perBar.length; i++) {
    const a = perBar[i - 1], b = perBar[i];
    if (a.win === b.win && (a.padAir !== b.padAir || a.arpAir !== b.arpAir)) {
      ok("air state flipped inside window at bar " + b.bar, false);
      break;
    }
  }
  const winOf = (bar) => Math.floor(bar / 8);
  for (const pb of perBar) {
    if (winOf(pb.bar) !== pb.win) { ok("window is the absolute 8-bar grid, bar " + pb.bar, false); break; }
  }

  // classify pure windows (skip windows that touch a lift or broken style,
  // and the first window — the piece is still waking up)
  const wins = new Map();
  for (const pb of perBar) {
    if (!wins.has(pb.win)) wins.set(pb.win, []);
    wins.get(pb.win).push(pb);
  }
  const pure = (bars, key, val) => bars.length === 8 &&
    bars.every((b) => b[key] === val && !b.lift && b.style !== "broken");
  let airCov = [], normCov = [];
  let airTri = 0, airTriBars = 0, normTri = 0, normTriBars = 0;
  // the ghost theme deliberately rides padTri — a curated event, not the
  // carpet's flute layer, and the air makes room for exactly such events
  const ghostBars = new Set(Frunky.__motif().ghosts.map((g) => g.bar));
  for (const [w, bars] of wins) {
    if (w === 0 || bars.length < 8) continue;
    const wStart = bars[0].bar * 16 * SPB, wEnd = wStart + 8 * 16 * SPB;
    // scheduled ring time of the wash across the window (union of intervals)
    const iv = [];
    for (const b of bars) for (const c of b.padCalls) {
      const s0 = Math.max(c.t, wStart), s1 = Math.min(c.t + c.d, wEnd);
      if (s1 > s0) iv.push([s0, s1]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let covered = 0, end = -1;
    for (const [s0, s1] of iv) {
      if (s0 > end) { covered += s1 - s0; end = s1; }
      else if (s1 > end) { covered += s1 - end; end = s1; }
    }
    const cov = covered / (wEnd - wStart);
    if (pure(bars, "airNow", true)) {
      airCov.push(cov);
      if (!bars.some((b) => ghostBars.has(b.bar))) {
        airTri += bars.reduce((n, b) => n + b.triD, 0); airTriBars += 8;
      }
    } else if (pure(bars, "airNow", false) && bars.every((b) => b.padAir === false)) {
      normCov.push(cov);
      normTri += bars.reduce((n, b) => n + b.triD, 0); normTriBars += 8;
    }
  }
  ok("the drive produced breathing windows (" + airCov.length + ") and normal ones (" +
    normCov.length + ")", airCov.length >= 2 && normCov.length >= 2);
  ok("a breathing window leaves real air (ring < 0.8 of the window), got " +
    airCov.map((c) => c.toFixed(2)).join(","), airCov.every((c) => c < 0.8));
  // the voicings that DO play stay full-length: the air rests whole chords,
  // it never clips them (clipping = pumping = the wash.test hole). Barline
  // voicings only — anticipations are short lead-ins by design
  {
    let airMainDurs = [];
    for (const [w, bars] of wins) {
      if (w === 0 || !pure(bars, "airNow", true)) continue;
      for (const b of bars) for (const c of b.padCalls) {
        const phase = (c.t / (16 * SPB)) % 1;
        if (phase < 0.03 || phase > 0.97) airMainDurs.push(c.d);
      }
    }
    ok("air voicings ring full length (>= 15 steps), got min " +
      (airMainDurs.length ? (Math.min(...airMainDurs) / SPB).toFixed(1) : "none"),
      airMainDurs.length > 0 && airMainDurs.every((d) => d >= SPB * 15));
  }
  ok("a normal window stays a carpet (ring > 0.9), got " +
    normCov.map((c) => c.toFixed(2)).join(","), normCov.every((c) => c > 0.9));
  ok("the flute layer rests in breathing windows (0 triangle notes), got " + airTri,
    airTriBars === 0 || airTri === 0);
  ok("and plays in normal ones", normTriBars === 0 || normTri > 0);

  // the arp's phrase end: bar 7 of an arp-breathing phrase carries exactly
  // the one exhale note; a normal phrase runs its eighths. Measured on
  // bar%8===6 only — bar 8 is the turnaround and may carry a curated
  // sweep fill on the same voice, which is an event, not wallpaper
  let exhaleBars = 0, normalSixes = 0;
  for (const pb of perBar) {
    if (pb.bar % 8 !== 6 || pb.lift || winOf(pb.bar) === 0) continue;
    if (pb.arpAir) {
      exhaleBars++;
      ok("arp bar 7 of a breathing phrase is one exhale, got " + pb.arpD +
        " at bar " + pb.bar, pb.arpD === 1);
    } else {
      normalSixes++;
      ok("arp bar 7 of a normal phrase runs, got " + pb.arpD + " at bar " + pb.bar,
        pb.arpD >= 6);
    }
  }
  ok("both phrase-end kinds occurred (" + exhaleBars + "/" + normalSixes + ")",
    exhaleBars >= 2 && normalSixes >= 2);
  ok("zero errors across the air drive", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 2. the exhale rings long -----------------------------------------------
// The tacet must not read as a hole: the last note before the rest is held.
{
  const Frunky = boot(0.03);
  await Frunky.start();
  let t = 0;
  let exhaleDur = 0, townDur = 0;
  let prevArp = 0;
  for (let s = 0; s < 200 * 16; s++) {
    const pos = s % 16, bar = Math.floor(s / 16);
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const arp = Frunky.__drive().nodes.arp;
    if (arp.trigs > prevArp) {
      prevArp = arp.trigs;
      const c = arp.calls[arp.calls.length - 1];
      const d = Frunky.__drive();
      if (d.air.arp && bar % 8 === 6 && pos === 0 && !d.lift.active) {
        exhaleDur = Math.max(exhaleDur, c[1]);
      } else if (!d.air.arp && bar % 8 < 6) {
        townDur = Math.max(townDur, c[1]);
      }
    }
  }
  ok("the exhale note rings past four beats, got " + (exhaleDur / SPB).toFixed(1) +
    " steps", exhaleDur > SPB * 4);
  ok("and clearly longer than the town eighths, town max " +
    (townDur / SPB).toFixed(1), townDur > 0 && exhaleDur > townDur * 1.5);
  Frunky.stop();
  transport.clear();
}

// ---- 3. the guards are the ones designed ------------------------------------
// Source pins WITH their gate conditions (canary lesson: a pin without the
// gate lets a `false &&` mutation survive).
{
  ok("the pad air respects the states that own the floor",
    /engine\.airNow = engine\.padAir && !liftPhase && !engine\.clearingOn\s*&& !breather && !bridgeDown && formStage < 0/.test(script));
  ok("the arp air keeps the lift's and the shimmer's drive",
    /const arpRestBar = engine\.arpAir && !liftPhase && !engine\.shimmerOn && bar % 8 >= 6/.test(script));
  ok("the windows roll on the absolute grid with keyed dice",
    /const aWin = Math\.floor\(bar \/ 8\);/.test(script) &&
    /engine\.padAir = dicer\("padair:" \+ aWin\)\(\) < 0\.35/.test(script) &&
    /engine\.arpAir = dicer\("arpair:" \+ aWin\)\(\) < 0\.45/.test(script));
  // the air rests WHOLE voicings at full length — clipping every chord
  // would read as pumping and re-open the hole-before-the-one wash.test
  // exists to stop. One pin per harmonic-rhythm branch, gate included
  ok("the twobar carpet rests alternate voicings",
    /chPh % 2 === 0 && !\(engine\.airNow && chPh % 4 === 2\)/.test(script));
  ok("the per-bar carpets rest alternate bars (push, sync, bar)",
    (script.match(/pos === 0 && !\(engine\.airNow && bar % 2 === 1\)/g) || []).length >= 3);
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("AIR_OK");
