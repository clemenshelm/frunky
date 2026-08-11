// The DJ set: dramaturgy across pieces, and episodes across drives.
//
// Within one drive, the mood of each piece follows a SET WAVE — warm-up,
// build, peak, breathe, rebuild, double peak — instead of a dice roll. The
// peaks are earned by the valleys, which is what makes minute 35 different
// from minute 3.
//
// Across drives, the engine is a residency, not a jukebox: the set state
// (piece number, key, progression-walk position) persists in localStorage,
// so a daily 10-minute commute is the NEXT EPISODE of a running set rather
// than a reset to episode one. The state is versioned and validated — a
// corrupt or hostile store must never crash the music, only start a fresh set.
//
// These tests drive the engine by hand (like sequencer.test.mjs) and read the
// __set() seam: { wave, resumed, piece: { num, tp, mood, progA, progB } }.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

const KEY = "frunky.set.v1";
// the head of the wave, pinned: a set OPENS deep (warm-up), builds, and
// reaches its first peak on piece three — not before
const WAVE_HEAD = ["deep", "neutral", "anthem"];

function makeStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// a fresh engine instance per "drive" — same pattern as the sequencer fuzz.
// `store` becomes window.localStorage; `mutate` may reshape the window first.
function boot(seed, store, mutate) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  const w = { Tone: globalThis.Tone };
  if (store) w.localStorage = store;
  if (mutate) mutate(w);
  globalThis.window = w;
  eval(script);
  return globalThis.window.Frunky;
}

// drive at a steady cruise and collect each new piece as it is rolled
function drivePieces(Frunky, steps, state) {
  const seen = [];
  let last = 0;
  for (let i = 0; i < steps; i++) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(state.t);
    state.t += SPB;
    const st = Frunky.__set ? Frunky.__set() : null;
    if (st && st.piece && st.piece.num !== last) { last = st.piece.num; seen.push(st.piece); }
  }
  return seen;
}

// ---- 1. the wave replaces the dice -----------------------------------------
// Two different random walks must produce the SAME mood sequence — the moods
// are dramaturgy now, not a pool. A piece is 7 parts x 16 bars = 1792 steps.
for (const seed of [0.377, 0.641]) {
  const Frunky = boot(seed, null);
  ok("the __set seam exists", typeof Frunky.__set === "function");
  await Frunky.start();
  const pieces = drivePieces(Frunky, 3600, { t: 0 });
  const moods = pieces.map((p) => p.mood).join(",");
  ok(`seed ${seed}: three pieces played, got ${pieces.length}`, pieces.length === 3);
  ok(`seed ${seed}: the set opens ${WAVE_HEAD.join(",")}, got ${moods}`,
    moods === WAVE_HEAD.join(","));
  ok(`seed ${seed}: pieces are numbered 1,2,3, got ` + pieces.map((p) => p.num).join(","),
    pieces.map((p) => p.num).join(",") === "1,2,3");
  Frunky.stop();
  transport.clear();
}

// the wave itself must use the full mood palette — an arc that never peaks
// (or never breathes) is a flatline with extra steps
{
  const Frunky = boot(0.113, null);
  const st = Frunky.__set ? Frunky.__set() : null;
  const wave = (st && st.wave) || [];
  ok("the wave spans at least 6 pieces, got " + wave.length, wave.length >= 6);
  for (const m of ["deep", "neutral", "anthem"]) {
    ok(`the wave visits "${m}"`, wave.includes(m));
  }
  transport.clear();
}

// ---- 2. the set survives the drive boundary --------------------------------
{
  const store = makeStore();
  const FrunkyA = boot(0.209, store);
  await FrunkyA.start();
  drivePieces(FrunkyA, 1800, { t: 0 }); // piece 2 is rolled at step 1792
  const savedRaw = store.getItem(KEY);
  ok("the set state is persisted at piece boundaries", !!savedRaw);
  let saved = {};
  try { saved = JSON.parse(savedRaw) || {}; } catch (err) { void err; }
  ok("saved state carries the running piece number 2, got " + saved.num, saved.num === 2);
  const endTp = FrunkyA.__set && FrunkyA.__set().piece && FrunkyA.__set().piece.tp;
  ok("saved key mirrors the piece that was playing", saved.tp === endTp);
  ok("saved progression index is a valid pool position",
    Number.isInteger(saved.progIdx) && saved.progIdx >= 0 && saved.progIdx <= 3);
  FrunkyA.stop();
  transport.clear();

  // the next drive is the next episode: numbering continues, the wave
  // continues (position 3 = the first peak), the key moves on
  const FrunkyB = boot(0.5, store);
  await FrunkyB.start();
  drivePieces(FrunkyB, 2, { t: 0 });
  const p = FrunkyB.__set && FrunkyB.__set().piece;
  ok("the next drive continues the set: piece 3, got " + (p && p.num), !!p && p.num === 3);
  ok("the resumed piece follows the wave (anthem), got " + (p && p.mood),
    !!p && p.mood === "anthem");
  ok("the key moves across the drive boundary", !!p && p.tp !== saved.tp);
  ok("the progression walk continues where the set stood, got " +
    (p && p.progA) + " expected " + saved.progIdx, !!p && p.progA === saved.progIdx);
  FrunkyB.stop();
  transport.clear();
}

// the key never repeats across the boundary, whatever the dice say
for (const seed of [0.1, 0.33, 0.77, 0.9]) {
  const store = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 5, tp: 2, progIdx: 1 }) });
  const Frunky = boot(seed, store);
  await Frunky.start();
  drivePieces(Frunky, 2, { t: 0 });
  const p = Frunky.__set && Frunky.__set().piece;
  ok(`resume seed ${seed}: episode 6, got ` + (p && p.num), !!p && p.num === 6);
  ok(`resume seed ${seed}: the key leaves tp 2, got ` + (p && p.tp), !!p && p.tp !== 2);
  ok(`resume seed ${seed}: wave position 6 is neutral, got ` + (p && p.mood),
    !!p && p.mood === "neutral");
  Frunky.stop();
  transport.clear();
}

// ---- 3. the wave cycles ----------------------------------------------------
// after the double peak the set breathes again: episode 9 reads wave[0]
{
  const store = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 8, tp: 0, progIdx: 2 }) });
  const Frunky = boot(0.42, store);
  await Frunky.start();
  drivePieces(Frunky, 2, { t: 0 });
  const p = Frunky.__set && Frunky.__set().piece;
  ok("episode 9 exists, got " + (p && p.num), !!p && p.num === 9);
  ok("the wave cycles: episode 9 opens deep again, got " + (p && p.mood),
    !!p && p.mood === "deep");
  Frunky.stop();
  transport.clear();
}

// ---- 4. a hostile store never crashes the music ----------------------------
// every rejected payload starts a FRESH set: episode 1, deep warm-up
const FRESH = [
  ["garbage JSON", makeStore({ [KEY]: "{nope" })],
  ["negative piece number", makeStore({ [KEY]: JSON.stringify({ v: 1, num: -2, tp: 0, progIdx: 0 }) })],
  ["unknown schema version", makeStore({ [KEY]: JSON.stringify({ v: 9, num: 3, tp: 0, progIdx: 0 }) })],
  ["key outside the transpose pool", makeStore({ [KEY]: JSON.stringify({ v: 1, num: 3, tp: 7, progIdx: 0 }) })],
  ["progression index out of range", makeStore({ [KEY]: JSON.stringify({ v: 1, num: 3, tp: 0, progIdx: 99 }) })],
  ["getItem throws", { getItem: () => { throw new Error("denied"); }, setItem: () => {} }],
];
for (const [label, store] of FRESH) {
  const Frunky = boot(0.6, store);
  let threw = null;
  try {
    await Frunky.start();
    drivePieces(Frunky, 2, { t: 0 });
  } catch (err) { threw = err; }
  ok(`${label}: start survives, threw ` + (threw && threw.message), !threw);
  const p = Frunky.__set && Frunky.__set().piece;
  ok(`${label}: falls back to a fresh set (episode 1), got ` + (p && p.num), !!p && p.num === 1);
  ok(`${label}: fresh set opens deep, got ` + (p && p.mood), !!p && p.mood === "deep");
  Frunky.stop();
  transport.clear();
}

// a store that refuses writes must not take the sequencer down with it
{
  const store = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  const Frunky = boot(0.25, store);
  let threw = null;
  try {
    await Frunky.start();
    drivePieces(Frunky, 40, { t: 0 });
  } catch (err) { threw = err; }
  ok("a throwing setItem never reaches the sequencer, threw " + (threw && threw.message), !threw);
  const p = Frunky.__set && Frunky.__set().piece;
  ok("the music plays on without persistence, episode 1, got " + (p && p.num), !!p && p.num === 1);
  // the step-level resilience layer would swallow an unguarded throw and
  // count it — persistence failing is expected weather, not an error
  const errs = Frunky.health().errors;
  ok("a refused write is not even an engine error, counted " + errs, errs === 0);
  Frunky.stop();
  transport.clear();
}

// a window whose localStorage GETTER throws (hardened privacy modes do this)
{
  let threw = null;
  let Frunky = null;
  try {
    Frunky = boot(0.8, null, (w) => {
      Object.defineProperty(w, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await Frunky.start();
    drivePieces(Frunky, 2, { t: 0 });
  } catch (err) { threw = err; }
  ok("a blocked localStorage getter never crashes the engine, threw " +
    (threw && threw.message), !threw);
  const p = Frunky && Frunky.__set && Frunky.__set().piece;
  ok("blocked storage still plays a fresh set, got " + (p && p.num), !!p && p.num === 1);
  if (Frunky) Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SET_OK");
