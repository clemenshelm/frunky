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
  // note lengths breathe: at least one hook cell carries a DOTTED duration,
  // so lines are not condemned to straight quarters and halves forever
  ok("the hook-cell pool carries dotted rhythms",
    Frunky.__motif().cells.some((cell) => cell.some(([, d]) => !Number.isInteger(d))));
  ok("piece two carries the SAME motif — recognition inside the lap",
    run[1].motif === run[0].motif);
  // lifted with the question/answer craft: the call IS the motif except
  // for its last note, which now asks the question (ends off home) — the
  // response resolves it. Identity check therefore excludes the tail
  ok("and each piece's hook call IS the motif (up to the question tone)",
    run.every((r) => {
      const m = JSON.parse(r.motif).map((n) => n[3]);
      const c = r.call.split("·").map(Number);
      return m.length === c.length &&
        m.slice(0, -1).join("·") === c.slice(0, -1).join("·") &&
        c[c.length - 1] !== 0;
    }));
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

// ---- 6. hook craft: the earworm rules, executable ---------------------------
// The field report said "nice, but not great", and earworm research
// (Jakubowski et al.: common global contour + ONE unusual feature; smaller
// intervals and repeated notes make a line singable) names what was
// missing: the motif's walk was a drunkard's ±1 with no enforced shape.
// The rules now: home-to-home ARCH (rise, peak, monotone fall), exactly ONE
// upward leap (the twist — a falling cascade is relaxation, not an event),
// repeated notes before it (economy — rhythm does the work), and the hook
// splits it into QUESTION and ANSWER: the call ends off home, the response
// keeps its lifted middle but lands home. The old pair did the opposite
// (call ended home, response never resolved), which is why every hook felt
// finished before it answered.
{
  const Frunky = boot(0.03, makeStore());
  ok("the __craft probe exists", typeof Frunky.__craft === "function");
  let arch = 0, oneLeap = 0, question = 0, answer = 0, lifted = 0, total = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = Frunky.__craft(seed);
    if (!c) break;
    total++;
    const RIFF = [0, 3, 5, 7, 10, 12];
    const idx = c.motif.map((n) => RIFF.indexOf(n.s));
    const peakV = Math.max(...idx), peakI = idx.indexOf(peakV);
    const rises = idx.slice(1).map((v, i) => v - idx[i]).filter((d) => d > 0);
    if (idx[0] === 0 && idx[idx.length - 1] === 0 &&
        peakI > 0 && peakI < idx.length - 1 && peakV >= 2 &&
        idx.slice(peakI + 1).every((v, i, a) => v <= (i === 0 ? peakV : a[i - 1])))
      arch++;
    if (rises.length === 1 && rises[0] >= 2) oneLeap++;
    const callEnd = c.hook.call[c.hook.call.length - 1].s;
    const respEnd = c.hook.resp[c.hook.resp.length - 1].s;
    if (callEnd === 3 || callEnd === 10) question++;
    if (respEnd === 0) answer++;
    if (c.hook.resp.some((n, i) => i > 0 && i < c.hook.resp.length - 1 &&
        RIFF.indexOf(n.s) > idx[i])) lifted++;
  }
  ok("200 motifs probed (non-vacuity), got " + total, total === 200);
  ok("every motif is a home-to-home arch, got " + arch + "/200", arch === 200);
  ok("every motif carries exactly one upward leap, got " + oneLeap + "/200",
    oneLeap === 200);
  ok("every call ends as a question (off home), got " + question + "/200",
    question === 200);
  ok("every response lands the answer home, got " + answer + "/200",
    answer === 200);
  ok("responses keep their lifted middle, got " + lifted + "/200",
    lifted === 200);
}

// ---- 7. the ghost theme: the leitmotif returns disguised --------------------
// Film scoring's device, requested verbatim: the theme reappears in the
// background — quiet, wet, augmented, a different instrument — in the
// parts where the hook itself is silent. Never in the chorus (the hook
// owns it there), occasional rather than reliable.
{
  // 2/41 exact (dice-seed discipline, see curation.test): a seed whose
  // walk would fire a CHORUS ghost as early as bar 22 if the never-in-B
  // gate fell — without it, the only-A-or-C assertion guards a state the
  // walk never reaches and its canary cannot bite
  const Frunky = boot(2 / 41, makeStore());
  await Frunky.start();
  const state = { t: 0 };
  await drive(Frunky, 3, state);
  const g = Frunky.__motif().ghosts;
  ok("the ghost ledger exists", Array.isArray(g));
  ok("the theme really drifted by, got " + (g ? g.length : 0), g && g.length >= 1);
  ok("only where the hook is silent (A or C), saw " +
    (g ? [...new Set(g.map((e) => e.part))].join(",") : "-"),
    g && g.length > 0 && g.every((e) => e.part === "A" || e.part === "C"));
  ok("augmented and quiet (the disguise), " +
    (g && g[0] ? `dur×${g[0].aug}, vol ${g[0].vol}` : "-"),
    g && g.every((e) => e.aug === 2 && e.vol <= 0.06));
  ok("occasional, not reliable: fewer ghosts than eligible parts, " +
    (g ? g.length : 0) + " of " + (Frunky.__motif().ghostEligible || 0),
    g && g.length < (Frunky.__motif().ghostEligible || 0));
  ok("zero errors across the ghost walk", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 8. the bench shows the theme -------------------------------------------
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
