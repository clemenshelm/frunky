// The genre owns its sound (Build 71).
//
// Three bench verdicts, all thumbs-down, all from the Autobahn cruise:
//   #184 colossus / anthem — "Neon Hook ist zu laut."
//   #184 colossus / anthem — "Hier passt die Kombi der Instrumente nicht zusammen."
//   #191 soul    / anthem — "Die Kombi passt auch nicht so gut zusammen."
//
// The cause is structural and was visible in the roll: the RECIPE is the
// genre (groove, bass, lead, harmonic language) and the WORLD is the
// orchestration — and the world was drawn from the MOOD's pool, free of the
// recipe. So the cross-product shipped combinations no producer would sign:
// a Motown rhythm section (soul: Jamerson walker, tambourine backbeat) in
// the cold synthwave glass of neon, and Muse stadium drama (colossus: fuzz
// bass, stomp) in the same glass. Nothing is out of tune; the record simply
// tells two stories at once, which is exactly "die Kombi passt nicht
// zusammen".
//
// A genre carries its orchestration — that is what a genre IS. So the recipe
// now owns its world list, the same way it already owns its palettes and its
// harmonic rhythms, and the mood's pool only narrows it further.
//
// And a curated frame is not enough on its own: five recipes that reach into
// ONE shared instrument park still sound like one band playing five ways.
// Each genre gets a signature voice only it plays — the horn section for
// Motown, the clavinet for the funk strut, the offbeat skank for the dub,
// the timpani for the colossus. One voice each, never stacked: the point is
// identity, not more layers.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

function makeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
function boot(seed) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  globalThis.window = { Tone: globalThis.Tone, localStorage: makeStore() };
  eval(script);
  return globalThis.window.Frunky;
}

// ---- 1. the table: every recipe names the orchestras it may wear -----------
{
  const F = boot(0.03);
  const c = F.__curation();
  const r = c.recipes;
  ok("every recipe declares its worlds",
    Object.values(r).every((x) => Array.isArray(x.worlds) && x.worlds.length));
  ok("the colossus is a stadium sound: analog alone — the glass world is " +
    "what the field heard as the wrong combination",
    JSON.stringify(r.colossus.worlds) === JSON.stringify(["analog"]));
  ok("Motown is woody and warm, never glass",
    !r.soul.worlds.includes("neon"));
  ok("the dub is spacious and warm, never glass",
    !r.dub.worlds.includes("neon"));
  ok("the funk strut is warm, never glass",
    !r.strut.worlds.includes("neon"));
  ok("the club stays the electronic generalist and keeps the glass",
    r.club.worlds.includes("neon") && r.club.worlds.includes("analog"));
  // a world nobody can wear is dead weight in the table
  const worn = new Set(Object.values(r).flatMap((x) => x.worlds));
  ok("every world is still reachable, got " + [...worn].sort().join(","),
    ["analog", "organic", "neon"].every((w) => worn.has(w)));
}

// ---- 2. the roll: no piece ever wears an orchestra its genre disowns -------
{
  const F = boot(0.037);
  const c0 = F.__curation();
  const allowed = Object.fromEntries(
    Object.entries(c0.recipes).map(([k, v]) => [k, v.worlds]));
  const seen = [];
  const bad = [];
  for (let n = 1; n <= 60; n++) {
    const p = F.__rollNextPiece ? F.__rollNextPiece() : null;
    if (!p) break;
    seen.push(p.recipe + "/" + p.world);
    if (!allowed[p.recipe].includes(p.world)) bad.push(n + ": " + p.recipe + "/" + p.world);
  }
  ok("the roll seam exists (__rollNextPiece)", seen.length === 60);
  ok("60 pieces, not one disowned orchestra — " + bad.slice(0, 4).join(" · "),
    bad.length === 0);
  // curation must not collapse into monotony: the point is fewer BAD
  // combinations, not fewer combinations
  const combos = new Set(seen);
  ok("and the album still varies: " + combos.size + " distinct genre/sound pairs",
    combos.size >= 5);
}

// ---- 3. the neon hook: level, not only colour ------------------------------
// "Neon Hook ist zu laut." The world shaded the hook's filter and its
// presence peak but never its LEVEL — while it trimmed the bass -1 and the
// pad -2 dB. Relative to the band it sits over, the hook therefore came out
// ~2 dB louder in neon than anywhere else, which is precisely the report.
{
  const F = boot(0.03);
  await F.start();
  const w = F.__world().tables;
  ok("every world trims the hook explicitly",
    Object.values(w).every((x) => x.hook && typeof x.hook.trim === "number"));
  eq("analog stays the reference, untrimmed", w.analog.hook.trim, 0);
  ok("neon pulls the hook DOWN with the band it sits over (got " +
    w.neon.hook.trim + ")", w.neon.hook.trim <= -2);
  ok("the trim is bounded — a world shades a mix, it does not remix it",
    Object.values(w).every((x) => Math.abs(x.hook.trim) <= 4));
  // the levels themselves, read back off the nodes — a table is a claim,
  // the graph is the evidence. Both hook voices move, not only the square
  const read = () => {
    const n = F.__world().nodes;
    return { hook: n.hook.volume.value, lead: n.lead.volume.value };
  };
  F.__forceWorld("analog");
  const a = read();
  F.__forceWorld("neon");
  const n = read();
  ok("the square hook really drops in neon (analog " + a.hook.toFixed(2) +
    " → neon " + n.hook.toFixed(2) + ")", n.hook <= a.hook - 2);
  ok("and so does the triangle lead — one chain, both voices (analog " +
    a.lead.toFixed(2) + " → neon " + n.lead.toFixed(2) + ")", n.lead <= a.lead - 2);
  F.__forceWorld("analog");
  ok("and analog comes back to exactly where it was",
    Math.abs(read().hook - a.hook) < 1e-9);
  F.stop();
  transport.clear();
}

// ---- 4. the signature voices: each genre owns one ---------------------------
{
  const F = boot(0.03);
  const c = F.__curation();
  const sig = c.signatures;
  ok("the signature table is on the seam", !!sig);
  const expect = { soul: "horns", strut: "clav", dub: "skank", colossus: "timp" };
  for (const [rec, voice] of Object.entries(expect)) {
    eq("the " + rec + " owns the " + voice, sig[rec], voice);
  }
  ok("the club stays the generalist — it owns no signature",
    sig.club == null || sig.club === "");
  const voices = Object.values(sig).filter(Boolean);
  ok("no two genres share a signature — a shared voice is not a signature",
    new Set(voices).size === voices.length);
}

// ---- 5. the signature really plays, and ONLY in its genre -------------------
// A table is a claim; the counters are the evidence. Each genre is driven
// for real bars and its own voice must speak while the others stay silent.
{
  const RECIPES = ["soul", "strut", "dub", "colossus"];
  const VOICE = { soul: "horns", strut: "clav", dub: "skank", colossus: "timp" };
  for (const rec of RECIPES) {
    const F = boot(0.03);
    await F.start();
    ok(rec + ": the audition API exists", typeof F.setGenre === "function");
    F.setGenre(rec);
    ok(rec + ": and reports itself locked", F.genre().locked === rec);
    const nodes = F.__genre().nodes;
    ok(rec + ": all four signature voices are built", nodes &&
      nodes.horns && nodes.clav && nodes.skank && nodes.timp);
    const before = Object.fromEntries(
      Object.entries(nodes || {}).map(([k, n]) => [k, n.trigs]));
    let t = 1000, s = 0;
    while (s < 16 * 24) {
      for (let f = 0; f < 4; f++) F.update(SPB / 4, { speed: 110, lateralG: 0 });
      transport.cb(t); t += SPB; s++;
    }
    const after = Object.fromEntries(
      Object.entries(nodes || {}).map(([k, n]) => [k, n.trigs]));
    const delta = (k) => (after[k] || 0) - (before[k] || 0);
    const mine = VOICE[rec];
    ok(rec + ": its own signature speaks (" + mine + " " + delta(mine) + " hits)",
      delta(mine) > 4);
    const others = Object.values(VOICE).filter((v) => v !== mine);
    const leaked = others.filter((v) => delta(v) > 0);
    ok(rec + ": no other genre's voice leaks in — " +
      leaked.map((v) => v + ":" + delta(v)).join(","), leaked.length === 0);
    ok(rec + ": zero engine errors across 24 bars", F.health().errors === 0);
    F.stop();
    transport.clear();
  }
}

// ---- 6. the signatures live inside the existing discipline -----------------
// A new voice that ignores the arrangement rules is a new mix problem: the
// breather must silence it like everything else, lean must shed it, and it
// must never become a SECOND answerer next to the blips and the brass.
{
  ok("one gate for all four: lean sheds them, the breather and the " +
    "bridge-down silence them",
    /if \(engine\.lean \|\| ctx\.breather \|\| ctx\.bridgeDown\) return;/.test(script));
  ok("and they are routed, not floating: harmony bus plus the room",
    /hornS\.chain\([\s\S]{0,80}busHarm/.test(script) &&
    /clavS\.chain\([\s\S]{0,80}busHarm/.test(script));
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("GENRE_OK");
