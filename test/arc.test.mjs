// The story arc. Field direction: "every piece should carry its own emotion,
// story, character — like a professional composer wrote it". The craft gap
// was INSIDE the piece: parts A/B/C returned with identical density, so verse
// one and verse three stood on the same stage — the piece RAN instead of
// TELLING. Composers stage a piece: sparse open, growth, a peak near the end,
// and which materials speak is decided by WHERE the piece stands, not only by
// what the bundle rolled.
//
// So every piece now rolls an ARC: one stage value per form slot (0..1), and
// the stage gates the ornament family when a part is loaded. The materials
// still return (same bundles, same hook); the arc decides which of them are
// on stage THIS time. The mood picks the character: deep never opens hot,
// anthem never crawls — the set wave gets narrative teeth.
//
// These tests pin the arc tables and measure BEHAVIOR: brass and blips must
// actually stay silent in low-stage parts (node trigger counts, not labels),
// and must actually speak somewhere in high-stage parts — a gate with nothing
// to bite on proves nothing.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// the design tables, pinned — three characters, one stage value per form slot
const ARCS = {
  classic: [0.3, 0.5, 0.7, 0.55, 0.85, 0.7, 1],
  slowburn: [0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1],
  banger: [0.7, 1, 0.8, 1, 0.6, 0.9, 1],
};
const ARC_POOL = {
  deep: ["slowburn", "classic"],
  neutral: ["classic", "slowburn", "banger"],
  anthem: ["banger", "classic"],
};
// the gate thresholds, pinned: which stage a material needs to speak
const GATE = { brassy: 0.6, blips: 0.5, ghosts: 0.45, bassFill: 0.35, lick: 0.4,
  snareGhosts: 0.55, hookLift: 0.8 };

let rc = 0;
// 0.03: a seed that puts rolled brass AND blips into low-stage parts — the
// non-vacuity checks below reject a seed whose silence only proves the dice
Math.random = () => (rc = (rc + 0.03) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone };
eval(script);
const Frunky = globalThis.window.Frunky;

ok("the __arc seam exists", typeof Frunky.__arc === "function");

await Frunky.start();
const a0 = Frunky.__arc();
ok("the seam exposes the arc tables", !!(a0 && a0.arcs && a0.pool));
ok("and the counted ornament voices", !!(a0 && a0.nodes && a0.nodes.blip && a0.nodes.brass));

// ---- 1. the tables are what the design says ---------------------------------
ok("the seam's arcs match the pinned table, got " + JSON.stringify(a0.arcs),
  JSON.stringify(a0.arcs) === JSON.stringify(ARCS));
ok("the seam's pool matches the pinned table, got " + JSON.stringify(a0.pool),
  JSON.stringify(a0.pool) === JSON.stringify(ARC_POOL));
ok("deep never opens hot: no banger in its pool",
  !ARC_POOL.deep.includes("banger"));
ok("anthem never crawls: no slowburn in its pool",
  !ARC_POOL.anthem.includes("slowburn"));
for (const [name, st] of Object.entries(ARCS)) {
  ok(`${name}: every stage is 0..1`, st.every((v) => v >= 0 && v <= 1));
  ok(`${name}: the final chorus is the fullest stage`, st[st.length - 1] === 1);
}
ok("slowburn never steps back — patience is the character",
  ARCS.slowburn.every((v, i) => i === 0 || v >= ARCS.slowburn[i - 1]));
ok("the characters are tellable apart at the opening: banger " +
  ARCS.banger[0] + " vs slowburn " + ARCS.slowburn[0],
  ARCS.banger[0] >= 0.5 && ARCS.slowburn[0] <= 0.3);

// ---- 2. drive six complete pieces, measuring each PART ----------------------
const PART = 16 * 16;          // 16 bars x 16 steps
const SLOTS = 7;               // every form is 7 parts long
const PIECE = SLOTS * PART;
const parts = [];              // {num, mood, name, slot, stage, flags, blip, brass}
let t = 0;
const counts = () => {
  const n = Frunky.__arc().nodes;
  return { blip: n.blip.trigs, brass: n.brass.trigs };
};
let open = null;
for (let s = 0; s < PIECE * 6; s++) {
  if (s % PART === 0) {
    const before = counts();
    if (open) parts.push({ ...open, blip: before.blip - open.c0.blip,
      brass: before.brass - open.c0.brass });
    open = null;
  }
  for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
  transport.cb(t);
  t += SPB;
  if (s % PART === 0) {
    const arc = Frunky.__arc();
    const piece = Frunky.__set().piece;
    open = { num: piece.num, mood: piece.mood, name: arc.name,
      slot: Math.floor(s / PART) % SLOTS, stage: arc.stage,
      flags: { ...arc.flags }, rolled: { ...arc.rolled },
      form: Frunky.describe().form.slice(), c0: counts() };
  }
}
if (open) { const c = counts(); parts.push({ ...open, blip: c.blip - open.c0.blip,
  brass: c.brass - open.c0.brass }); }
ok("42 parts were measured, got " + parts.length, parts.length === 42);

// ---- 3. the arc is the piece's character, chosen by the mood ----------------
for (const p of parts.filter((x) => x.slot === 0)) {
  ok(`piece ${p.num} (${p.mood}): arc "${p.name}" comes from the mood's pool`,
    ARC_POOL[p.mood] && ARC_POOL[p.mood].includes(p.name));
}
for (const p of parts) {
  ok(`piece ${p.num} slot ${p.slot}: stage ${p.stage} follows arc "${p.name}"`,
    ARCS[p.name] && p.stage === ARCS[p.name][p.slot]);
  ok(`piece ${p.num}: arc length matches the form length`,
    ARCS[p.name] && ARCS[p.name].length === p.form.length);
}

// ---- 4. the stage really gates the materials (flags) ------------------------
for (const p of parts) {
  for (const [key, min] of Object.entries(GATE)) {
    if (p.stage < min) {
      ok(`piece ${p.num} slot ${p.slot} (stage ${p.stage}): ${key} is off below ${min}`,
        !p.flags[key]);
    }
  }
}

// ---- 5. and the gate is audible, not just a label ---------------------------
// brass and blips have their own voices: count triggers per part. Low-stage
// parts must be SILENT on them; high-stage parts must actually use them
// somewhere in the run, or the gate was never tested against anything.
const lowBrass = parts.filter((p) => p.stage < GATE.brassy);
const lowBlip = parts.filter((p) => p.stage < GATE.blips);
ok("low-stage parts exist to prove the gate on", lowBrass.length > 0 && lowBlip.length > 0);
// the gate must have had something to bite on: at least one low-stage part
// whose BUNDLE rolled the material — otherwise the silence proves the dice,
// not the gate (this is exactly what the first canary run exposed)
ok("a low-stage part really rolled brass, so the gate did real work",
  lowBrass.some((p) => p.rolled.brassy));
ok("a low-stage part really rolled blips, so the gate did real work",
  lowBlip.some((p) => p.rolled.blips));
for (const p of lowBrass) {
  ok(`piece ${p.num} slot ${p.slot} (stage ${p.stage}): no brass fired, got ${p.brass}`,
    p.brass === 0);
}
for (const p of lowBlip) {
  ok(`piece ${p.num} slot ${p.slot} (stage ${p.stage}): no blip fired, got ${p.blip}`,
    p.blip === 0);
}
const hiBrass = parts.filter((p) => p.stage >= GATE.brassy).reduce((a, p) => a + p.brass, 0);
const hiBlip = parts.filter((p) => p.stage >= GATE.blips).reduce((a, p) => a + p.blip, 0);
ok("the run's high-stage parts really play brass somewhere, got " + hiBrass, hiBrass > 0);
ok("the run's high-stage parts really play blips somewhere, got " + hiBlip, hiBlip > 0);

// ---- 6. the bench can show the character ------------------------------------
const d = Frunky.describe();
ok("describe carries the Bogen chip, got " + JSON.stringify(d && d.chips),
  !!(d && d.chips && d.chips.some((c) => c[0] === "Bogen" &&
    Object.keys(ARCS).includes(c[1]))));

Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("ARC_OK");
