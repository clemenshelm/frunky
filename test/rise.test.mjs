// The rise figure ("Steigfigur"): the EV's engine feedback. While the car
// accelerates, canon voices enter on the 8th grid and climb the A-minor
// pentatonic — overlapping like a traction inverter stepping through its
// pulse patterns, but quantized to the key and the meter so no overlap can
// ever be dissonant. The window is Shepard-shaped: voices fade out toward the
// top while new entries start low, so the ascent never runs out of register.
// When the push ebbs, no new voices enter and the last ones LAND on a chord
// tone — a cadence, not a cutoff.
//
// These tests drive the engine by hand (like sequencer.test.mjs) and read the
// __rise() seam: { active, log: [{s, slot, midi, kind, rootPc?}] }, where midi
// is in untransposed A-space and kind is "entry" | "climb" | "cadence".
import { readFileSync } from "node:fs";
import { transport, fakeCtx } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

let rc = 0;
Math.random = () => (rc = (rc + 0.377) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone };
eval(script);
const Frunky = globalThis.window.Frunky;

// A C D E G — the pentatonic the engine itself calls safe over every pool
const PENTA = new Set([9, 0, 2, 4, 7]);
const WINDOW = [60, 92]; // the register the figure must never leave

ok("the __rise seam exists", typeof Frunky.__rise === "function");
ok("health reports the rise voice count", typeof Frunky.health().rise === "number");

// drive helper: integrates speed at a given acceleration (km/h per second),
// four engine frames per 16th, exactly as the page's loop produces them
let t = 0, speed = 0, maxActive = 0, capBust = 0;
function drive(steps, accel, capLimit = 3) {
  for (let i = 0; i < steps; i++) {
    for (let f = 0; f < 4; f++) {
      speed = Math.max(0, speed + accel * (SPB / 4));
      Frunky.update(SPB / 4, { speed, lateralG: 0 });
    }
    transport.cb(t);
    t += SPB;
    const r = Frunky.__rise ? Frunky.__rise() : null;
    if (r) {
      if (r.active > maxActive) maxActive = r.active;
      if (r.active > capLimit) capBust++;
    }
  }
}
const log = () => (Frunky.__rise ? Frunky.__rise().log : []);

// ---- 1. cruising never engages the figure ----------------------------------
// A gentle drift up to 60 km/h reads about 0.1 thrust — below the engagement
// threshold. The figure is acceleration FEEDBACK; at cruise it must not exist.
await Frunky.start();
{
  speed = 0;
  drive(280, 2);   // ~17 bars easing up to ~60 km/h
  drive(128, 0);   // 8 bars holding it
  ok("no rise events at cruise, got " + log().length, log().length === 0);
}
Frunky.stop();
transport.clear();

// ---- 2. acceleration: entries on the grid, pentatonic, ascending, capped ---
await Frunky.start();
{
  speed = 0; maxActive = 0; capBust = 0;
  drive(128, 10);  // 8 bars of a solid pull
  drive(64, 18);   // 4 bars of a sprint — the pool must saturate, not grow
  const l = log();
  const entries = l.filter((e) => e.kind === "entry");
  ok("a pull produces entries, got " + entries.length, entries.length >= 5);
  ok("every event sits on the 8th grid", l.every((e) => e.s % 2 === 0));
  ok("every pitch is pentatonic (entries and climbs)",
    l.filter((e) => e.kind !== "cadence").every((e) => PENTA.has(((e.midi % 12) + 12) % 12)));
  ok("every pitch stays inside the register window",
    l.every((e) => e.midi >= WINDOW[0] && e.midi <= WINDOW[1]));
  ok("voices overlap — the canon is real, max " + maxActive, maxActive >= 2);
  ok("the pool is capped at 3 voices", capBust === 0);
  ok("only known event kinds appear",
    l.every((e) => e.kind === "entry" || e.kind === "climb" ||
      e.kind === "cadence" || e.kind === "arrival"));

  // within one voice the figure climbs: strictly ascending from its entry
  const runs = [];
  const open = new Map();
  for (const e of l) {
    if (e.kind === "entry") {
      // flush a fade-ended run before its slot is reused (see section 8)
      if (open.has(e.slot)) runs.push(open.get(e.slot));
      open.set(e.slot, [e.midi]);
      continue;
    }
    const run = open.get(e.slot);
    if (!run) continue;
    if (e.kind === "climb") run.push(e.midi);
    else { runs.push(run); open.delete(e.slot); }
  }
  for (const run of open.values()) runs.push(run);
  ok("voices exist to inspect", runs.length >= 3);
  ok("every voice ascends strictly",
    runs.every((run) => run.every((m, i) => i === 0 || m > run[i - 1])));

  // ---- 3. a real sprint's end ARRIVES on the downbeat ----------------------
  // A build-up that merely fades is a broken promise. When the push was a
  // sprint, the voices run in toward the next one and land TOGETHER, at full
  // strength, on root and fifth — the payoff, not a fade-out.
  const before = log().length;
  drive(96, 0);    // 6 bars coasting — thrust decays through the off threshold
  const after = log().slice(before);
  const arr = after.filter((e) => e.kind === "arrival");
  ok("the sprint's end lands as an arrival of at least 2 voices, got " + arr.length,
    arr.length >= 2);
  ok("the arrival is ONE moment", new Set(arr.map((e) => e.s)).size === 1);
  ok("and that moment is the downbeat", arr.every((e) => e.s % 16 === 0));
  ok("every landing is root or fifth of the chord it was given",
    arr.every((e) => {
      const pc = ((e.midi % 12) + 12) % 12;
      return pc === e.rootPc || pc === (e.rootPc + 7) % 12;
    }));
  ok("no stray quiet cadence dilutes the payoff",
    after.every((e) => e.kind !== "cadence"));
  ok("after the arrival the figure is silent",
    (Frunky.__rise ? Frunky.__rise().active : -1) === 0);
  const quietAt = log().length;
  drive(64, 0);    // 4 more bars of cruise
  ok("and stays silent while cruising", log().length === quietAt);

  // ---- 4. re-engagement: the next pull starts a new figure -----------------
  drive(48, 12);
  ok("accelerating again re-engages the figure",
    log().slice(quietAt).some((e) => e.kind === "entry"));
}
Frunky.stop();
transport.clear();

// ---- 4b. the landing obeys EVERY chord, not just the home key ---------------
// The first riseLanding initialised its search at A and compared distances
// against the candidate instead of the incumbent — so a chord whose root or
// fifth wasn't A could land the figure on a foreign pitch, heard live as a
// wrong note at the payoff of all moments. Cycle sprints across many bars so
// the landings meet several different chords; the cycle length is deliberately
// NOT a multiple of the 4-bar progression, so the landing bar walks through it.
await Frunky.start();
{
  speed = 0;
  for (let c = 0; c < 8; c++) {
    drive(48, 14);    // three bars of sprint
    drive(88, 0);     // coast — the arrival lands mid-progression
    drive(64, -20);   // brake back down for the next launch
  }
  const land = log().filter((e) => e.kind === "arrival" || e.kind === "cadence");
  const roots = new Set(land.map((e) => e.rootPc));
  ok("landings met several different chords, saw pcs " + [...roots].join(","),
    roots.size >= 2);
  ok("every landing is root or fifth of ITS chord, not the home key's",
    land.every((e) => {
      const pc = ((e.midi % 12) + 12) % 12;
      return pc === e.rootPc || pc === (e.rootPc + 7) % 12;
    }));
}
Frunky.stop();
transport.clear();

// ---- 5. the entry rate follows the push ------------------------------------
// A gentle pull spaces the entries out; a sprint packs them — the event RATE
// is the rev counter, which is the whole concept.
let gentle = 0, hard = 0;
await Frunky.start();
{
  speed = 0;
  drive(96, 5);
  gentle = log().filter((e) => e.kind === "entry").length;
}
Frunky.stop();
transport.clear();
await Frunky.start();
{
  speed = 0;
  drive(96, 16);
  hard = log().filter((e) => e.kind === "entry").length;
}
Frunky.stop();
transport.clear();
ok(`a sprint enters denser than a gentle pull (${hard} vs ${gentle})`, hard > gentle + 3);
ok("but a gentle pull still speaks, got " + gentle, gentle >= 2);

// ---- 5b. a gentle pull ends in staggered cadences, not a drop ---------------
// No sprint, no promise — so no payoff either. The voices land one by one,
// quietly, on a chord tone: a sentence trailing off, not an exclamation mark.
await Frunky.start();
{
  speed = 0;
  drive(96, 5);
  const before = log().length;
  drive(96, 0);
  const after = log().slice(before);
  const cad = after.filter((e) => e.kind === "cadence");
  ok("a gentle ebb produces a cadence, got " + cad.length, cad.length >= 1);
  ok("every cadence lands on root or fifth of the chord it was given",
    cad.every((e) => {
      const pc = ((e.midi % 12) + 12) % 12;
      return pc === e.rootPc || pc === (e.rootPc + 7) % 12;
    }));
  ok("a gentle ebb never fakes an arrival",
    after.every((e) => e.kind !== "arrival"));
}
Frunky.stop();
transport.clear();

// ---- 5c. an end under braking is drained, not celebrated --------------------
// Braking pulls the master lowpass over the whole mix — energy is being taken
// OUT. An arrival chord in that moment would be a lie; the figure takes the
// quiet cadence instead.
await Frunky.start();
{
  speed = 0;
  drive(64, 16);                  // a real sprint…
  const before = log().length;
  drive(96, -14);                 // …ended by hard braking to a stop
  const after = log().slice(before);
  ok("no arrival fires under hard braking",
    after.every((e) => e.kind !== "arrival"));
  ok("the braked-off sprint still resolves, got " +
    after.filter((e) => e.kind === "cadence").length,
    after.some((e) => e.kind === "cadence"));
}
Frunky.stop();
transport.clear();

// ---- 6. lite keeps the figure, smaller --------------------------------------
Frunky.setOption("lite", true);
await Frunky.start();
{
  speed = 0; maxActive = 0; capBust = 0;
  drive(96, 18, 2);
  ok("lite still plays the figure", log().some((e) => e.kind === "entry"));
  ok("lite caps the pool at 2 voices", capBust === 0);
}
Frunky.stop();
transport.clear();
Frunky.setOption("lite", false);

// ---- 7. lean sheds the ornament ---------------------------------------------
// The figure is an ornament, and ornaments go first when the device is at its
// limit. Existing voices may finish; NEW entries must not start.
{
  fakeCtx.renderCapacity.started = false; fakeCtx.renderCapacity.onupdate = null;
  await Frunky.start();
  speed = 0;
  fakeCtx.renderCapacity.onupdate({ averageLoad: 0.95, peakLoad: 1, underrunRatio: 0.05 });
  drive(32, 0); // two bars — lean latches at a barline before any push exists
  ok("lean is latched for the shed test", Frunky.health().lean === true);
  const before = log().length;
  let leanHeld = true;
  for (let b = 0; b < 4; b++) {
    fakeCtx.renderCapacity.onupdate({ averageLoad: 0.95, peakLoad: 1, underrunRatio: 0.05 });
    drive(16, 14);
    if (Frunky.health().lean !== true) leanHeld = false;
  }
  ok("lean stayed latched through the accel", leanHeld);
  ok("no rise entry starts while lean",
    !log().slice(before).some((e) => e.kind === "entry"));
  Frunky.stop();
  transport.clear();
}

// ---- 8. the voice belongs to the band: filter, delay, brightness ------------
// A naked sine next to detuned saws, squares and Rhodes reads as a foreign
// body. The figure's notes go through a per-voice lowpass that OPENS as the
// voice climbs (riser behaviour, in the band's own timbre), and the shared
// dotted-8th delay — the genre glue the hook and the arp live on — carries
// the connection between the plucks.
await Frunky.start();
{
  const r = Frunky.__rise();
  const nodes = r && r.nodes;
  ok("the seam exposes the sound chain",
    !!(nodes && nodes.voices && nodes.lps && nodes.hp && nodes.delaySend && nodes.busHarm));
  if (nodes) {
    ok("every voice reaches its own lowpass",
      nodes.voices.length > 0 &&
      nodes.voices.every((v, i) => v.outs && v.outs.has(nodes.lps[i])));
    ok("every lowpass reaches the shared highpass",
      nodes.lps.every((lp) => lp.outs.has(nodes.hp)));
    ok("the figure reaches its bus", nodes.hp.outs.has(nodes.busHarm));
    ok("and feeds the shared delay — the genre glue", nodes.hp.outs.has(nodes.delaySend));
  }
  // brightness follows the climb: within a voice the cutoff opens
  speed = 0;
  drive(128, 12);
  const runs = [];
  const open = new Map();
  for (const e of log()) {
    if (e.kind === "entry") {
      // a voice that ended by simply fading (no cadence) leaves its run open —
      // flush it before the slot is reused, or every completed run is lost
      if (open.has(e.slot)) runs.push(open.get(e.slot));
      open.set(e.slot, [e]);
      continue;
    }
    const run = open.get(e.slot);
    if (run && e.kind === "climb") run.push(e);
    else if (run) { runs.push(run); open.delete(e.slot); }
  }
  for (const run of open.values()) runs.push(run);
  const full = runs.filter((run) => run.length >= 4);
  ok("full climbs exist to inspect, got " + full.length, full.length >= 3);
  ok("every note carries its cutoff", log().every((e) => Number.isFinite(e.cut)));
  ok("the lowpass opens as the voice climbs",
    full.every((run) => Math.max(...run.map((e) => e.cut)) > run[0].cut * 1.4));
}
Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("RISE_OK");
