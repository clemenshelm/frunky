// The warp — an acoustic hyperspace jump. The field report named two faults
// of acceleration: two basses in conflict (the thrust growl and the thrust
// sub droned the TONIC under every chord — a fixed pitch against a walking
// bass, and below ~100 Hz even consonant intervals land in one critical band
// and read as mud), and the wish that under a hard push the ordinary music
// should recede the way stars become streaks. Psychoacoustics backs that:
// under high sympathetic arousal, hearing narrows ("auditory exclusion" —
// sounds report as muffled and distant), and the middle-ear reflex damps
// transmission. Film sound has codified it: the score ducks and lowpasses,
// the mechanical roar stays near.
//
// So: the force voices (growl, thrust sub, rise figure, brake pressure) are
// PITCH-BOUND to the current chord root and stay NEAR, while a hard push
// pulls the harmonic and lead layers back — muffled, quieter, further away —
// and a steady cruise releases them again. The bass also steps back a touch
// globally (headphone report: too present; the cabin adds low end on top).
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

// ---- 1. one bass: the force voices follow the harmony -----------------------
{
  const Frunky = boot(0.03);
  await Frunky.start();
  ok("the __drive seam exists", typeof Frunky.__drive === "function");
  // the growl is pitched per call from the current root — pinned as source,
  // because the stub does not record trigger frequencies
  ok("the growl rides the current chord root",
    (script.match(/growlNote\([^;]+rootsEff\[ci\]\);/g) || []).length >= 2);
  // the thrust sub GLIDES to each bar's root: drive two pieces and collect
  // the sub's frequency at every barline — a fixed drone shows one value
  const seen = new Set();
  let t = 0, s = 0;
  while (s < 16 * 16 * 8 && (!Frunky.__set().piece || Frunky.__set().piece.num < 3)) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    if (s % 16 === 8) {
      const d = Frunky.__drive ? Frunky.__drive() : null;
      if (d && typeof d.thrustSubFreq === "number") seen.add(+d.thrustSubFreq.toFixed(2));
    }
    s++;
  }
  const freqs = [...seen];
  ok("the thrust sub moves with the harmony (≥ 3 roots), saw " + freqs.join(","),
    freqs.length >= 3);
  ok("and stays in the sub register (35..75 Hz)",
    freqs.length > 0 && freqs.every((f) => f >= 35 && f <= 75));
  ok("zero errors with the moving sub", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 2. the warp: a hard push pulls the music back, cruise releases it ------
{
  const Frunky = boot(0.03);
  await Frunky.start();
  let t = 0, s = 0, speed = 0;
  // hard sustained sprint: ~16 km/h/s to 140
  while (speed < 140) {
    for (let f = 0; f < 4; f++) {
      speed = Math.min(140, speed + 16 * (SPB / 4));
      Frunky.update(SPB / 4, { speed, lateralG: 0 });
    }
    transport.cb(t); t += SPB; s++;
  }
  const hot = Frunky.__drive();
  // "could be a bit more pronounced" — the full warp now closes to the
  // low kilohertz and takes a solid third off the music band
  ok("under a hard push the music muffles hard (warp lp < 2 kHz), got " +
    Math.round(hot.warpLpFreq), hot.warpLpFreq < 2000);
  ok("and steps back by almost half (warp gain < 0.6), got " + hot.warpGain.toFixed(2),
    hot.warpGain < 0.6);
  ok("the warp state really engaged, got " + hot.warp.toFixed(2), hot.warp > 0.5);
  // then a steady cruise: the world comes back
  for (let i = 0; i < 16 * 12; i++) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 140, lateralG: 0 });
    transport.cb(t); t += SPB; s++;
  }
  const cool = Frunky.__drive();
  ok("a steady cruise releases the warp (lp > 12 kHz), got " +
    Math.round(cool.warpLpFreq), cool.warpLpFreq > 12000);
  ok("and the music stands at full size again, got " + cool.warpGain.toFixed(2),
    cool.warpGain > 0.95);
  // the force voices stay NEAR: the rise figure does not run through the
  // warped harmony bus, and the brake pressure bypasses the brake muffle
  const r = Frunky.__rise();
  const dn = Frunky.__drive().nodes;
  ok("the rise figure stands with the force voices, not in the warped band",
    !!r.nodes && !!dn && !r.nodes.hp.outs.has(dn.busHarm) && r.nodes.hp.outs.has(dn.busDrive));
  ok("the brake pressure bypasses the tension muffle",
    !!dn && dn.brakeGain.outs.has(dn.masterHp) && !dn.brakeGain.outs.has(dn.busFx));
  ok("zero errors across the sprint and release", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 3. the bass steps back a touch -----------------------------------------
{
  const Frunky = boot(0.03);
  await Frunky.start();
  const w = Frunky.__world();
  // headphone report: too present — and a cabin ADDS low end on top of what
  // headphones show. One modest global step back, anchored here so a future
  // "just a touch more" has to move this number consciously
  ok("the bass volume stands at db(1.05), got " + w.nodes.bass.volume.value.toFixed(3),
    Math.abs(w.nodes.bass.volume.value - 20 * Math.log10(1.05)) < 1e-9);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("WARP_OK");
