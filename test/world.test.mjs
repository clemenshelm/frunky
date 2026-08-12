// The sound world. "We always use the same instruments" — accurate: pieces
// roll key, mood, recipe, arc, palette and motif, but the orchestra is fixed.
// Orchestration is the last classical identity axis, and in film scoring it
// is THE cue decision: the same leitmotif in strings, at the piano, in a
// synth — recoloring by instrument is stronger than recoloring by harmony.
// The album counterpart bounds it: every track its own arrangement, ONE
// production sound. So worlds are curated preset bundles over the EXISTING
// voices (swap, never stack — render cost stays flat), the backbone (thrust,
// car mix, roles, hook chain) is untouched, and a piece rolls its world like
// its recipe: mood-coupled, never the same twice in a row.
//
// analog is today's sound, pinned verbatim — the reference world doubles as
// the regression pin for the instrument park. Trims exist because physics
// moves loudness when timbre moves (a triangle pad carries ~6 dB less than a
// saw pad); they are bounded so a world can never smuggle in a mix change.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

const NAMES = ["analog", "organic", "neon"];
const SLOTS = ["kick", "hat", "snare", "bass", "pad", "gate", "blip"];

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
async function drive(Frunky, pieces, state) {
  const seen = [];
  let lastNum = state.lastNum || 0;
  const target = lastNum + pieces;
  while (lastNum < target) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(state.t);
    state.t += SPB;
    const p = Frunky.__set().piece;
    if (p && p.num !== lastNum) {
      lastNum = p.num;
      const w = Frunky.__world();
      seen.push({
        num: p.num, mood: p.mood, world: w.name, applied: w.applied,
        kickPd: w.nodes ? w.nodes.kick.settings.pitchDecay : null,
        bassOsc: w.nodes ? w.nodes.bass.settings.oscillator.type : null,
        padOsc: w.nodes ? w.nodes.pad.settings.oscillator.type : null,
        bassVol: w.nodes ? w.nodes.bass.volume.value : null,
        cutScale: w.cutScale,
        bassQ: w.nodes ? w.nodes.bassLp.Q.value : null,
        hookLpF: w.nodes && w.nodes.hookLp ? w.nodes.hookLp.frequency.value : null,
        hookPresG: w.nodes && w.nodes.hookPres ? w.nodes.hookPres.gain.value : null,
      });
    }
  }
  state.lastNum = lastNum;
  return seen;
}

// ---- 1. the tables: three worlds, analog pinned as today ---------------------
{
  const Frunky = boot(0.03, makeStore());
  ok("the __world seam exists", typeof Frunky.__world === "function");
  const w = Frunky.__world();
  const t = w.tables;
  ok("exactly the three worlds exist",
    !!t && JSON.stringify(Object.keys(t).sort()) === JSON.stringify(NAMES.slice().sort()));

  // the reference world IS the current instrument park, value by value —
  // this is the pin that turns "we changed the sound" into a red test
  const a = t ? t.analog : null;
  ok("analog kick is today's kick",
    !!a && a.kick.pitchDecay === 0.08 && a.kick.octaves === 1.9 && a.kick.decay === 0.26);
  ok("analog hats are today's hats", !!a && a.hat.closed === 0.04 && a.hat.open === 0.26);
  ok("analog snare is today's snare", !!a && a.snare.decay === 0.13);
  ok("analog bass is today's bass",
    !!a && a.bass.osc.type === "fattriangle" && a.bass.lp === 480);
  ok("analog pad is today's pad",
    !!a && a.pad.osc.type === "fatsawtooth" && a.pad.attack === 1.1 && a.pad.release === 1.6);
  ok("analog gate is today's gate voice", !!a && a.gate.osc.type === "fattriangle");
  ok("analog blip is today's blip", !!a && a.blip.osc.type === "square");
  ok("the reference world carries zero trims",
    !!a && SLOTS.every((s) => !a[s].trim));

  for (const name of NAMES) {
    const W = t ? t[name] : null;
    if (!W) continue;
    ok(`${name} defines every voice slot`, SLOTS.every((s) => !!W[s]));
    // a trim is a physics compensation, never a mix decision — bounded
    ok(`${name} trims stay within ±4 dB`,
      SLOTS.every((s) => Math.abs(W[s].trim || 0) <= 4));
    // a world may recolor the bass window, never leave the pleasant range:
    // the cut scale rides a drive formula that already reaches ~1550 Hz, so
    // a scale much above 1 turns a saw bass into a rasp (the field report on
    // neon: "viel zu scharf"). Bounded both ways — darker is safe, but a
    // world must stay a color, not a mute
    ok(`${name} keeps its bass window in the pleasant range`,
      !a || (W.bass.lp / a.bass.lp >= 0.6 && W.bass.lp / a.bass.lp <= 1.25));
    // "still piercing, a foreign body": cold must not mean saw-on-saw. A
    // saw wall is what clashed with this record's warm Rhodes and washes —
    // one voice may carry the glass, the rest of the world stays round or
    // hollow. Executable: at most ONE tonal slot per world is saw-family
    ok(`${name} keeps the saw a single pane of glass`,
      ["bass", "pad", "gate", "blip"].filter((s) =>
        (W[s].osc.type || "").includes("saw")).length <= 1);
    // lite devices must have a plain-oscillator variant for every fat voice —
    // a world that forgets one silently loses that voice on the car unit
    ok(`${name} names a lite oscillator for bass, pad and gate`,
      ["bass", "pad", "gate"].every((s) => typeof W[s].lite === "string" && W[s].lite.length > 0));
  }

  // neon v3, after the third field report ("much too loud, unbearable — no
  // improvement"): the square bass was the wrong physics twice over. A square
  // carries ~4.8 dB more RMS than analog's fattriangle at equal peak, and its
  // energy sits in the fundamental and low harmonics — exactly the band a
  // bass lowpass PASSES — so no trim wins that fight. Cold now means CLARITY
  // (tight kick, crisp hats, small room), not hardness: the bass goes
  // triangle in a window darker than analog's, the gate goes hollow, and
  // only the pad keeps the one pane of glass
  const n = t ? t.neon : null;
  ok("neon bass stays in the triangle family, never a square again",
    !!n && String(n.bass.osc.type).includes("triangle") && n.bass.lite === "triangle");
  // v4 after "now a bit too dull": brightness was the wrong lever the
  // whole time — the synthwave answer is MOVEMENT (slight detune) and a
  // touch of filter resonance, not a wider-open window
  ok("neon bass carries detune movement (fat, narrow spread)",
    !!n && n.bass.osc.type === "fattriangle" && n.bass.osc.count === 2 &&
    n.bass.osc.spread <= 8);
  ok("neon bass window sits below analog's",
    !!n && !!a && n.bass.lp < a.bass.lp);
  ok("neon bass has the analog squelch (a touch of resonance)",
    !!n && n.bass.q >= 1.1 && n.bass.q <= 1.6);
  ok("neon gate is hollow, not hard",
    !!n && n.gate.osc.type === "fattriangle" && n.gate.lite === "triangle");
  // the hook rides the same chain in every world, and in neon that chain
  // was the sharpest thing left ("the hook line is quite sharp") — every
  // world now shades the hook: lowpass ceiling and presence gain
  ok("every world shades the hook (lp + pres)",
    NAMES.every((nm) => t && t[nm].hook &&
      t[nm].hook.lp > 0 && typeof t[nm].hook.pres === "number"));
  ok("neon pulls the hook's edge in",
    !!n && !!n.hook && t && t.analog.hook &&
    n.hook.lp < t.analog.hook.lp && n.hook.pres < t.analog.hook.pres);

  // the mood chooses the world the way it chooses arc and palette
  ok("deep is round: organic and analog",
    JSON.stringify(w.pool.deep) === JSON.stringify(["organic", "analog"]));
  ok("neutral is open: all three",
    JSON.stringify(w.pool.neutral) === JSON.stringify(["analog", "organic", "neon"]));
  ok("anthem is cold and bright: neon and analog",
    JSON.stringify(w.pool.anthem) === JSON.stringify(["neon", "analog"]));
}

// ---- 2. behavior: mood picks, never twice in a row, and it really applies ---
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  // the built park IS the analog world, applied at build time — one source
  // of truth. Without this, the constructors in buildGraph are a second copy
  // of analog's values that nothing pins, and a tweak there is silently
  // reverted by the first world application
  ok("the fresh graph has the analog world applied before any piece",
    Frunky.__world().applied === "analog");
  const state = { t: 0 };
  const run = await drive(Frunky, 8, state);
  const w = Frunky.__world();
  ok("every piece draws its world from its mood's pool",
    run.every((r) => w.pool[r.mood] && w.pool[r.mood].includes(r.world)));
  ok("never the same world twice in a row — consecutive pieces differ, saw " +
    run.map((r) => r.world).join("→"),
    run.every((r, i) => i === 0 || r.world !== run[i - 1].world));
  ok("the run is not vacuous: at least two worlds actually sounded",
    new Set(run.map((r) => r.world)).size >= 2);
  // the application proof: the nodes must CARRY the world's values, piece by
  // piece — a rolled label that never reaches an oscillator is a lie
  ok("the applied world tracks the rolled world", run.every((r) => r.applied === r.world));
  ok("the kick carries each piece's world, saw " +
    run.map((r) => r.kickPd).join(","),
    run.every((r) => r.kickPd === w.tables[r.world].kick.pitchDecay));
  // the oscillator, not the static filter value: the bass cutoff is owned by
  // the per-note automation (scaled below), so the honest live-node proof for
  // the bass is its waveform
  ok("the bass oscillator carries each piece's world",
    run.every((r) => r.bassOsc === w.tables[r.world].bass.osc.type));
  ok("the pad oscillator carries each piece's world",
    run.every((r) => r.padOsc === w.tables[r.world].pad.osc.type));
  // the bass cutoff is NOT a static filter value — every bassNote automates
  // it per note (drive-dependent formula), so a world that only set the
  // filter once recolored nothing live. The world must SCALE the per-note
  // cut instead: factor lp/480, anchored on analog's park
  ok("the world's bass color arrives as a cut scale, piece by piece",
    run.every((r) => Math.abs(r.cutScale - w.tables[r.world].bass.lp / 480) < 1e-9));
  ok("and bassNote really multiplies its per-note cut by that scale",
    /setValueAtTime\(cut \* \(engine\.worldCutScale \|\| 1\)/.test(script));
  // v4 additions must ARRIVE at the nodes too, piece by piece: the bass
  // filter's resonance and the hook's shading are world properties now
  ok("the bass filter's resonance carries each piece's world, saw " +
    [...new Set(run.map((r) => r.bassQ))].join(","),
    run.every((r) => r.bassQ === (w.tables[r.world].bass.q || 0.8)));
  ok("the hook's lowpass ceiling carries each piece's world",
    run.every((r) => r.hookLpF === w.tables[r.world].hook.lp));
  ok("the hook's presence gain carries each piece's world",
    run.every((r) => r.hookPresG === w.tables[r.world].hook.pres));
  // the lick sits back, but never collapses: at cruise the regular bass rides
  // ~0.46 while the lick rode a flat 0.18 — heard as the bass dropping out,
  // loudest on a bright world. The lick's velocity must scale with the same
  // fat the regular notes ride (pinned as formula: velocities pass through
  // human jitter, so the shape is the testable truth)
  ok("the lick's velocity rides the drive like the regular bass",
    /vel\(\(0\.16 \+ 0\.18 \* fat\) \* drain \* wake\)/.test(script));
  // the trim proof, base-free: between any two pieces, the bass volume moved
  // by exactly the difference of their worlds' trims — a trim that never
  // reaches a volume knob is a mix promise the music does not keep
  ok("the volume trims really land on the voices",
    run.every((r) => run.every((q) =>
      Math.abs((r.bassVol - q.bassVol) -
        (w.tables[r.world].bass.trim - w.tables[q.world].bass.trim)) < 1e-9)));
  ok("eight pieces of reorchestration, zero engine errors",
    Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 3. the bench names the world -------------------------------------------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  const state = { t: 0 };
  await drive(Frunky, 1, state);
  const d = Frunky.describe();
  ok("describe carries the Klang chip",
    !!(d && d.chips && d.chips.some((c) => c[0] === "Klang" && NAMES.includes(c[1]))));
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("WORLD_OK");
