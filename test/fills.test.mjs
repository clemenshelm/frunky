// Fill craft. The field report asked for more musical ornaments and named
// drum fills first — and the fill chapter WAS the thinnest: a pool of three
// flavors whose "toms" was two hits. The science backs the wish: affect
// lives in expectation plus dosed deviation (Meyer, Huron), and fills are
// its textbook case — they mark FORM boundaries, the boundary predictable,
// the content not. So: a curated crate of hand-set one-bar phrases in the
// drummer's three sizes (small shrug / phrase-end answer / full statement
// into a new part), stage-scaled so a sparse opening never gets a show-off,
// and the last chorus gets everything — the final return carries ornaments
// the earlier ones held back.
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

// ---- 1. the crate: three sizes, playable data --------------------------------
{
  const Frunky = boot(0.03);
  ok("the __fills seam exists", typeof Frunky.__fills === "function");
  const c = typeof Frunky.__fills === "function" ? Frunky.__fills().crate : null;
  ok("the crate holds all three sizes",
    !!c && c.small.length >= 3 && c.medium.length >= 3 && c.large.length >= 2);
  const all = c ? [...c.small, ...c.medium, ...c.large] : [];
  ok("every hit sits inside its bar with a known voice and a sane weight",
    all.length > 0 && all.every((f) => f.every(([p, v, , w]) =>
      Number.isInteger(p) && p >= 0 && p <= 15 &&
      ["t", "s", "g", "k"].includes(v) && w > 0 && w <= 1)));
  ok("sizes mean something: smalls stay shrugs (≤ 3 hits), larges are statements (≥ 7)",
    !!c && c.small.every((f) => f.length <= 3) && c.large.every((f) => f.length >= 7));
  ok("fills live at the bar's tail, never its head (no hit before pos 4)",
    all.every((f) => f.every(([p]) => p >= 4)));
}

// ---- 2. the hierarchy plays, and the last chorus gets everything -------------
{
  const Frunky = boot(0.03);
  await Frunky.start();
  let t = 0, s = 0;
  const fillBars = { large: 0, medium: 0, small: 0 };
  let eligibleSmall = 0;
  let adlibProof = false, finalBSeen = 0;
  let plainTomBars = 0, plainTomHits = 0, tomMark = 0;
  while (s < 16 * 16 * 15 && (!Frunky.__set().piece || Frunky.__set().piece.num < 3)) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const pos = s % 16, bar = Math.floor(s / 16);
    if (pos === 1) {
      const fi = Frunky.__fills();
      if (bar % 4 === 3 && bar % 8 !== 7 && bar % 16 !== 15) eligibleSmall++;
      if (fi.current) {
        // classify by what actually plays, not by where the bar sits — a
        // disabled branch must not be masked by a smaller fill on the
        // same bar position
        const size = fi.current.length >= 7 ? "large"
          : fi.current.length >= 5 ? "medium" : "small";
        fillBars[size]++;
      }
    }
    if (pos === 15) {
      const fi = Frunky.__fills();
      const toms = fi.nodes.tom.trigs;
      if (!fi.current && bar % 4 !== 3 && bar > 4) {
        plainTomBars++; plainTomHits += toms - tomMark;
      }
      tomMark = toms;
      const d = Frunky.describe();
      const a = Frunky.__arc();
      if (d && d.partLabel === "B" && d.form && d.idx - 1 === d.form.lastIndexOf("B")) {
        finalBSeen++;
        // the proof the force did real work: a final chorus whose bundle
        // ROLLED brassy or blips off, playing them anyway
        if (a.rolled && (!a.rolled.brassy || !a.rolled.blips) &&
            a.flags.brassy && a.flags.blips) adlibProof = true;
      }
    }
    s++;
  }
  ok("full statements played into new parts, got " + fillBars.large,
    fillBars.large >= 3);
  ok("phrase-end answers played, got " + fillBars.medium, fillBars.medium >= 1);
  ok("small shrugs occurred but stayed occasional, got " + fillBars.small +
    " of " + eligibleSmall + " eligible bars",
    fillBars.small >= 1 && fillBars.small < eligibleSmall);
  ok("plain bars stay clean of toms at a steady cruise, got " + plainTomHits +
    " across " + plainTomBars + " bars", plainTomBars > 10 && plainTomHits === 0);
  ok("the run reached a final chorus (non-vacuity), got " + finalBSeen,
    finalBSeen > 0);
  ok("the last chorus really gets everything: held-back ornaments play in the final return",
    adlibProof);
  ok("zero engine errors across the fill survey", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("FILLS_OK");
