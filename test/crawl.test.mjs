// The crawl band must not flap (Build 74).
//
// Field report, 2026-08-14, Android, 150 s city drive: "katastrophal, das
// Tempo hat enorm geschwankt." The trace shows a drive that lived in the
// 0-9 km/h buckets — a queue — and an engine that is BLIND to queues:
// three musical states each sat behind a single razor threshold in exactly
// that band. standstill armed below 2.5 km/h and cleared at 2.5; the wake
// (the rhythm section's fade target) flipped at energy 0.055 (~6 km/h);
// `still` (drums and figures gating) flipped at 0.06 (~6.6 km/h). GPS
// speed in a queue jitters by a few km/h — so the groove died and revived
// every few seconds, the pad flipped between sus-hold and harmony, and a
// fixed-BPM engine produced what a listener can only call wild tempo
// swings. Nothing was late, nothing was NaN: every threshold did exactly
// what it said, and that is the defect.
//
// The cure is the one the stop counter already uses (moving above 10,
// stopped below 2): every crawl-band state gets TWO edges. Between the
// edges the state HOLDS — same speed, two histories, two answers. That is
// what hysteresis is, and these tests assert it behaviorally: no regex can
// prove a flap absent.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

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
// one bar of real time: four update frames per step, sixteen steps
function makeStepper(F) {
  let t = 1000;
  return (speedOf, steps) => {
    for (let i = 0; i < steps; i++) {
      const v = speedOf(i);
      for (let f = 0; f < 4; f++) F.update(SPB / 4, { speed: v, lateralG: 0 });
      transport.cb(t); t += SPB;
    }
  };
}
const crawl = (F) => F.__drive().crawl;

// ---- 1. the states are on the seam ----------------------------------------
{
  const F = boot(0.03);
  await F.start();
  const c = crawl(F);
  ok("the crawl states are observable (still/awake/standing), got " +
    JSON.stringify(c), c && typeof c.still === "boolean" &&
    typeof c.awake === "boolean" && typeof c.standing === "boolean");
  F.stop();
  transport.clear();
}

// ---- 2. hysteresis proper: the same speed gives two answers ----------------
// 6 km/h sits between every pair of edges. Arrive at it from cruise and the
// band keeps playing; arrive at it from a standstill and the band stays
// quiet. A single-threshold engine cannot pass both halves.
{
  const F = boot(0.03);
  await F.start();
  const step = makeStepper(F);
  step(() => 30, 16 * 8); // real driving: wake up, leave the standstill
  ok("cruise wakes the band", crawl(F).awake === true);
  ok("cruise is not still", crawl(F).still === false);
  step(() => 6, 16 * 6); // slow INTO the band and hold
  ok("from above, 6 km/h keeps the band awake — no flap on the way down",
    crawl(F).awake === true);
  ok("and does not re-enter still", crawl(F).still === false);
  ok("and is not a standstill", crawl(F).standing === false);
  F.stop();
  transport.clear();
}
{
  const F = boot(0.03);
  await F.start();
  const step = makeStepper(F);
  step(() => 0, 16 * 4); // parked: firmly still
  ok("standstill is still", crawl(F).still === true);
  ok("standstill is standing", crawl(F).standing === true);
  step(() => 6, 16 * 6); // creep INTO the band and hold
  ok("from below, 6 km/h does NOT wake the band — a queue creep is not a departure",
    crawl(F).awake === false);
  ok("and stays still", crawl(F).still === true);
  F.stop();
  transport.clear();
}

// ---- 3. the queue: jitter inside the band moves NOTHING --------------------
// A deterministic replica of what GPS reports in stop-and-go: 0-6 km/h,
// changing every couple of seconds. After a short settle, every crawl state
// and the scene must hold for the whole 90 s. This is the drive that was
// catastrophic in the field, replayed.
{
  const F = boot(0.031);
  await F.start();
  const step = makeStepper(F);
  step(() => 0, 16 * 4); // stopped at the light first
  const jitter = (i) => [0, 1, 3, 5, 2, 0, 4, 6, 1, 0][Math.floor(i / 24) % 10];
  step(jitter, 16 * 4); // settle into the queue
  const seen = { still: new Set(), awake: new Set(), standing: new Set(),
    scene: new Set() };
  let flips = 0, last = "";
  const bars = 45; // ~82 s of queue
  for (let b = 0; b < bars; b++) {
    step((i) => jitter(b * 16 + i), 16);
    const c = crawl(F);
    const key = c.still + "/" + c.awake + "/" + c.standing;
    if (last && key !== last) flips++;
    last = key;
    seen.still.add(c.still); seen.awake.add(c.awake); seen.standing.add(c.standing);
    seen.scene.add(F.describe().scene);
  }
  ok("the queue never wakes the band (saw " + [...seen.awake].join(",") + ")",
    seen.awake.size === 1 && seen.awake.has(false));
  ok("the queue never leaves still (saw " + [...seen.still].join(",") + ")",
    seen.still.size === 1 && seen.still.has(true));
  ok("crawl states hold through 45 bars of queue jitter (" + flips + " flips)",
    flips === 0);
  ok("the scene holds too (saw " + [...seen.scene].join(",") + ")",
    seen.scene.size === 1);
  F.stop();
  transport.clear();
}

// ---- 4. a real departure still departs ------------------------------------
// Hysteresis must cost nothing when the light turns green: pulling away
// through the band wakes the band within a few bars, ends still, ends the
// standstill — and stopping again brings still back.
{
  const F = boot(0.03);
  await F.start();
  const step = makeStepper(F);
  step(() => 0, 16 * 4);
  ok("stopped: still", crawl(F).still === true);
  // 0 -> 30 km/h over ~4 s, then hold — an ordinary pull-away
  let v = 0;
  step(() => { v = Math.min(30, v + 0.35); return v; }, 16 * 8);
  ok("pull-away wakes the band", crawl(F).awake === true);
  ok("pull-away ends still", crawl(F).still === false);
  ok("pull-away ends the standstill", crawl(F).standing === false);
  step(() => 0, 16 * 8);
  ok("the next red light is still again", crawl(F).still === true);
  ok("and standing again", crawl(F).standing === true);
  F.stop();
  transport.clear();
}

// ---- 5. the fix must be OBSERVABLE in the field ----------------------------
// The catastrophic drive's trace showed clean scheduling and a healthy
// graph, because the flapping lived in states no trace field carried: the
// ENGINE's scene (breath/patience) and the crawl gates. A fix that the
// next trace cannot confirm is a hope, not a fix. `esc` carries the engine
// scene, `cst` the three crawl gates as bits (still=1, awake=2,
// standing=4); both are about the ENGINE, derived from already-bucketed
// kinematics, never about the person. -1 = older build, per the contract.
{
  const schema = readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8");
  ok("schema: esc carries the engine scene as an enum",
    /esc: oneOf\(ENGINE_SCENES, ""\)/.test(schema) &&
    /ENGINE_SCENES = \["", "ouverture", "free", "breath", "patience", "coda"\]/.test(schema));
  ok("schema: cst carries the crawl gates, -1 for older builds",
    /cst: int\(-1, 7, -1\)/.test(schema));
  // the tracer is an ALLOW-list: a field the page sends but sample() does
  // not forward dies silently right here — the same layer that would have
  // eaten pg/px had the collector test not caught it
  const tracer = readFileSync(new URL("../trace.js", import.meta.url), "utf8");
  ok("the tracer forwards esc and cst",
    /esc: typeof state\.esc === "string" \? state\.esc : ""/.test(tracer) &&
    /cst: probe\(state\.cst\)/.test(tracer));
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  ok("the drive page forwards esc and cst",
    /esc: h\.esc/.test(page) && /cst: h\.cst/.test(page));
  const bench = readFileSync(new URL("../bench.html", import.meta.url), "utf8");
  ok("the bench loads trace.js — without FrunkyTrace the pulse probe is " +
    "silently dead in the very tool built to iterate on stutter",
    /<script src="trace\.js\?v=/.test(bench));

  const F = boot(0.03);
  await F.start();
  const step = makeStepper(F);
  step(() => 0, 16 * 2);
  const h = F.health();
  ok("health names the engine scene (got " + JSON.stringify(h.esc) + ")",
    typeof h.esc === "string" && h.esc.length > 0);
  ok("health packs the crawl gates: standing+still at a standstill (got " +
    h.cst + ")", (h.cst & 1) === 1 && (h.cst & 4) === 4);
  step(() => 40, 16 * 8);
  ok("and awake without still when driving (got " + F.health().cst + ")",
    (F.health().cst & 2) === 2 && (F.health().cst & 1) === 0);
  F.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("CRAWL_OK");
