// Audibility (Build 66). Field lesson, stated plainly: four Tesla drives on
// build 65 recorded ZERO errors, zero late steps, notes flowing to the last
// sample — and the driver heard the music die within seconds, every time. The
// voices counter was the one honest witness (long stretches of 0 while `notes`
// kept counting): the engine was SCHEDULING into silence, and nothing in the
// trace could say where between "note scheduled" and "sound at the speaker"
// the signal was lost. The health seam even predicted this blind spot in a
// comment: the master/duck gains are automated by the music itself, and one
// parked low "is heard as the music dying and is visible nowhere else".
//
// So build 66 records the missing layers, from the inside out:
//   voices  (already there)  — is anything ringing in the pad carpet?
//   out     (new)            — is there SIGNAL at the master output? An
//                              analyser behind the limiter, RMS x1000. This is
//                              the fact that separates "our graph went silent"
//                              from "the graph plays and the car swallows it".
//   gm/gd/gh/gdr (new)       — the automated gains that can park: master,
//                              duck, harm bus, drums bus, centi-gain.
//   air     (new)            — the depth lowpass cutoff in Hz: a filter parked
//                              at the bottom is silence with healthy gains.
// Plus a watchdog: sustained "scheduling but no output" becomes an EVENT with
// a duration, so a viewer sees the failure without reading 200 samples.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// ---- 1. the engine measures its own output ----------------------------------
{
  function makeStore() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  }
  let rc = 0;
  Math.random = () => (rc = (rc + 0.03) % 1);
  transport.manual = true;
  globalThis.window = { Tone: globalThis.Tone, localStorage: makeStore() };
  eval(script);
  const Frunky = globalThis.window.Frunky;
  await Frunky.start();

  const g = Frunky.__graph();
  ok("the output meter exists and hangs behind the limiter",
    !!(g && g.outMeter && g.limiter && g.limiter.outs && g.limiter.outs.has(g.outMeter)));

  const h = Frunky.health();
  // the stub analyser returns silence: out must SAY 0, not be absent —
  // "no probe" is -1 and a different fact
  eq("out is measured (silent stub = 0)", h.out, 0);
  // a signal at the meter is reported as RMS x1000, rounded
  if (g && g.outMeter) {
    g.outMeter.getValue = () => new Float32Array(64).fill(0.1);
    eq("out reports RMS x1000 of the meter's window", Frunky.health().out, 100);
    g.outMeter.getValue = () => { throw new Error("probe broke"); };
    eq("a broken probe reports -1, never throws", Frunky.health().out, -1);
    g.outMeter.getValue = () => new Float32Array(64);
  }

  // the automated gains, centi-gain: all four exist and sit at their
  // resting positions on a fresh graph (master ramps to 0.9 at boot, duck
  // rests at 1.0, buses open)
  eq("gm: master gain is recorded", h.gm, 90);
  eq("gd: duck gain is recorded", h.gd, 100);
  ok("gh: harm bus gain is recorded (open)", typeof h.gh === "number" && h.gh > 0);
  ok("gdr: drums bus gain is recorded (open)", typeof h.gdr === "number" && h.gdr > 0);
  ok("air: the depth lowpass cutoff is recorded in Hz",
    typeof h.air === "number" && h.air > 0);

  Frunky.stop();
  transport.clear();
}

// ---- 2. the schema carries the new layers -----------------------------------
{
  globalThis.window = globalThis;
  eval(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
  const S = globalThis.FrunkyTraceSchema;
  const base = { v: 1, id: "0123456789abcdef", build: "66", samples: [] };

  const full = S.redactTrace({ ...base, samples: [{
    t: 1000, speed: 3, scene: "cruise", out: 137, gm: 100, gd: 88, gh: 95,
    gdr: 90, air: 12000 }] });
  ok("redaction keeps a full audibility sample", full.ok);
  const s = full.trace.samples[0];
  eq("out survives redaction", s.out, 137);
  eq("gm survives redaction", s.gm, 100);
  eq("gd survives redaction", s.gd, 88);
  eq("gh survives redaction", s.gh, 95);
  eq("gdr survives redaction", s.gdr, 90);
  eq("air survives redaction", s.air, 12000);

  // a sample from an older build never said "parked at zero" — absence must
  // coerce to -1 (no probe), the same contract rload already has
  const old = S.redactTrace({ ...base, samples: [{ t: 1000, speed: 3 }] });
  eq("absent out reads as 'no probe', not silence", old.trace.samples[0].out, -1);
  eq("absent gm reads as 'no probe', not parked", old.trace.samples[0].gm, -1);
  eq("absent air reads as 'no probe', not closed", old.trace.samples[0].air, -1);
}

// ---- 3. the tracer forwards them, and the watchdog names the failure --------
{
  globalThis.window = globalThis;
  eval(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
  eval(readFileSync(new URL("../trace.js", import.meta.url), "utf8"));
  const T = globalThis.FrunkyTrace;
  const tr = T.create({ endpoint: "https://x.example/t", build: "66",
    userAgent: "TestUA", fetch: async () => ({ ok: true }) });
  tr.setConsent(true);
  tr.begin({});
  tr.sample({ speed: 10, out: 42, gm: 100, gd: 77, gh: 95, gdr: 90, air: 9000 });
  const snap = tr.snapshot();
  eq("tracer forwards out", snap.samples[0].out, 42);
  eq("tracer forwards gd", snap.samples[0].gd, 77);
  eq("tracer forwards air", snap.samples[0].air, 9000);
  tr.end("user", {});

  // the watchdog is a pure decision, testable without a browser: sustained
  // "notes scheduled, no output" arms after 10 s, fires ONCE, and reports the
  // episode's end with its total duration. Musical silence is not a failure:
  // when nothing is being scheduled (coda fade, stopped engine) it never arms,
  // and a browser without the probe (out -1) can never arm it either.
  ok("makeSilenceWatch is exported", typeof T.makeSilenceWatch === "function");
  const mkWatch = typeof T.makeSilenceWatch === "function"
    ? T.makeSilenceWatch : () => () => null;
  const w = mkWatch(10000);
  eq("silence below 10 s says nothing", w(0, 0, 12), null);
  eq("still quiet at 9 s: patience", w(9000, 1, 12), null);
  const on = w(11000, 0, 12);
  ok("at 11 s of scheduled-but-silent it fires ON", !!on && on.code === "on");
  eq("and only once", w(16000, 0, 12), null);
  const off = w(20000, 250, 12);
  ok("sound returning fires OFF with the episode duration",
    !!off && off.code === "off" && off.n === 20000);
  eq("a healthy stretch stays quiet", w(25000, 250, 12), null);

  const w2 = mkWatch(10000);
  w2(0, 0, 0);
  eq("no notes scheduled = musical silence, never armed", w2(60000, 0, 0), null);
  const w3 = mkWatch(10000);
  w3(0, -1, 12);
  eq("no probe (-1) can never arm the watchdog", w3(60000, -1, 12), null);
  const w4 = mkWatch(10000);
  w4(0, 0, 12);
  w4(5000, 0, 0); // scheduling stopped mid-episode (coda): stand down
  eq("an episode is abandoned when scheduling stops", w4(20000, 0, 12), null);
}

// ---- 4. the page wires both: the fields into the sample, the watchdog on ----
{
  ok("the page samples the audibility layers",
    /out: h\.out/.test(page) && /gm: h\.gm/.test(page) && /gd: h\.gd/.test(page) &&
    /gh: h\.gh/.test(page) && /gdr: h\.gdr/.test(page) && /air: h\.air/.test(page));
  ok("the page runs the silence watchdog and records it as a watchdog event",
    /makeSilenceWatch/.test(page) && /tracer\.event\("watchdog"/.test(page));
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("AUDIBILITY_OK");
