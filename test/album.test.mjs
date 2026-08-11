// The album step. Field report: "so far it sounds like variations of the
// same track by one artist". Accurate — pieces differed in key, mood, hook
// and pattern rolls, but they SHARED the four-on-floor kick, the hat grid,
// the swing and the hook's instrument, and those are exactly the dimensions
// listeners use to tell one song on an album from the next.
//
// So every piece now rolls a RECIPE: a curated frame (groove template, lead
// instrument, bass-pattern curation) inside which the generative material is
// rolled exactly as before. Quality lives in the frame — each recipe is a
// proven song shape, not a dice product; variety lives in the filling —
// recipe x key x wave position x hook is a large space. Same doctrine as the
// chord styles: curation over free combinatorics, pools as data.
//
// These tests drive whole pieces and measure BEHAVIOR per recipe through the
// __album() seam and the stub's per-node trigger counters: the kick really
// thins in halftime, the swing really moves, the hook really changes hands.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// the design table, pinned: three recipes, three genuinely different frames
const EXPECT = {
  club: { groove: "four", lead: "guitar", swing: 0.22 },
  strut: { groove: "broken", lead: "square", swing: 0.3 },
  dub: { groove: "half", lead: "warm", swing: 0.16 },
};

let rc = 0;
Math.random = () => (rc = (rc + 0.05) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone };
eval(script);
const Frunky = globalThis.window.Frunky;

ok("the __album seam exists", typeof Frunky.__album === "function");

await Frunky.start();
const al0 = Frunky.__album();
ok("the seam names recipe, groove and lead",
  !!(al0 && al0.recipe && al0.groove && al0.lead));
ok("and exposes the counted voices",
  !!(al0 && al0.nodes && al0.nodes.kick && al0.nodes.snare &&
     al0.nodes.guitar && al0.nodes.square && al0.nodes.warm));

// drive across five piece boundaries at a steady cruise, measuring each
// complete piece: which recipe framed it, and what the voices actually did
const PIECE = 7 * 16 * 16; // 7 parts x 16 bars x 16 steps
const pieces = [];
let t = 0, lastNum = 0, base = null;
const counts = () => {
  const n = Frunky.__album().nodes;
  return { kick: n.kick.trigs, snare: n.snare.trigs,
    guitar: n.guitar.trigs, square: n.square.trigs, warm: n.warm.trigs };
};
let bassViolations = 0;
for (let s = 0; s < PIECE * 6 + 64; s++) {
  for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
  transport.cb(t);
  t += SPB;
  const p = Frunky.__set().piece;
  if (p && p.num !== lastNum) {
    const al = Frunky.__album();
    if (base) pieces.push({ ...base, end: counts() });
    base = { num: p.num, recipe: al.recipe, groove: al.groove, lead: al.lead,
      swing: al.swing, start: counts() };
    lastNum = p.num;
  }
  // every PART re-rolls its bass pattern; all of them must obey the piece's
  // recipe — one rhythmic protagonist (Bregman), same doctrine as the
  // chord-style curation. Sampled every bar.
  if (s % 16 === 0) {
    const al = Frunky.__album();
    if (al.recipe && !al.recipes[al.recipe].bass.includes(al.bassPatIdx)) bassViolations++;
  }
}
ok("six complete pieces were measured, got " + pieces.length, pieces.length === 6);

// ---- 1. the crate is curated and it rotates ---------------------------------
const names = pieces.map((p) => p.recipe);
ok("every piece plays a known recipe, got " + names.join(","),
  names.every((n) => EXPECT[n]));
ok("no recipe plays twice in a row",
  names.every((n, i) => i === 0 || n !== names[i - 1]));
ok("the run visits all three recipes, got " + [...new Set(names)].join(","),
  new Set(names).size === 3);

// ---- 2. the frame is real: groove, swing, lead match the recipe -------------
for (const p of pieces) {
  const e = EXPECT[p.recipe];
  ok(`piece ${p.num} (${p.recipe}): groove is ${e.groove}, got ${p.groove}`,
    p.groove === e.groove);
  ok(`piece ${p.num} (${p.recipe}): lead is ${e.lead}, got ${p.lead}`,
    p.lead === e.lead);
  ok(`piece ${p.num} (${p.recipe}): swing is ${e.swing}, got ${p.swing}`,
    Math.abs(p.swing - e.swing) < 1e-9);
}

// ---- 3. the groove is audible in the KICK COUNT, not just in a label --------
const kicksOf = (p) => p.end.kick - p.start.kick;
const byGroove = (g) => pieces.filter((p) => EXPECT[p.recipe].groove === g);
const fours = byGroove("four"), halves = byGroove("half");
ok("a four-on-floor piece and a halftime piece both played",
  fours.length >= 1 && halves.length >= 1);
if (fours.length && halves.length) {
  const f = kicksOf(fours[0]), h = kicksOf(halves[0]);
  ok(`halftime really thins the kick: ${h} kicks vs four-on-floor's ${f}`,
    h < f * 0.75);
}
// halftime's identity is the heavy snare on THREE — the backbone. It must
// speak in essentially EVERY bar (only breathers and the bridge breakdown
// sit out), even in parts whose mood rolled the snare trait off. A dub
// piece is ~112 bars, ~96 of them playing: anything clearly below that
// means the backbone went trait-gated again.
for (const p of halves) {
  const hs = p.end.snare - p.start.snare;
  ok(`dub piece ${p.num}: the backbone snare speaks every playing bar, got ${hs}`,
    hs >= 90);
}

// ---- 4. the hook really changes hands ---------------------------------------
// per piece, (nearly) all hook triggers must come from the recipe's lead:
// the guitar in club, the square in strut, the warm triangle in dub
for (const p of pieces) {
  const d = { guitar: p.end.guitar - p.start.guitar,
    square: p.end.square - p.start.square, warm: p.end.warm - p.start.warm };
  const lead = EXPECT[p.recipe].lead;
  ok(`piece ${p.num} (${p.recipe}): the ${lead} lead actually plays, got ` +
    JSON.stringify(d), d[lead] > 0);
  for (const other of ["guitar", "square", "warm"].filter((x) => x !== lead)) {
    ok(`piece ${p.num} (${p.recipe}): the ${other} stays silent, got ${d[other]}`,
      d[other] === 0);
  }
}

// ---- 5. the bass is curated per groove --------------------------------------
ok("every part's bass pattern obeyed its recipe's pool, got " +
  bassViolations + " violations", bassViolations === 0);

Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("ALBUM_OK");
