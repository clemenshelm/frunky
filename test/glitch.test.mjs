// The glitch ear (Build 68). Field report: on the phone over Bluetooth the
// music develops small hiccups after a few minutes — and the 262 s build-66
// trace of exactly such a drive is spotless: late 0, stalls 0, under 0, heap
// flat, freezes 0. That is not evidence of health; it is a blind spot. The
// hiccup layer is the render/output side, and this phone's Chrome has no
// RenderCapacity API (rload -1), so `under` structurally CANNOT count there.
//
// What a page can always measure is the relationship between the audio clock
// and the wall clock: when the output stalls, the audio clock falls behind by
// exactly the audible gap. So build 68 adds a drift watch — a pure,
// self-calibrating detector fed every 250 ms with (wallMs, audioSec):
//   - it first LEARNS the device's natural jitter (burst rendering makes the
//     drift oscillate; a fixed threshold would false-fire on exactly the
//     bursty Bluetooth paths we care about),
//   - then counts episodes where drift jumps past the learned threshold
//     (gl, cumulative), remembers the worst excess (gx, ms), and reports the
//     learned jitter itself (aj, ms) — which characterises the output path.
//   - a feed gap > 1 s (suspend, hidden tab) recalibrates instead of counting
//     a phantom glitch: the audio clock legitimately stops there.
// All three ride the existing trace probe contract: -1 = "no probe", never 0.
import { readFileSync } from "node:fs";
import { transport, worklet } from "./tone-stub.mjs";

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

globalThis.window = globalThis;
eval(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
eval(readFileSync(new URL("../trace.js", import.meta.url), "utf8"));
const T = globalThis.FrunkyTrace;

ok("makeDriftWatch is exported", typeof T.makeDriftWatch === "function");
const mk = typeof T.makeDriftWatch === "function"
  ? T.makeDriftWatch : () => Object.assign(() => {}, { read: () => ({}) });

// ---- 1. a healthy clock counts nothing -------------------------------------
{
  const w = mk();
  // steady 250 ms cadence, audio clock tracking wall clock at a fixed offset
  for (let i = 0; i < 60; i++) w(i * 250, i * 0.25 - 0.1);
  const r = w.read();
  eq("no glitches on a steady clock", r.gl, 0);
  eq("no worst excess either", r.gx, 0);
  ok("learned jitter is reported and small (got " + r.aj + ")",
    typeof r.aj === "number" && r.aj >= 0 && r.aj < 10);
}

// ---- 2. natural burst jitter is learned, not reported as glitches ----------
{
  const w = mk();
  // the renderer fills in ~40 ms bursts: drift oscillates +-40 ms forever.
  // The first samples teach the watch this is normal; the rest must not fire
  for (let i = 0; i < 200; i++) w(i * 250, i * 0.25 - 0.1 - (i % 2 ? 0.04 : 0));
  const r = w.read();
  eq("burst-rendering oscillation never counts as a glitch", r.gl, 0);
  ok("but the jitter is on record (got " + r.aj + ")", r.aj >= 35 && r.aj <= 45);
}

// ---- 3. a real stall is one glitch, with its size --------------------------
{
  const w = mk();
  let audio = 0;
  for (let i = 0; i < 40; i++) { w(i * 250, audio); audio += 0.25; }
  // the output stalls for ~120 ms: the audio clock advances only 130 ms in
  // the 250 ms window and stays behind from then on
  audio -= 0.12;
  w(40 * 250, audio);
  for (let i = 41; i < 60; i++) { audio += 0.25; w(i * 250, audio); }
  const r = w.read();
  eq("one stall = one glitch episode", r.gl, 1);
  ok("its size lands near 120 ms (got " + r.gx + ")", r.gx >= 100 && r.gx <= 140);
}

// ---- 4. two separate stalls are two episodes -------------------------------
{
  const w = mk();
  let audio = 0;
  const step = (short) => { audio += short ? 0.13 : 0.25; };
  for (let i = 0; i < 40; i++) { w(i * 250, audio); step(false); }
  step(false); audio -= 0.12; w(40 * 250, audio); audio += 0.12;
  for (let i = 41; i < 80; i++) { w(i * 250, audio); step(false); }
  audio -= 0.2; w(80 * 250, audio); audio += 0.2;
  for (let i = 81; i < 100; i++) { w(i * 250, audio); step(false); }
  const r = w.read();
  eq("two stalls with recovery between them = two episodes", r.gl, 2);
  ok("the worst one is on record (got " + r.gx + ")", r.gx >= 180);
  // read() is cumulative like late/stalls — a second read repeats the totals
  eq("read() does not reset", w.read().gl, 2);
}

// ---- 5. slow clock-rate wander is not a glitch -----------------------------
{
  const w = mk();
  // audio clock runs 0.4% slow: drift climbs 1 ms per 250 ms sample, forever.
  // The windowed baseline follows; nothing ever jumps
  for (let i = 0; i < 400; i++) w(i * 250, i * 0.249);
  eq("clock-rate drift never fires", w.read().gl, 0);
}

// ---- 6. a feed gap recalibrates instead of firing --------------------------
{
  const w = mk();
  for (let i = 0; i < 40; i++) w(i * 250, i * 0.25);
  // 30 s suspended: the audio clock stood still, the wall clock did not
  for (let i = 0; i < 60; i++) w(40 * 250 + 30000 + i * 250, 10 + i * 0.25);
  eq("a suspend gap is not a glitch", w.read().gl, 0);
}

// ---- 7. garbage in, nothing out --------------------------------------------
{
  const w = mk();
  w(NaN, 1); w(1000, NaN); w(undefined, undefined); w("x", "y");
  const r = w.read();
  ok("non-finite feeds are ignored", r.gl === 0 && r.gx === 0);
}

// ---- 8. the schema carries the fields, -1 = no probe -----------------------
{
  const S = globalThis.FrunkyTraceSchema;
  const base = { v: 1, id: "0123456789abcdef", build: "68", samples: [] };
  const full = S.redactTrace({ ...base, samples: [{
    t: 1000, speed: 3, gl: 2, gx: 120, aj: 40 }] });
  ok("redaction keeps a glitch sample", full.ok);
  eq("gl survives redaction", full.trace.samples[0].gl, 2);
  eq("gx survives redaction", full.trace.samples[0].gx, 120);
  eq("aj survives redaction", full.trace.samples[0].aj, 40);
  const old = S.redactTrace({ ...base, samples: [{ t: 1000, speed: 3 }] });
  eq("absent gl reads as 'no probe', not clean", old.trace.samples[0].gl, -1);
  eq("absent gx reads as 'no probe'", old.trace.samples[0].gx, -1);
  eq("absent aj reads as 'no probe'", old.trace.samples[0].aj, -1);
}

// ---- 9. the tracer forwards them --------------------------------------------
{
  const tr = T.create({ endpoint: "https://x.example/t", build: "68",
    userAgent: "TestUA", fetch: async () => ({ ok: true }) });
  tr.setConsent(true);
  tr.begin({});
  tr.sample({ speed: 10, gl: 3, gx: 250, aj: 12 });
  const snap = tr.snapshot();
  eq("tracer forwards gl", snap.samples[0].gl, 3);
  eq("tracer forwards gx", snap.samples[0].gx, 250);
  eq("tracer forwards aj", snap.samples[0].aj, 12);
  tr.sample({ speed: 10 });
  const snap2 = tr.snapshot();
  ok("a sample without the probe carries -1",
    !!snap2.samples[1] && snap2.samples[1].gl === -1);
  tr.end("user", {});
}

// ---- 10. the page feeds the watch and samples the fields --------------------
{
  ok("the page creates the drift watch", /makeDriftWatch/.test(page));
  ok("the page samples gl/gx/aj",
    /gl: /.test(page) && /gx: /.test(page) && /aj: /.test(page));
  ok("the feed prefers getOutputTimestamp over raw currentTime",
    /getOutputTimestamp/.test(page));
}

// ---- 11. the pulse watch (build 70) ----------------------------------------
// The drift watch came back CLEAN on the very drive that stuttered (376 s,
// build 68: gl 0, aj 53) — and that is not an acquittal, because Chrome's
// audio clock is EXTRAPOLATED: it advances smoothly across render-thread
// stalls, which is exactly the audible layer on a phone without
// RenderCapacity. The pulse watch closes that blind spot from the inside: an
// AudioWorklet stamps its own wall clock from the render thread (~every
// 0.5 s of rendered audio) and posts the stamps out. A stalled render thread
// cannot stamp — the gap between stamps IS the audible gap, immune to
// main-thread jank because queued messages carry the stamp, not the arrival.
ok("makePulseWatch is exported", typeof T.makePulseWatch === "function");
const mkP = typeof T.makePulseWatch === "function"
  ? T.makePulseWatch : () => Object.assign(() => {}, { read: () => ({}), reset: () => {} });

// 11a. a healthy render thread counts nothing
{
  const w = mkP();
  for (let i = 0; i < 100; i++) w(1000 + i * 500);
  const r = w.read();
  eq("no episodes on steady stamps", r.pg, 0);
  eq("no worst excess either", r.px, 0);
}

// 11b. scheduling jitter is not a stall
{
  const w = mkP();
  let t = 1000;
  for (let i = 0; i < 100; i++) { t += i % 2 ? 700 : 400; w(t); }
  const r = w.read();
  eq("sub-second jitter never counts", r.pg, 0);
}

// 11c. a real render stall is one episode with its excess on record
{
  const w = mkP();
  let t = 1000;
  for (let i = 0; i < 10; i++) { t += 500; w(t); }
  t += 2500; w(t);                       // the render thread went away for 2 s
  for (let i = 0; i < 10; i++) { t += 500; w(t); }
  const r = w.read();
  eq("one oversized gap is one episode", r.pg, 1);
  eq("the excess over the nominal cadence is the worst", r.px, 2000);
}

// 11d. repeated stalls accumulate, the worst wins
{
  const w = mkP();
  let t = 1000;
  for (let i = 0; i < 5; i++) { t += 500; w(t); }
  t += 2000; w(t);
  for (let i = 0; i < 5; i++) { t += 500; w(t); }
  t += 4500; w(t);
  const r = w.read();
  eq("two stalls, two episodes", r.pg, 2);
  eq("the worst excess is kept", r.px, 4000);
}

// 11e. reset() forgives the next gap (suspend/resume is not a stall) but
// keeps the counters — the drive's ledger survives a pause
{
  const w = mkP();
  let t = 1000;
  for (let i = 0; i < 5; i++) { t += 500; w(t); }
  t += 3000; w(t);
  eq("the stall before the reset counted", w.read().pg, 1);
  w.reset();
  t += 60000; w(t);                      // a minute of legitimate silence
  for (let i = 0; i < 5; i++) { t += 500; w(t); }
  const r = w.read();
  eq("the post-reset gap is forgiven", r.pg, 1);
  eq("the worst excess still stands", r.px, 2500);
}

// ---- 12. the engine runs the worklet and reports pg/px ----------------------
{
  const engineSrc = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
  ok("the engine registers a pulse worklet processor",
    /registerProcessor\(\\"frunky-pulse\\", P\)/.test(engineSrc));
  // Build 72 shipped this probe dead: it built the node with the GLOBAL
  // AudioWorkletNode against Tone's wrapped context, which throws
  // "parameter 1 is not of type BaseAudioContext". Nothing was red — a
  // failed probe reports pg -1, which is indistinguishable from "this
  // browser has no probe", the exact silence this watch exists to break.
  ok("it goes through Tone's own context API, never the global constructor",
    /addAudioWorkletModule\(/.test(engineSrc) &&
    /createAudioWorkletNode\("frunky-pulse"\)/.test(engineSrc) &&
    !/new WN\(/.test(engineSrc) && !/new AudioWorkletNode\(/.test(engineSrc));
  ok("the worklet stamps its own wall clock, not the arrival time",
    /postMessage\(Date\.now\(\)\)/.test(engineSrc));
  ok("a fresh episode feeds the strain machine (the arrangement thins in " +
    "answer to the actual mechanism)",
    /pulseGaps > pulseGapsSeen[\s\S]{0,200}strain = 1/.test(engineSrc));
  ok("health reports pg/px with the -1 no-probe contract",
    /pg: pulseGaps, px: pulseWorst/.test(engineSrc));
}

// ---- 13. schema + tracer + page carry pg/px --------------------------------
{
  const S = globalThis.FrunkyTraceSchema;
  const base = { v: S.VERSION, id: "0123456789abcdef", build: "70",
    samples: [{ t: 1000, pg: 2, px: 1234 }] };
  const r = S.redactTrace(base);
  ok("the schema carries pg", r.ok && r.trace.samples[0].pg === 2);
  ok("the schema carries px", r.ok && r.trace.samples[0].px === 1234);
  const r2 = S.redactTrace({ v: S.VERSION, id: "0123456789abcdef", build: "70",
    samples: [{ t: 1000 }] });
  ok("an older build reads as -1, never 0",
    r2.ok && r2.trace.samples[0].pg === -1 && r2.trace.samples[0].px === -1);
  const tr = T.create({ build: "70", endpoint: "https://x/api/v1/traces",
    store: (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    userAgent: "TestUA", fetch: async () => ({ ok: true }) });
  tr.setConsent(true);
  tr.begin({});
  tr.sample({ speed: 10, pg: 3, px: 900 });
  const snap = tr.snapshot();
  eq("tracer forwards pg", snap.samples[0].pg, 3);
  eq("tracer forwards px", snap.samples[0].px, 900);
  ok("the page samples pg/px from health",
    /pg: h\.pg/.test(page) && /px: h\.px/.test(page));
  tr.end("user", {});
}

// ---- 14. the probe really starts, against a Tone-shaped context ------------
// The source pin above is not enough on its own — it is exactly what build 72
// had, and the probe was still dead in the field. This boots the engine and
// asserts the module, the node and the wiring, so "the worklet started" is
// checked rather than described.
{
  worklet.reset();
  let rc = 0;
  Math.random = () => (rc = (rc + 0.03) % 1);
  transport.manual = true;
  const m = new Map();
  const win = { Tone: globalThis.Tone, FrunkyTrace: T, localStorage: {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } } };
  globalThis.window = win;
  eval(readFileSync(new URL("../engine.js", import.meta.url), "utf8"));
  const F = win.Frunky;
  await F.start();
  // the module load resolves on a microtask chain; let it land
  for (let i = 0; i < 10 && !worklet.nodes.length; i++) await Promise.resolve();
  if (!worklet.nodes.length) await new Promise((r) => setTimeout(r, 0));
  ok("the engine loaded a worklet module", worklet.modules.length === 1);
  ok("…and built the pulse node through Tone's context",
    worklet.nodes.length === 1 && worklet.nodes[0].workletName === "frunky-pulse");
  const node = worklet.nodes[0];
  ok("…and listens on its port",
    !!node && typeof node.port.onmessage === "function");
  if (!node) { failures.push("no pulse node — the rest cannot be checked"); }
  // now speak as the render thread would: steady stamps, then a 2 s stall
  let t = 1000;
  const feed = (ms) => { if (node && node.port.onmessage) node.port.onmessage({ data: ms }); };
  for (let i = 0; i < 8; i++) { t += 500; feed(t); }
  eq("a healthy render thread counts nothing", F.health().pg, 0);
  t += 2500; feed(t);
  eq("a real stall reaches health()", F.health().pg, 1);
  eq("with its excess in ms", F.health().px, 2000);
  F.stop();
  transport.clear();
  globalThis.window = globalThis;
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("GLITCH_OK");
