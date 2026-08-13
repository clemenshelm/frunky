// The sample crate — real instruments. Field report 2026-08-13: "very many
// continuous organs and flutes... we need much more variation in style. Are
// there really good open-source instruments someone has designed?"
//
// There are: the tonejs-instruments collection (CC-BY 3.0, largely VSCO2
// Community Edition recordings) ships per-note mp3s that drop straight into
// the Tone.Sampler pipeline the Rhodes already uses. Build 61 adds three:
//   – piano: an alternative KEYS carrier, rolled per piece and per world —
//     the same figures stop sounding like the same organ;
//   – violin + cello: the lift's string bed and the aria's doubling become
//     real strings (synthesis costs CPU per voice, sample playback is
//     nearly free — the trade is decoded-PCM RAM, so the note sets stay
//     small and the strings are not even FETCHED on lite devices, where
//     the bed never plays).
// Everything falls back to the synth voices when samples are not loaded —
// offline is normal operation, never an error.
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const readme = readFileSync(new URL("../samples/README.md", import.meta.url), "utf8");
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

// ---- 1. the crate is real: every declared sample file exists on disk --------
// A Sampler whose url map names a missing file fails silently in the field
// (loaded stays false, the fallback plays forever) — the test that catches
// the typo has to read the DISK against the CODE.
{
  const Frunky = boot(0.03);
  await Frunky.start();
  const w = Frunky.__world();
  ok("the sampler seam exists", !!w.samplers);
  for (const name of ["piano", "strHi", "strLo"]) {
    const s = w.samplers[name];
    ok("the " + name + " sampler is built", !!s);
    if (!s) continue;
    const base = s.settings.baseUrl;
    ok(name + " has a baseUrl under samples/", typeof base === "string" && base.startsWith("samples/"));
    const urls = s.settings.urls || {};
    const files = Object.values(urls);
    ok(name + " declares a real note set (>= 4)", files.length >= 4);
    for (const f of files) {
      ok(name + ": " + base + f + " exists on disk",
        existsSync(new URL("../" + base + f, import.meta.url)));
    }
  }
  Frunky.stop();
  transport.clear();
}

// ---- 2. the decoded-PCM budget stays honest ---------------------------------
// mp3 size lies: the browser decodes to raw PCM (~350 KB per second of
// sound). Small curated note sets are the whole design — a growing crate
// must trip this wire and be argued, not slip in.
{
  let bytes = 0, count = 0;
  for (const dir of ["piano", "violin", "cello"]) {
    const p = new URL("../samples/" + dir + "/", import.meta.url);
    if (!existsSync(p)) { ok("samples/" + dir + " exists", false); continue; }
    for (const f of readdirSync(p)) {
      if (!f.endsWith(".mp3")) continue;
      bytes += statSync(new URL("../samples/" + dir + "/" + f, import.meta.url)).size;
      count++;
    }
  }
  ok("the three crates hold a curated set (10..30 notes), got " + count,
    count >= 10 && count <= 30);
  ok("and stay under 6 MB of mp3 on the wire, got " + (bytes / 1e6).toFixed(1) + " MB",
    bytes > 0 && bytes < 6e6);
  // attribution: CC-BY requires naming the source, and the README is the
  // one place a license claim lives
  ok("samples/README.md credits tonejs-instruments (CC-BY)",
    /tonejs-instruments/.test(readme) && /CC[- ]BY/i.test(readme));
  ok("and names VSCO", /VSCO/i.test(readme));
}

// ---- 3. the keys carrier rotates per piece ----------------------------------
// Drive many pieces: organic and analog pieces must roll BOTH carriers
// across a session; neon keeps the Rhodes (a grand piano in the glass world
// would break the orchestra's identity). Seed 0.07 by hunt: a session whose
// keyed dice visit both carriers in both worlds (the exact-seed lesson).
{
  const Frunky = boot(0.07);
  await Frunky.start();
  let t = 0, s = 0;
  const seen = new Map(); // world -> Set(keysInst)
  while (s < 16 * 16 * 60 && (!Frunky.__set().piece || Frunky.__set().piece.num < 14)) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const w = Frunky.__world();
    if (w.name) {
      if (!seen.has(w.name)) seen.set(w.name, new Set());
      seen.get(w.name).add(w.keysInst);
    }
    s++;
  }
  const show = [...seen].map(([k, v]) => k + ":" + [...v].join("/")).join(" ");
  ok("keysInst is rolled for every piece, saw " + show,
    [...seen.values()].every((v) => [...v].every((x) => x === "piano" || x === "rhodes")));
  const organicky = new Set([...(seen.get("organic") || []), ...(seen.get("analog") || [])]);
  ok("organic/analog pieces roll both carriers across a session, saw " + show,
    organicky.has("piano") && organicky.has("rhodes"));
  ok("neon keeps the Rhodes, saw " + show,
    !seen.has("neon") || (seen.get("neon").size === 1 && seen.get("neon").has("rhodes")));
  ok("zero errors across the carrier survey", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 4. the piano really carries the keys when rolled -----------------------
// Behavioral: in a piece rolled to piano, keys-style chords trigger the
// piano sampler, not the Rhodes. Both live on the same seam.
{
  const Frunky = boot(0.07);
  await Frunky.start();
  let t = 0, s = 0;
  let pianoTrigs = 0, rhodesWhilePiano = 0, checkedBars = 0;
  let barP = 0, barR = 0;
  while (s < 16 * 16 * 60 && checkedBars < 24 &&
      (!Frunky.__set().piece || Frunky.__set().piece.num < 14)) {
    // per-bar deltas, opened at the bar's own start — a delta spanning the
    // bars BETWEEN checked bars would count other pieces' Rhodes against
    // this piece's piano
    if (s % 16 === 0) {
      const w0 = Frunky.__world();
      barP = w0.samplers.piano.trigs; barR = w0.samplers.rhodes.trigs;
    }
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(t); t += SPB;
    const w = Frunky.__world();
    if (s % 16 === 15 && w.keysInst === "piano" && w.padStyleNow === "keys" &&
        !Frunky.__set().flowOn) {
      pianoTrigs += w.samplers.piano.trigs - barP;
      rhodesWhilePiano += w.samplers.rhodes.trigs - barR;
      checkedBars++;
    }
    s++;
  }
  ok("saw enough piano-keys bars to judge (" + checkedBars + ")", checkedBars >= 6);
  ok("the piano carries the keys style when rolled, trigs " + pianoTrigs,
    pianoTrigs > 0);
  ok("and the Rhodes stays silent in those bars, got " + rhodesWhilePiano,
    rhodesWhilePiano === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 5. the lift's bed becomes real strings ---------------------------------
// Drive onto the highway until a lift happens: with samples loaded (the
// stub always is), the violins and celli carry the bed. The synth padTri
// stays the FALLBACK — flip loaded off and the bed must keep sounding.
{
  const Frunky = boot(0.03);
  await Frunky.start();
  let t = 0, s = 0, liftBars = 0;
  while (s < 16 * 16 * 40 && liftBars < 12) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 140, lateralG: 0 });
    transport.cb(t); t += SPB;
    if (s % 16 === 0 && Frunky.__drive().lift.active) liftBars++;
    s++;
  }
  const w = Frunky.__world();
  ok("the drive reached lifts (bars " + liftBars + ")", liftBars >= 8);
  ok("the violins carry the bed, trigs " + w.samplers.strHi.trigs,
    w.samplers.strHi.trigs > 0);
  ok("the celli sit underneath, trigs " + w.samplers.strLo.trigs,
    w.samplers.strLo.trigs > 0);
  ok("zero errors with the string bed", Frunky.health().errors === 0);
  // now the fallback: unloaded strings must never silence the bed
  w.samplers.strHi.loaded = false;
  w.samplers.strLo.loaded = false;
  const triBefore = Frunky.__drive().nodes.padTri.trigs;
  const strBefore = w.samplers.strHi.trigs;
  let moreLift = 0;
  while (s < 16 * 16 * 90 && moreLift < 10) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 140, lateralG: 0 });
    transport.cb(t); t += SPB;
    if (s % 16 === 0 && Frunky.__drive().lift.active) moreLift++;
    s++;
  }
  ok("the fallback lift happened (bars " + moreLift + ")", moreLift >= 8);
  ok("unloaded strings stay silent", w.samplers.strHi.trigs === strBefore);
  ok("and the synth bed takes over, padTri trigs +" +
    (Frunky.__drive().nodes.padTri.trigs - triBefore),
    Frunky.__drive().nodes.padTri.trigs > triBefore);
  ok("zero errors across the fallback", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 6. source pins: the load gate and the aria's celli ---------------------
{
  // lite devices never play the bed, so they must not pay for the fetch
  ok("the strings are not fetched on lite devices",
    /if \(!opts\.lite\) \{\s*\n\s*strHi = new Tone\.Sampler/.test(script));
  // the aria's octave doubling: celli when loaded, the triangle pad as
  // fallback — Puccini's texture, offline-tolerant
  ok("the aria doubles on the celli with a synth fallback",
    /\(strLo && strLo\.loaded \? strLo : padTri\)\.triggerAttackRelease\(F\(57 \+ an\.s\)/.test(script));
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SAMPLES_OK");
