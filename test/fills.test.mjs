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
  ok("the crate holds all three sizes, classics included",
    !!c && c.small.length >= 4 && c.medium.length >= 4 && c.large.length >= 4);
  // the classics ("proven greats"): the paired-tom cascade needs its
  // double strikes (two hits per drum descending — the In-the-Air shape),
  // and one large fill must be LINEAR: kick, snare and toms alternating,
  // no two voices at once — the fusion drummer's signature
  ok("a paired-tom cascade lives in the large crate",
    !!c && c.large.some((f) => f.length >= 8 && f.every(([, v]) => v === "t") &&
      f.every(([, , p], i, a) => i === 0 || p <= a[i - 1][2])));
  ok("a linear fill lives in the large crate (no voice repeats back-to-back)",
    !!c && c.large.some((f) => f.length >= 7 &&
      new Set(f.map(([, v]) => v)).size >= 3 &&
      f.every(([, v], i, a) => i === 0 || v !== a[i - 1][1])));
  ok("a dragged snare lives in the medium crate (ghost run into the backbeat)",
    !!c && c.medium.some((f) => f.filter(([, v]) => v === "g").length >= 3 &&
      f[f.length - 1][1] === "s"));
  // the bass licks join the ledger: still pentatonic pickups at the bar's
  // tail — and at least one carries the blues curl (the b5 passing tone)
  const licks = typeof Frunky.__fills === "function" ? Frunky.__fills().licks : null;
  ok("the lick pool grew to the classics, got " + (licks ? licks.length : 0),
    !!licks && licks.length >= 6);
  ok("every lick stays a tail pickup in the pentatonic-plus-curl set",
    !!licks && licks.every((l) => l.every(([p, s]) =>
      p >= 8 && p <= 15 && [0, 3, 5, 6, 7, 10, 12].includes(s))));
  ok("one lick carries the blues curl (the b5 passing tone)",
    !!licks && licks.some((l) => l.some(([, s]) => s === 6)));
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

// ---- build fills (Build 68): the lead-in ladder ------------------------------
// Field report: "for the build it would be nice to have somewhat more complex
// drum fills LEADING INTO the climax, not only this snare roll". The old rule
// said "never during a build (the roll owns those bars)" — which is exactly
// the monotony the report names. The roll keeps the floor; on top, each climb
// bar's tail hands the drummer a figure that escalates with the climb: toms
// enter (tier 1), a linear run (tier 2), the full cascade riding the roll
// into the drop (tier 3). Escalation is the fill ladder's whole identity, so
// the tiers are pinned as a LADDER, not as three unrelated pools.
{
  const script2 = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
  const Frunky = boot(0.11);
  const c = typeof Frunky.__fills === "function" ? Frunky.__fills().crate : null;
  const b = c && c.build;
  ok("the crate carries the build ladder (tiers 1..3)",
    !!b && Array.isArray(b[1]) && Array.isArray(b[2]) && Array.isArray(b[3]));
  ok("every tier offers variety (>= 2 figures each)",
    !!b && b[1].length >= 2 && b[2].length >= 2 && b[3].length >= 2);
  const hits = (f) => f.length;
  const maxPos = (f) => Math.max(...f.map(([p]) => p));
  const minHits = (tier) => Math.min(...tier.map(hits));
  if (b) {
    ok("the ladder escalates: every tier-3 figure is denser than every tier-1",
      minHits(b[3]) > Math.max(...b[1].map(hits)) && minHits(b[2]) >= 4 &&
      minHits(b[3]) >= 8);
    ok("every build figure drives INTO the one (last hit at pos 15, near-full)",
      [1, 2, 3].every((k) => b[k].every((f) => {
        const last = f[f.length - 1];
        return last[0] === 15 && last[3] >= 0.85;
      })));
    ok("figures stay at the bar tail (nothing before pos 4)",
      [1, 2, 3].every((k) => b[k].every((f) => f.every(([p]) => p >= 4 && p <= 15))));
    ok("the data is playable (voices t/s/g/k, velocities 0..1)",
      [1, 2, 3].every((k) => b[k].every((f) => f.every(([p, v, , vl]) =>
        Number.isInteger(p) && ["t", "s", "g", "k"].includes(v) &&
        vl > 0 && vl <= 1))));
    ok("tier 3 keeps a full cascade (an all-toms descending figure)",
      b[3].some((f) => f.every(([, v]) => v === "t") &&
        f.every(([, , p], i, a) => i === 0 || p <= a[i - 1][2])));
  }
  // the wiring: build bars now SELECT a fill instead of being excluded, the
  // tier rides buildSeg, and the fill's weight escalates with the climb
  ok("build bars pick from the ladder by climb segment",
    /DRUMFILLS\.build\[buildSeg\]/.test(script2));
  ok("the build fill's weight rides the climb, not the arc stage",
    /buildOn \? 0\.7 \+ 0\.1 \* buildSeg : 0\.5 \+ 0\.5 \* engine\.stage/.test(script2));
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("FILLS_OK");
