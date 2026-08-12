// The harmonic palette. "It always uses a very similar chord set" — accurate:
// one global pool of four Am-modal progressions, so every piece told its story
// over the same harmony. Industry practice says harmonic identity is a
// PER-SONG commitment (the axis loop Am-F-C-G carries hundreds of hits as a
// song-level choice; a film cue commits to one harmonic world and lets the
// leitmotif be recolored by it). So the piece now rolls a PALETTE — modal
// (today's pool), sus (suspended/quartal, floating), light (relative-major
// axis loops) — from the mood's pool, the way it already rolls its arc.
//
// The smoothness rules are executable, not vibes, and this file pins them:
// - the pivot rule: every progression in every palette OPENS on the Am9 home
//   voicing, so any section change and any palette change passes through home
// - the consonance rule: every chord tone stays inside the white-note world
//   (plus dorian F#), so the pentatonic material — arps, blips, licks, the
//   LEITMOTIF — remains consonant over every palette by construction
// - the voice-leading rule: adjacent chords (including the loop seam back to
//   the top) always share a pitch class — the common-tone craft that makes
//   chorale writing smooth, stated as an assertion
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

const KEY = "frunky.set.v1";
const HOME = JSON.stringify([57, 64, 67, 71]); // the Am9 pivot voicing
const NAMES = ["modal", "sus", "light", "lament"];

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
      const pal = Frunky.__palette();
      seen.push({ num: p.num, mood: p.mood, palette: pal.name,
        pieceProgs: pal.pieceProgs ? pal.pieceProgs.slice() : null });
    }
  }
  state.lastNum = lastNum;
  return seen;
}
const pcs = (chord) => new Set(chord.map((m) => ((m % 12) + 12) % 12));

// ---- 1. the tables: three palettes, pinned rules ----------------------------
{
  const Frunky = boot(0.03, makeStore());
  ok("the __palette seam exists", typeof Frunky.__palette === "function");
  const pal = Frunky.__palette();
  const t = pal.tables;
  ok("exactly the three palettes exist",
    !!t && JSON.stringify(Object.keys(t).sort()) === JSON.stringify(NAMES.slice().sort()));

  ok("modal is today's pool, unchanged — four progressions",
    t && t.modal && t.modal.progs.length === 4 &&
    JSON.stringify(t.modal.progs[0]) === JSON.stringify(
      [[57, 64, 67, 71], [53, 60, 64, 67], [55, 59, 62, 69], [57, 64, 67, 71]]));
  ok("sus and light each bring at least three progressions",
    t && t.sus && t.sus.progs.length >= 3 && t.light && t.light.progs.length >= 3);

  for (const name of NAMES) {
    const P = t ? t[name] : null;
    if (!P) continue;
    ok(`${name}: roots and next run parallel to the progressions`,
      P.roots.length === P.progs.length && P.next.length === P.progs.length);
    P.progs.forEach((prog, pi) => {
      // the pivot rule — every progression opens at home
      ok(`${name}[${pi}] opens on the Am9 home voicing`,
        JSON.stringify(prog[0]) === HOME);
      prog.forEach((chord, ci) => {
        // the consonance rule — white-note world plus dorian F#, and never
        // F against F# inside one chord
        const cls = pcs(chord);
        ok(`${name}[${pi}][${ci}] stays inside the modal note world`,
          [...cls].every((c) => [0, 2, 4, 5, 6, 7, 9, 11].includes(c)));
        ok(`${name}[${pi}][${ci}] never stacks F against F#`,
          !(cls.has(5) && cls.has(6)));
        // the bass agrees with the chord it carries
        const rootPc = ((P.roots[pi][ci] % 12) + 12) % 12;
        ok(`${name}[${pi}][${ci}] root belongs to its chord`, pcs(chord).has(rootPc));
        // the voice-leading rule — common tone with the NEXT chord, and the
        // loop seam (last chord back to the top) counts as adjacency too
        const next = prog[(ci + 1) % prog.length];
        const shared = [...cls].filter((c) => pcs(next).has(c));
        ok(`${name}[${pi}][${ci}] shares a tone with its successor`, shared.length >= 1);
      });
      // the neighbour graph — valid indexes, never a self-loop
      ok(`${name}[${pi}] neighbours are valid and never itself`,
        P.next[pi].length >= 1 &&
        P.next[pi].every((n) => Number.isInteger(n) && n !== pi && !!P.progs[n]));
    });
  }

  // the mood chooses the palette the way it chooses the arc — pinned pools
  // lament: the Andalusian descent — romantic-minor gravity (the Muse
  // element), at home wherever the set broods or peaks
  ok("deep floats and broods: sus, lament, modal",
    JSON.stringify(pal.pool.deep) === JSON.stringify(["sus", "lament", "modal"]));
  ok("neutral grounds: modal and light", JSON.stringify(pal.pool.neutral) === JSON.stringify(["modal", "light"]));
  ok("anthem carries brightness and grandeur: light, lament, modal",
    JSON.stringify(pal.pool.anthem) === JSON.stringify(["light", "lament", "modal"]));
}

// ---- 2. behavior: the mood picks the palette, the walk survives changes -----
{
  const store = makeStore();
  const Frunky = boot(0.03, store);
  await Frunky.start();
  const state = { t: 0 };
  const run = await drive(Frunky, 8, state);
  const pal = Frunky.__palette();
  const pool = pal.pool;
  ok("every piece draws its palette from its mood's pool",
    run.every((r) => pool[r.mood] && pool[r.mood].includes(r.palette)));
  ok("the run is not vacuous: at least two palettes actually sounded — saw " +
    JSON.stringify([...new Set(run.map((r) => r.palette))]),
    new Set(run.map((r) => r.palette)).size >= 2);
  // the walk-reset guard: after any palette change, every part's progression
  // index must still point inside the NEW palette's pool — an out-of-range
  // index is exactly the crash a palette switch would smuggle in
  ok("every part of every piece indexes inside its own palette's pool",
    run.every((r) => r.pieceProgs &&
      r.pieceProgs.every((i) => Number.isInteger(i) && !!pal.tables[r.palette].progs[i])));
  ok("eight pieces across palette changes, zero engine errors",
    Frunky.health().errors === 0);
  // the persistence: the payload names the palette
  const saved = JSON.parse(store.raw.get(KEY));
  ok("the palette persists with the residency", NAMES.includes(saved.pal));
  Frunky.stop();
  transport.clear();
}

// ---- 3. the bench names the harmony -----------------------------------------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  const state = { t: 0 };
  await drive(Frunky, 1, state);
  const d = Frunky.describe();
  ok("describe carries the Harmonik chip",
    !!(d && d.chips && d.chips.some((c) => c[0] === "Harmonik" && NAMES.includes(c[1]))));
  Frunky.stop();
  transport.clear();
}

// ---- 4. migration: old and hostile payloads never cost the episode ----------
{
  // a pre-palette payload (old data, new code) resumes and simply rolls
  const old = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 4, tp: 2, progIdx: 1 }) });
  const Frunky = boot(0.05, old);
  await Frunky.start();
  const state = { t: 0, lastNum: 0 };
  const run = await drive(Frunky, 1, state);
  ok("a pre-palette payload still resumes its episode, got " + run[0].num,
    run[0].num === 5);
  ok("and its palette is a valid one", NAMES.includes(run[0].palette));
  ok("without a single engine error", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}
{
  // an unknown palette name is discarded on its own — same doctrine as the
  // corrupt motif: the field dies, the episode survives
  const bad = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 4, tp: 2, progIdx: 1, pal: "xyz" }) });
  const Frunky = boot(0.05, bad);
  await Frunky.start();
  const state = { t: 0, lastNum: 0 };
  const run = await drive(Frunky, 1, state);
  ok("an unknown palette name is discarded, the episode survives, got " + run[0].num,
    run[0].num === 5);
  ok("with zero errors", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}
{
  // a walk position that lies about its palette (index outside the claimed
  // pool) poisons the whole payload — that is the existing progIdx strictness,
  // now palette-aware
  const lie = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 4, tp: 2, progIdx: 3, pal: "sus" }) });
  const Frunky = boot(0.05, lie);
  await Frunky.start();
  const state = { t: 0, lastNum: 0 };
  const run = await drive(Frunky, 1, state);
  ok("an out-of-range walk for the claimed palette starts a fresh set, got " + run[0].num,
    run[0].num === 1);
  ok("with zero errors", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 5. the walk-reset: the dangerous state, made deterministic -------------
{
  // a resumed walk standing on modal's LAST progression (index 3) meets a
  // piece that changes palette to sus (only three progressions). Without the
  // reset to home, the neighbour lookup runs off the smaller pool — the
  // 8-piece run above may never produce this by dice, so the payload forces
  // it rather than hoping
  const store = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 4, tp: 2, progIdx: 3, pal: "modal" }) });
  const Frunky = boot(0.03, store);
  await Frunky.start();
  let t = 0, p = null;
  // bounded stepping: a crashing newPiece must fail assertions, never hang
  for (let i = 0; i < 3000 && !p; i++) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    p = Frunky.__set().piece;
  }
  const pal = Frunky.__palette();
  ok("the resumed piece exists and is episode five, got " + (p && p.num),
    !!p && p.num === 5);
  ok("the danger is real: the palette actually left modal, got " + pal.name,
    pal.name === "sus");
  ok("and every part indexes inside the smaller pool",
    !!pal.pieceProgs && pal.pieceProgs.every((i) => !!pal.tables.sus.progs[i]));
  ok("zero errors across the forced palette change", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PALETTE_OK");
