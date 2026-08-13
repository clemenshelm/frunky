// Corpus-derived walk weights (Build 62).
//
// "How does a professional system compose? I would expect Markov chains."
// Our progression walk IS a Markov chain — hand-weighted. This tool replaces
// the hand weights with weights derived from real music: the de Clercq &
// Temperley rock corpus (rs200, rockcorpus.midside.com, CC-BY 4.0), 200
// Rolling-Stone-list songs with expert harmonic analyses in roman numerals.
//
// Stage 1 (needs the raw corpus, run once, result committed):
//   node tools/derive-corpus-weights.mjs parse <corpus-dir>
//   Parses every rs200_harmony/*.har analysis into a 12x12 bigram count
//   matrix over chord-root scale degrees (pitch class relative to the
//   tonic, quality-agnostic — a documented simplification: it keeps the
//   mapping between the corpus's major/minor spellings and our Am-modal
//   loops honest without imputing qualities the loops do not share), and
//   writes tools/corpus-bigrams.json with provenance.
//
// Stage 2 (pure, no corpus needed — the drift guard reruns it in CI):
//   node tools/derive-corpus-weights.mjs weights
//   Reads tools/corpus-bigrams.json and prints the WALK_W table: for every
//   palette progression, the geometric mean of its cyclic chord-change
//   transition probabilities under the corpus (add-alpha smoothed). The
//   geometric mean normalizes loops with different change counts; repeats
//   (a loop closing on its opening chord) are changes of nothing and skip.
//
// The numbers land in engine.js as WALK_W. corpus.test.mjs pins that the
// committed table regenerates exactly from the committed bigrams.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- the palettes' root sequences, in scale-degree pitch class rel. A ------
// Mirrors engine.js ROOTS/SUS_ROOTS/LIGHT_ROOTS/LAMENT_ROOTS (MIDI mod 12,
// relative to A). corpus.test.mjs pins this mirror against the engine.
export const PALETTE_ROOT_PCS = {
  modal: [[0, 8, 10, 0], [0, 5, 0, 10], [0, 7, 8, 10], [0, 5, 10, 0]],
  sus: [[0, 5, 0, 10], [0, 7, 10, 0], [0, 10, 5, 7]],
  light: [[0, 8, 3, 10], [0, 8, 10, 3], [0, 7, 8, 3]],
  lament: [[0, 10, 8, 7], [0, 8, 7, 0], [0, 10, 7, 8]],
};

// ---- stage 1: parse the corpus ---------------------------------------------
const ROMAN_PC = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };

// one token of a .har analysis -> root pitch class relative to the tonic,
// or null when the token is not a chord (rests, key changes, meter marks).
// Applied chords (V/IV) resolve relative to their target. Unknown shapes
// return "break": the bigram chain must not bridge what we cannot read.
export function tokenRootPc(tok) {
  if (!tok || tok === "|" || tok === "R" || tok === ".") return null;
  if (/^\[.*\]$/.test(tok)) return null; // key or meter change marker
  const applied = tok.split("/");
  if (applied.length > 2) return "break";
  let base = 0;
  if (applied.length === 2) {
    const t = parseRoman(applied[1]);
    if (t == null) return "break";
    base = t;
  }
  const pc = parseRoman(applied[0]);
  if (pc == null) return "break";
  return (pc + base) % 12;
}
function parseRoman(str) {
  const m = /^([b#]*)([ivIV]+)/.exec(str);
  if (!m) return null;
  const deg = ROMAN_PC[m[2].toLowerCase()];
  if (deg === undefined) return null;
  let acc = 0;
  for (const c of m[1]) acc += c === "b" ? -1 : 1;
  return ((deg + acc) % 12 + 12) % 12;
}

// expand $variables, drop comments, honor |*N bar repeats (for bigrams a
// repeated bar only matters if we failed to collapse — collapse handles it)
export function songChordPcs(text) {
  const vars = new Map();
  let structure = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/%.*$/, "").trim();
    const m = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === "S") structure = m[2];
    else vars.set(m[1], m[2]);
  }
  if (!structure) return [];
  const expand = (s, depth) => {
    if (depth > 12) return "";
    return s.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (_, name) =>
      vars.has(name) ? expand(vars.get(name), depth + 1) : " ");
  };
  const flat = expand(structure, 0).replace(/\|\*\d+/g, "|").replace(/\|/g, " | ");
  const pcs = [];
  for (const tok of flat.split(/\s+/)) {
    if (!tok) continue;
    const pc = tokenRootPc(tok);
    if (pc === null) continue;
    if (pc === "break") { pcs.push(null); continue; }
    pcs.push(pc);
  }
  return pcs;
}

export function countBigrams(files) {
  const counts = Array.from({ length: 12 }, () => new Array(12).fill(0));
  let transitions = 0;
  for (const text of files) {
    const pcs = songChordPcs(text);
    let prev = null;
    for (const pc of pcs) {
      if (pc === null) { prev = null; continue; }
      if (prev !== null && pc !== prev) { counts[prev][pc]++; transitions++; }
      prev = pc;
    }
  }
  return { counts, transitions };
}

// ---- stage 2: bigrams -> loop weights (pure — the drift guard reruns it) ---
export function deriveWalkWeights(bigrams, alpha = 0.5) {
  const { counts } = bigrams;
  const prob = (a, b) => {
    const row = counts[a];
    const tot = row.reduce((x, y) => x + y, 0) + alpha * 12;
    return (row[b] + alpha) / tot;
  };
  const table = {};
  for (const [pal, progs] of Object.entries(PALETTE_ROOT_PCS)) {
    table[pal] = progs.map((roots) => {
      let logSum = 0, n = 0;
      for (let k = 0; k < roots.length; k++) {
        const from = roots[k], to = roots[(k + 1) % roots.length];
        if (from === to) continue; // a loop closing on its opener changes nothing
        logSum += Math.log(prob(from, to)); n++;
      }
      return +Math.exp(logSum / Math.max(n, 1)).toFixed(4);
    });
  }
  return table;
}

// ---- CLI --------------------------------------------------------------------
const mode = process.argv[2];
if (mode === "parse") {
  const dir = process.argv[3];
  if (!dir) { console.error("usage: parse <corpus-dir-with-.har-files>"); process.exit(1); }
  const names = readdirSync(dir).filter((f) => f.endsWith(".har")).sort();
  const texts = names.map((f) => readFileSync(join(dir, f), "utf8"));
  const { counts, transitions } = countBigrams(texts);
  if (transitions < 10000) {
    // an extractor that finds almost nothing must fail loudly, never emit
    // a quietly wrong table (the docs-coverage lesson)
    console.error("parse found only " + transitions + " transitions — refusing to write");
    process.exit(1);
  }
  const out = {
    source: "de Clercq & Temperley rock corpus (rs200), rock_corpus_v2-1",
    url: "http://rockcorpus.midside.com/",
    license: "CC-BY 4.0",
    derived: "chord-root scale-degree bigrams, quality-agnostic, repeats collapsed",
    files: names.length,
    transitions,
    counts,
  };
  writeFileSync(join(HERE, "corpus-bigrams.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("wrote corpus-bigrams.json:", names.length, "files,", transitions, "transitions");
} else if (mode === "weights") {
  const bigrams = JSON.parse(readFileSync(join(HERE, "corpus-bigrams.json"), "utf8"));
  console.log("const WALK_W = " + JSON.stringify(deriveWalkWeights(bigrams)) + ";");
}
