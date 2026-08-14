// The combination matrix. Field report: "too much is happening that doesn't
// fit 100% together — nothing sounds wrong, but no groove emerges. Time to
// curate again." The gaps were real: the recipe was rolled free of the mood
// (a glam-stomp fuzz colossus inside a Deep organic piece — the smoke test
// printed exactly that combination), the palette was rolled free of the
// recipe (Andalusian lament under a funk strut), anticipated harmonic
// rhythms syncopated the one groove that lives on a straight pulse, and two
// hook-answerers (blips AND brass) or two eighth-note figures (bass melody
// under broken/gate) could speak at once — which is chatter, not groove
// (Bregman: one protagonist per stream; Witek: groove is an inverted U over
// syncopation, and stacked syncopated layers bury the pulse). The cure is
// the album doctrine one level up: curation over free combinatorics, pools
// as data — the mood curates recipes, the recipe curates its harmonic
// language and rhythm, and each part keeps one answerer and one figure.
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

// ---- 1. the tables: who may play with whom ----------------------------------
{
  const Frunky = boot(0.03);
  ok("the __curation seam exists", typeof Frunky.__curation === "function");
  const c = typeof Frunky.__curation === "function" ? Frunky.__curation() : null;
  const pool = c ? c.pool : null;
  ok("deep never gets the stomp or the strut: club and dub only",
    !!pool && JSON.stringify(pool.deep) === JSON.stringify(["club", "dub"]));
  ok("neutral keeps the open field except the colossus",
    !!pool && JSON.stringify(pool.neutral) === JSON.stringify(["club", "strut", "dub", "soul"]));
  ok("anthem is where the colossus and the soul stomp live, and halftime dub stays out",
    !!pool && JSON.stringify(pool.anthem) === JSON.stringify(["club", "strut", "colossus", "soul"]));
  const r = c ? c.recipes : null;
  ok("every pooled recipe exists",
    !!r && Object.values(pool || {}).flat().every((n) => !!r[n]));
  // the recipe curates its harmonic language the way it already curates its
  // bass patterns: the colossus is the Muse drama (lament/modal), halftime
  // dub is open space (sus/modal), the funk strut never walks the lament
  ok("the colossus speaks lament or modal",
    !!r && JSON.stringify(r.colossus.palettes) === JSON.stringify(["lament", "modal"]));
  ok("the dub speaks sus or modal",
    !!r && JSON.stringify(r.dub.palettes) === JSON.stringify(["sus", "modal"]));
  ok("the strut speaks light or modal",
    !!r && JSON.stringify(r.strut.palettes) === JSON.stringify(["light", "modal"]));
  // Motown leans major: the soul chapter brightens or stays modal, and the
  // lament's drama belongs to the colossus
  ok("the soul speaks light or modal",
    !!r && JSON.stringify(r.soul.palettes) === JSON.stringify(["light", "modal"]));
  ok("club stays the generalist", !!r && r.club.palettes == null);
  // the stomp lives on a straight pulse (Witek's inverted U): anticipated
  // harmonic rhythms would syncopate the one groove that must not be
  ok("the colossus holds its chords to the barline",
    !!r && JSON.stringify(r.colossus.hrs) === JSON.stringify(["bar", "twobar"]));
}

// ---- 2. the rolls obey the matrix -------------------------------------------
{
  const seenMood = new Map(); // mood -> Set of recipes seen
  const seenRecipe = new Map(); // recipe -> Set of palettes seen
  let bundles = 0, figures = 0, answerers = 0, colossusBundles = 0;
  const violations = [];
  // 13/61 is load-bearing, and EXACT on purpose: it is a seed whose first
  // chorus rolls BOTH answerers before the rule fires (found by disabling
  // the rule and sweeping) — without it the walk never reaches the state
  // the one-answerer assertion guards, and its canary cannot bite. The
  // dice seed is String(Math.random()), so even a rounded copy of this
  // number produces entirely different rolls
  for (const seed of [0.03, 0.377, 0.641, 13 / 61]) {
    const Frunky = boot(seed);
    await Frunky.start();
    let t = 0, s = 0, lastNum = 0;
    while (s < 16 * 16 * 26 && lastNum < 4) {
      for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
      transport.cb(t); t += SPB;
      if (s % 16 === 1) {
        const c = Frunky.__curation();
        const p = c.piece;
        if (p && p.num !== lastNum) {
          lastNum = p.num;
          if (!seenMood.has(p.mood)) seenMood.set(p.mood, new Set());
          seenMood.get(p.mood).add(p.recipe);
          if (!seenRecipe.has(p.recipe)) seenRecipe.set(p.recipe, new Set());
          seenRecipe.get(p.recipe).add(p.palette);
          if (!c.pool[p.mood].includes(p.recipe)) {
            violations.push(`piece ${p.num}: ${p.recipe} rolled under ${p.mood}`);
          }
          const rp = c.recipes[p.recipe].palettes;
          if (rp && !rp.includes(p.palette)) {
            violations.push(`piece ${p.num}: ${p.recipe} speaks ${p.palette}`);
          }
          const hrs = c.recipes[p.recipe].hrs;
          for (const [label, b] of Object.entries(p.parts)) {
            bundles++;
            if (p.recipe === "colossus") colossusBundles++;
            if (hrs && !hrs.includes(b.hr)) {
              violations.push(`piece ${p.num} ${label}: hr ${b.hr} under ${p.recipe}`);
            }
            if (b.blips && b.brassy) {
              violations.push(`piece ${p.num} ${label}: two answerers`);
            } else if (b.blips || b.brassy) answerers++;
            if (b.padStyle === "broken" || b.padStyle === "gate") {
              figures++;
              if (b.bassMel) {
                violations.push(`piece ${p.num} ${label}: bass melody under ${b.padStyle}`);
              }
            }
          }
        }
      }
      s++;
    }
    ok("seed " + seed + " reached piece 4 with zero engine errors",
      lastNum >= 4 && Frunky.health().errors === 0);
    Frunky.stop();
    transport.clear();
  }
  ok("the matrix holds: " + (violations.slice(0, 5).join("; ") || "clean"),
    violations.length === 0);
  // non-vacuity: the walk must have really exercised the interesting cells
  ok("every mood rolled pieces, saw " +
    [...seenMood.keys()].sort().join(","), seenMood.size === 3);
  ok("the colossus really played (its rules were tested on " +
    colossusBundles + " bundles)", colossusBundles >= 3);
  ok("figure styles occurred (" + figures + ") and answerers occurred (" +
    answerers + ")", figures >= 3 && answerers >= 3);
  ok("a healthy bundle population, got " + bundles, bundles >= 24);
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("CURATION_OK");
