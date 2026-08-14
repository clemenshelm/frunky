// The soul recipe (build 69) — the Motown chapter of the album crate.
//
// The producer's brief, in crate terms: the rhythm section is the star. A
// four-on-floor kick under a backbeat snare that ALWAYS speaks (2 and 4 are
// the contract, not a trait), a tambourine riding the eighths and hitting
// hardest WITH the backbeat — the one layer that survives road noise in a
// car, which is why Motown mixed against a car speaker in the first place —
// and a Jamerson bass: the melodic pattern is forced on, every part, because
// a soul bass that pedals its root is not a soul bass. Lead stays the
// guitar; the frame around it is what nobody can mistake.
//
// Behavior tests through the __album seam and the stub's trigger counters,
// same doctrine as album.test.mjs: the tambourine really plays in soul and
// really stays silent outside it, the bass really walks.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

let rc = 0;
Math.random = () => (rc = (rc + 0.05) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone };
eval(script);
const Frunky = globalThis.window.Frunky;

await Frunky.start();
const al0 = Frunky.__album();
ok("the crate declares soul: motown groove, guitar lead, its own swing",
  !!al0.recipes.soul && al0.recipes.soul.groove === "motown" &&
  al0.recipes.soul.lead === "guitar");
ok("the seam counts the tambourine", !!(al0.nodes && al0.nodes.tamb));
ok("the seam says whether the bass walks", "bassMel" in al0);

// drive across piece boundaries until soul has framed at least one piece.
// Deterministic under the seeded dice — if soul stops rolling inside twelve
// pieces, the pool wiring is broken and this failing is the point.
const PIECE = 7 * 16 * 16;
const pieces = [];
let t = 0, lastNum = 0, cur = null;
const tambTrigs = () => Frunky.__album().nodes.tamb.trigs;
for (let s = 0; s < PIECE * 12 + 64 && !(pieces.some((p) => p.recipe === "soul") && pieces.length >= 3); s++) {
  for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
  transport.cb(t);
  t += SPB;
  const p = Frunky.__set().piece;
  if (p && p.num !== lastNum) {
    const al = Frunky.__album();
    if (cur) { cur.tambEnd = tambTrigs(); pieces.push(cur); }
    cur = { num: p.num, recipe: al.recipe, groove: al.groove, lead: al.lead,
      swing: al.swing, tambStart: tambTrigs(), bassPats: new Set(), mels: [] };
    lastNum = p.num;
  }
  if (cur && s % 16 === 0) {
    const al = Frunky.__album();
    cur.bassPats.add(al.bassPatIdx);
    cur.mels.push(!!al.bassMel);
  }
}
if (cur) { cur.tambEnd = tambTrigs(); pieces.push(cur); }

const soul = pieces.filter((p) => p.recipe === "soul");
const others = pieces.filter((p) => p.recipe !== "soul");
ok("soul framed at least one piece within the run, got " +
  pieces.map((p) => p.recipe).join(","), soul.length >= 1);
ok("and other recipes still played around it", others.length >= 1);

for (const p of soul) {
  ok(`soul piece ${p.num}: the groove frame is motown, got ${p.groove}`,
    p.groove === "motown");
  ok(`soul piece ${p.num}: the swing is its own (0.14), got ${p.swing}`,
    Math.abs(p.swing - 0.14) < 1e-9);
  // the Jamerson contract: the melodic bass is FORCED on, every part —
  // and the pattern pool holds exactly the syncopated walker
  ok(`soul piece ${p.num}: the bass walks in every sampled part`,
    p.mels.length > 0 && p.mels.every(Boolean));
  ok(`soul piece ${p.num}: the bass pattern is the Jamerson walker (idx 4), got ` +
    [...p.bassPats].join(","), [...p.bassPats].every((i) => i === 4));
  ok(`soul piece ${p.num}: the tambourine really plays, got ` +
    (p.tambEnd - p.tambStart), p.tambEnd - p.tambStart > 30);
}
for (const p of others) {
  ok(`piece ${p.num} (${p.recipe}): the tambourine stays in the drawer, got ` +
    (p.tambEnd - p.tambStart), p.tambEnd - p.tambStart === 0);
}

// ---- the frame's data, pinned at the source ---------------------------------
// The groove template and the walker are design-table entries; a behavioral
// test cannot see an accent velocity through the stub, so the accent rule is
// pinned where it lives.
ok("the motown groove has a backbeat that always speaks and a tambourine grid",
  /motown:\s*\{[^}]*coreSnare:\s*true[^}]*tamb:\s*\[2, 4, 6, 10, 12, 14\]/s.test(script) ||
  /motown:\s*\{[^}]*tamb:\s*\[2, 4, 6, 10, 12, 14\][^}]*coreSnare:\s*true/s.test(script));
ok("the Jamerson walker is in the pattern pool",
  script.includes("[0, 3, 6, 8, 11, 14]"));
ok("the tambourine accents WITH the backbeat",
  /snareAt\.includes\(pos\)[\s\S]{0,120}tamb\(/.test(script) ||
  /tamb\([\s\S]{0,160}snareAt\.includes\(pos\)/.test(script));
ok("soul forces the melodic bass on, as a recipe field",
  /name: "soul"[^}]*melBass: true/.test(script));

Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SOUL_OK");
