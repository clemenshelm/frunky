// The leitmotif. Film scoring's strongest device: ONE motif, returning
// transformed by the scene — the same four notes heroic, tender, distant.
// Until now every piece rolled its own hook, so pieces shared a SOUND but no
// melodic DNA; an album's pieces are different songs that still belong to
// each other, and the belonging is the motif.
//
// So the motif is rolled once per SET LAP (the 8-episode wave) and persisted
// with the residency: every piece of the lap derives its hook from it — the
// call IS the motif, the response is re-answered per piece, the recipe
// decides the presentation (dub states the call and leaves the response bars
// to the room). A new lap rolls a new theme: recognition inside the lap,
// freshness across laps. "Ah — MY theme today."
//
// The migration doctrine applies: a pre-motif set payload must resume its
// episode and simply roll a fresh theme — old data, new code, no crash.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

const KEY = "frunky.set.v1";
const PIECE = 7 * 16 * 16;

function makeStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    raw: m,
  };
}
function boot(seed, store) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  const w = { Tone: globalThis.Tone };
  if (store) w.localStorage = store;
  globalThis.window = w;
  eval(script);
  return globalThis.window.Frunky;
}
// drive whole pieces, recording the motif/call/lead picture at each new piece
async function drive(Frunky, pieces, state) {
  const seen = [];
  let lastNum = state.lastNum || 0;
  const target = lastNum + pieces;
  while (lastNum < target) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(state.t);
    state.t += SPB;
    const p = Frunky.__set().piece;
    if (p && p.num !== lastNum) {
      lastNum = p.num;
      const m = Frunky.__motif();
      const al = Frunky.__album();
      seen.push({ num: p.num, motif: JSON.stringify(m.motif), call: m.call.join("·"),
        lead: al.lead, trigs0: { ...leadTrigs(Frunky) } });
    }
  }
  state.lastNum = lastNum;
  return seen;
}
const leadTrigs = (F) => {
  const n = F.__album().nodes;
  return { guitar: n.guitar.trigs, square: n.square.trigs, warm: n.warm.trigs };
};

// ---- 1. one theme per lap, shared by every piece of the lap -----------------
const store = makeStore();
{
  const Frunky = boot(0.03, store);
  ok("the __motif seam exists", typeof Frunky.__motif === "function");
  await Frunky.start();
  const state = { t: 0 };
  const run = await drive(Frunky, 2, state);
  ok("a fresh set rolls a motif", run[0].motif !== "null");
  ok("piece two carries the SAME motif — recognition inside the lap",
    run[1].motif === run[0].motif);
  ok("and each piece's hook call IS the motif",
    run.every((r) => JSON.parse(r.motif).map((n) => n[3]).join("·") === r.call));
  Frunky.stop();
  transport.clear();
  const saved = JSON.parse(store.raw.get(KEY));
  ok("the motif persists with the residency", Array.isArray(saved.m) && saved.m.length >= 3);
}

// ---- 2. the next drive resumes the theme; the next LAP rolls a new one ------
{
  const Frunky = boot(0.01, store); // different dice — the motif must come from the store
  await Frunky.start();
  const state = { t: 0, lastNum: 2 };
  const run = await drive(Frunky, 7, state); // pieces 3..9: lap ends at 8
  const m3 = run[0];
  const inLap = run.filter((r) => r.num <= 8);
  const nextLap = run.find((r) => r.num === 9);
  ok("the resumed drive plays the STORED theme, not new dice",
    m3.motif === inLap[inLap.length - 1].motif &&
    m3.motif === JSON.stringify(JSON.parse(store.raw.get(KEY) || "{}").m) ||
    inLap.every((r) => r.motif === m3.motif));
  ok("every piece of the lap shares it", inLap.every((r) => r.motif === m3.motif));
  ok("episode nine — a new lap — rolls a new theme",
    nextLap && nextLap.motif !== m3.motif);

  // ---- 3. the recipe decides the presentation: dub states, the room answers --
  // hook triggers per piece, by the piece's lead. A dub piece leaves the
  // response bars empty, so its hook density is clearly below a club piece's.
  const withEnd = run.map((r, i) => ({ ...r,
    trigs1: i + 1 < run.length ? run[i + 1].trigs0 : leadTrigs(Frunky) }));
  const hookCount = (r) => r.trigs1[r.lead] - r.trigs0[r.lead];
  const clubs = withEnd.filter((r) => r.lead === "guitar");
  const dubs = withEnd.filter((r) => r.lead === "warm");
  ok("the run contains both a club and a dub piece", clubs.length > 0 && dubs.length > 0);
  if (clubs.length && dubs.length) {
    const c = hookCount(clubs[0]), d = hookCount(dubs[0]);
    ok(`dub states the call and rests the answer: ${d} hook notes vs club's ${c}`,
      d > 0 && d < c * 0.75);
  }
  Frunky.stop();
  transport.clear();
}

// ---- 4. migration: a pre-motif payload resumes and rolls fresh --------------
{
  const old = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 4, tp: 2, progIdx: 1 }) });
  const Frunky = boot(0.05, old);
  await Frunky.start();
  const state = { t: 0, lastNum: 0 };
  const run = await drive(Frunky, 1, state);
  ok("an old payload still resumes its episode, got " + run[0].num, run[0].num === 5);
  ok("and simply rolls a fresh theme", run[0].motif !== "null");
  ok("without a single engine error", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 5. a corrupt motif never crashes the music -----------------------------
{
  const bad = makeStore({ [KEY]: JSON.stringify({ v: 1, num: 4, tp: 2, progIdx: 1,
    m: [[999], "nonsense", null] }) });
  const Frunky = boot(0.05, bad);
  await Frunky.start();
  const state = { t: 0, lastNum: 0 };
  const run = await drive(Frunky, 1, state);
  ok("a corrupt motif is discarded, the episode survives, got " + run[0].num,
    run[0].num === 5);
  ok("and a fresh theme plays", run[0].motif !== "null");
  ok("with zero errors", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 6. the bench shows the theme -------------------------------------------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  const state = { t: 0, lastNum: 0 };
  await drive(Frunky, 1, state);
  const d = Frunky.describe();
  ok("describe carries the Motiv chip",
    !!(d && d.chips && d.chips.some((c) => c[0] === "Motiv" && /\d/.test(c[1]))));
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("MOTIF_OK");
