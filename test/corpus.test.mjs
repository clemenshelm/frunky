// The corpus walk — Markov weights from real music. Research question
// 2026-08-13: "how does our composition system compare to a professional
// one? I would expect Markov chains... maybe there is public data."
//
// Our progression walk always WAS a Markov chain — hand-weighted (uniform
// over curated neighbours). Build 62 keeps the architecture (keyed dice,
// curated pools) and replaces the uniform successor choice with weights
// derived from the de Clercq & Temperley rock corpus (rs200, CC-BY 4.0):
// each loop is scored by the geometric mean of its chord-change transition
// probabilities under 19k+ real-song bigrams, and the walk prefers loops
// real music prefers — weights, never bans, so every curated loop still
// occurs. The pipeline is committed evidence: tools/corpus-bigrams.json is
// the derived data with provenance, tools/derive-corpus-weights.mjs the
// pure derivation, and this file pins that engine.js's WALK_W regenerates
// from them EXACTLY (a table that drifts from its evidence is hand data
// wearing a lab coat).
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";
import { deriveWalkWeights, PALETTE_ROOT_PCS, countBigrams, tokenRootPc }
  from "../tools/derive-corpus-weights.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const bigrams = JSON.parse(
  readFileSync(new URL("../tools/corpus-bigrams.json", import.meta.url), "utf8"));
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

// ---- 1. the committed evidence is real evidence -----------------------------
{
  ok("the bigrams carry provenance (source, url, license)",
    /de Clercq/.test(bigrams.source) && /rockcorpus/.test(bigrams.url) &&
    /CC-BY/.test(bigrams.license));
  ok("the parse read the whole corpus (400 analyses), got " + bigrams.files,
    bigrams.files === 400);
  ok("and found a real transition mass (>= 10000), got " + bigrams.transitions,
    bigrams.transitions >= 10000);
  // music sanity: a parser that produced garbage would not rank the rock
  // canon on top. IV->I and V->I are the two most-quoted facts about this
  // corpus; a rare chromatic pair is the control
  const c = bigrams.counts;
  ok("IV->I and V->I dominate a rare pair (parser sanity)",
    c[5][0] > 500 && c[7][0] > 500 && c[5][0] > 20 * c[1][8] && c[7][0] > 20 * c[1][8]);
  // and the parser itself still reads the notation this data came from
  ok("roman tokens parse (bVII -> 10, V/IV -> 0, junk -> break)",
    tokenRootPc("bVII") === 10 && tokenRootPc("V/IV") === 0 &&
    tokenRootPc("i64") === 0 && tokenRootPc("???") === "break" &&
    tokenRootPc("[G]") === null);
  // two rounds of i IV V i: 3 changes each, plus the seam i->i which is a
  // repeat and must COLLAPSE — 6 transitions, never 7
  const probe = countBigrams(["A: i | IV | V | i |\nS: $A $A"]);
  ok("countBigrams counts changes and collapses repeats, got " + probe.transitions,
    probe.transitions === 6 && probe.counts[0][5] === 2 && probe.counts[7][0] === 2);
}

// ---- 2. the engine's table IS the derivation --------------------------------
{
  const Frunky = boot(0.03);
  await Frunky.start();
  const pal = Frunky.__palette();
  ok("the walk-weight seam exists", !!pal.walkW);
  const derived = deriveWalkWeights(bigrams);
  ok("WALK_W regenerates exactly from the committed bigrams",
    JSON.stringify(pal.walkW) === JSON.stringify(derived));
  // the tool's root-pc mirror must match the engine's actual root tables —
  // a palette edit that forgets the tool would silently score the OLD loops
  const toPc = (midi) => ((midi % 12) + 12 - 9) % 12; // relative to A
  for (const [name, P] of Object.entries(pal.tables)) {
    const mirrored = PALETTE_ROOT_PCS[name];
    const real = P.roots.map((r) => r.map(toPc));
    ok("the tool mirrors the engine's " + name + " roots",
      JSON.stringify(mirrored) === JSON.stringify(real));
  }
  Frunky.stop();
  transport.clear();
}

// ---- 3. the walk really weighs (probe through the REAL path) ----------------
{
  const Frunky = boot(0.03);
  await Frunky.start();
  const pal = Frunky.__palette();
  ok("the walk probe exists", typeof pal.walkProbe === "function");
  // modal, from progression 0: successors [1, 3] with corpus weights
  // walkW.modal[1] and walkW.modal[3]. Sweep the unit interval: the pick
  // fractions must BE the normalized weights (cumulative pick arithmetic)
  const w = pal.walkW.modal;
  const picks = { 1: 0, 3: 0 };
  const N = 2000;
  for (let k = 0; k < N; k++) {
    const chosen = pal.walkProbe("modal", 0, (k + 0.5) / N);
    ok("probe returns a legal successor from modal[0], got " + chosen,
      chosen === 1 || chosen === 3);
    picks[chosen]++;
  }
  const want1 = w[1] / (w[1] + w[3]);
  ok("the pick fractions are the corpus weights (" +
    (picks[1] / N).toFixed(3) + " vs " + want1.toFixed(3) + ")",
    Math.abs(picks[1] / N - want1) < 0.01);
  ok("and the corpus actually orders them (dorian IV-lift over the rest)",
    w[1] > w[3] && picks[1] > picks[3]);
  Frunky.stop();
  transport.clear();
}

// ---- 4. the real walk drives through the weighted path ----------------------
{
  ok("verse->chorus walks the corpus weights",
    /const pB = walkNext\(P, paletteName, pA, walk\);/.test(script));
  ok("chorus->bridge too",
    /const pC = walkNext\(P, paletteName, pB, walk\);/.test(script));
  // and every walk stays inside the curated graph: weights shade the
  // choice, the pools still own what is allowed at all
  const Frunky = boot(0.05);
  await Frunky.start();
  let t = 0, s = 0;
  let checkedPieces = 0;
  let lastNum = 0;
  while (s < 16 * 16 * 60 && (!Frunky.__set().piece || Frunky.__set().piece.num < 12)) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const st = Frunky.__set();
    if (st.piece && st.piece.num !== lastNum) {
      lastNum = st.piece.num;
      const pal = Frunky.__palette();
      const P = pal.tables[pal.name];
      const [a, b, c2] = pal.pieceProgs;
      ok("piece " + lastNum + " walks legal edges (" + a + "->" + b + "->" + c2 + ")",
        P.next[a].includes(b) && P.next[b].includes(c2));
      checkedPieces++;
    }
    s++;
  }
  ok("the survey judged real pieces (" + checkedPieces + ")", checkedPieces >= 6);
  ok("zero errors across the corpus walk", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("CORPUS_OK");
