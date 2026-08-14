// The media-element sink (Build 67) — the Tesla output experiment.
//
// What build 66's audibility tracing established, on two real drives: the
// graph produced signal the whole time (out 5..240, never a silent stretch,
// gains healthy, context "running") and the driver heard next to nothing.
// So the sound is lost BELOW Web Audio, between the browser's output and the
// car's speakers — a layer no web page can measure. The one lever a page has
// there is HOW it hands audio to the browser: raw AudioContext output is the
// path car browsers are known to deprioritise or swallow, while playback
// through an HTMLMediaElement is the path the browser treats as "media" —
// the same category as the streaming apps that audibly do work in the car.
//
// So the master chain now ends at the limiter, and the LAST hop is a choice:
// route the stream into an <audio> element, or connect straight to the
// destination (the old path, kept as the A/B and the fallback). Exactly
// one of the two is ever connected — both at once would double the output.
//
// Build 68 narrows the DEFAULT to the Tesla alone. The first bench session
// on build 67 heard the cost of shipping the experiment everywhere: "the
// worst pitch shifts, as if someone were playing with the pitch knob, plus
// stutters" — an <audio> element playing a MediaStream keeps its own clock
// against the stream's and corrects the drift by resampling, which IS a
// pitch wobble. The direct path is broken only in the Tesla (the build-66
// traces proved the signal healthy while the car swallowed it), so only a
// Tesla UA gets the media path by default; everywhere else keeps the direct
// output, and the settings toggle still offers the A/B on every device.
import { readFileSync } from "node:fs";
import { transport, fakeCtx } from "./tone-stub.mjs";

const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };
const eq = (label, a, b) => ok(label + " (got " + JSON.stringify(a) + ")", a === b);

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function makeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
class FakeAudio {
  constructor() { this.srcObject = null; this.played = false; this.paused = false;
    this.currentTime = 0; }
  play() { this.played = true; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
const boot = async (patch) => {
  let rc = 0;
  Math.random = () => (rc = (rc + 0.03) % 1);
  transport.manual = true;
  const w = { Tone: globalThis.Tone, localStorage: makeStore(), Audio: FakeAudio };
  if (patch) patch(w);
  globalThis.window = w;
  eval(script);
  return globalThis.window.Frunky;
};

// ---- 1. the Tesla default: the limiter feeds a media element, and only it --
{
  const sinkDests = [];
  fakeCtx.createMediaStreamDestination = () => {
    const d = { stream: { id: "sink-stream" }, __sinkDest: true };
    sinkDests.push(d);
    return d;
  };
  const F = await boot((w) => {
    w.navigator = { userAgent:
      "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Tesla/2026.20" };
  });
  await F.start();
  const g = F.__graph();
  ok("a MediaStreamDestination was created", sinkDests.length === 1);
  ok("the limiter feeds the sink", g.limiter.outs.has(sinkDests[0]));
  ok("the limiter feeds sink + meter and NOTHING else (no double output)",
    g.limiter.outs.size === 2 && g.limiter.outs.has(g.outMeter));
  ok("the element plays the sink's stream",
    g.sinkEl && g.sinkEl.played && g.sinkEl.srcObject === sinkDests[0].stream);
  eq("health says which path is live", F.health().sink, true);
  F.stop();
  ok("stop pauses the element (no orphaned media session)", !!(g.sinkEl && g.sinkEl.paused));
  transport.clear();
  delete fakeCtx.createMediaStreamDestination;
}

// ---- 2. the fallback: no media path available -> the old direct output -----
{
  const F = await boot((w) => { delete w.Audio; });
  await F.start();
  const g = F.__graph();
  ok("without Audio the limiter connects directly (meter + destination)",
    g.limiter.outs.size === 2 && g.limiter.outs.has(g.outMeter) && !g.sinkEl);
  eq("health says the direct path is live", F.health().sink, false);
  F.stop();
  transport.clear();
}

// ---- 3. the A/B: mediaSink off -> direct output, deliberately --------------
{
  fakeCtx.createMediaStreamDestination = () => ({ stream: {}, __sinkDest: true });
  const F = await boot((w) => {
    w.navigator = { userAgent: "Tesla/2026.20 Chrome/148" };
  });
  F.setOption("mediaSink", false);
  await F.start();
  eq("with the option off the direct path is live", F.health().sink, false);
  ok("mediaSink is a real option, defaulted by the device",
    F.options().mediaSink === false && /mediaSink: isTesla/.test(script));
  F.stop();
  transport.clear();
  delete fakeCtx.createMediaStreamDestination;
}

// ---- 3b. everywhere else the DIRECT path is the default --------------------
// The build-67 bench session on a battery-throttled Mac heard why: the
// media element corrects stream-clock drift by resampling — pitch wobble,
// worst exactly when the CPU is under pressure. The direct path degrades
// gracefully there; only the Tesla, where direct is swallowed entirely,
// takes the media path by default. The toggle still offers the A/B anywhere.
{
  fakeCtx.createMediaStreamDestination = () => ({ stream: {}, __sinkDest: true });
  const F = await boot((w) => {
    w.navigator = { userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/148.0.0.0" };
  });
  await F.start();
  const g = F.__graph();
  ok("a non-Tesla browser keeps the direct output despite full media support",
    !g.sinkEl && F.health().sink === false);
  eq("and the option says so", F.options().mediaSink, false);
  F.setOption("mediaSink", true);
  eq("the A/B can still opt in", F.options().mediaSink, true);
  F.stop();
  transport.clear();
  delete fakeCtx.createMediaStreamDestination;
}

// ---- 4. the trace says which path a drive used -----------------------------
{
  globalThis.window = globalThis;
  eval(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
  const S = globalThis.FrunkyTraceSchema;
  const r = S.redactTrace({ v: 1, id: "0123456789abcdef", build: "68",
    opts: { curveOutward: true, inertiaDepth: true, mediaSink: true } });
  ok("opts.mediaSink survives redaction — a car result is uninterpretable " +
    "without knowing which output path it used", r.ok && r.trace.opts.mediaSink === true);
}

// ---- 5. the page offers the A/B, like every field experiment ---------------
{
  ok("the settings row toggles the sink", /mediaSink/.test(page));
}

// ---- 6. the gesture blessing (build 70) ------------------------------------
// Three real Tesla drives on builds 68/69 heard NOTHING while the graph
// produced signal the whole time (out 15..119) and the drift watch learned a
// 2–3 s output-path jitter — the media element never truly played. The
// play() call sits at graph-build time, which is AFTER the consent dialog,
// Tone.start() and the sample downloads: on car LTE that is far outside the
// user-activation window, and a play() without a gesture is refused or
// stalls. So the element is now created and played SYNCHRONOUSLY in the
// click handler — blessed while the gesture is live — and the graph adopts
// it later, merely swapping the stream in.
{
  class FakeMediaStream { constructor() { this.blessed = true; } }
  fakeCtx.createMediaStreamDestination =
    () => ({ stream: { id: "sink-stream" }, __sinkDest: true });
  const F = await boot((w) => {
    w.navigator = { userAgent:
      "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Tesla/2026.20" };
    w.MediaStream = FakeMediaStream;
  });
  const el = F.blessSink();
  ok("blessSink creates and plays an element inside the gesture",
    !!el && el.played === true && el.srcObject instanceof FakeMediaStream);
  await F.start();
  const g = F.__graph();
  ok("start adopts the blessed element instead of creating a fresh one",
    g.sinkEl === el);
  ok("…and hands it the real sink stream",
    !!el.srcObject && el.srcObject.id === "sink-stream");
  eq("health names the media path", F.health().snk, 1);
  F.stop();
  transport.clear();
  delete fakeCtx.createMediaStreamDestination;
}
// blessing is only for the media path — everywhere else it must stay a no-op
{
  const F = await boot((w) => {
    w.navigator = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/148" };
    w.MediaStream = class {};
  });
  ok("blessSink without the media path is a no-op", F.blessSink() == null);
  await F.start();
  eq("…and the direct path reports itself", F.health().snk, 0);
  F.stop();
  transport.clear();
}
// the page blesses inside the click handler, BEFORE anything can await
{
  const begin = /function beginTrip\(\) \{[\s\S]*?\n  \}/.exec(page);
  ok("beginTrip blesses the sink synchronously before the consent ask",
    !!begin && /blessSink/.test(begin[0]) &&
    begin[0].indexOf("blessSink") < begin[0].indexOf("askConsentThen"));
}

// ---- 7. the sink watchdog (build 70) ---------------------------------------
// A play() promise that never settles — or an element the car silently
// starves — is silence with a healthy graph behind it, and the old fallback
// only fired on REJECTION. The watchdog reads the one truth an element
// cannot fake: currentTime. If it stops advancing for 6 s while the engine
// runs, the sink is dead — disconnect it, fall back to the direct path, and
// say so in health() so the next drive's trace names the path that played.
{
  fakeCtx.createMediaStreamDestination =
    () => ({ stream: { id: "sink-stream" }, __sinkDest: true });
  const F = await boot((w) => {
    w.navigator = { userAgent:
      "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Tesla/2026.20" };
  });
  await F.start();
  const g = F.__graph();
  const el = g.sinkEl;
  ok("the watchdog seam exists", typeof F.__sinkWatch === "function");
  el.currentTime = 0.5; F.__sinkWatch(1000);
  el.currentTime = 2.5; F.__sinkWatch(3000);
  eq("an advancing element never falls back", F.health().snk, 1);
  F.__sinkWatch(5000);
  F.__sinkWatch(7000);
  eq("a short stall is tolerated (5 s ago it advanced)", F.health().snk, 1);
  F.__sinkWatch(9500);
  eq("a 6 s stall falls back to the direct path", F.health().snk, 2);
  ok("the limiter now feeds meter + destination and the element is gone",
    g.limiter.outs.size === 2 && g.limiter.outs.has(g.outMeter) &&
    !F.__graph().sinkEl);
  ok("the stalled element was paused (no orphaned media session)", el.paused);
  ok("health keeps reporting signal on the direct path", F.health().sink === false);
  F.stop();
  transport.clear();
  delete fakeCtx.createMediaStreamDestination;
}
// production wiring: the tick runs on a timer while driving
{
  ok("start arms the watchdog timer and stop clears it",
    /sinkWatchTimer = setInterval/.test(script) &&
    /clearInterval\(sinkWatchTimer\)/.test(script));
}

// ---- 8. the trace names the path that actually played ----------------------
{
  globalThis.window = globalThis;
  eval(readFileSync(new URL("../trace-schema.js", import.meta.url), "utf8"));
  const S = globalThis.FrunkyTraceSchema;
  const r = S.redactTrace({ v: S.VERSION, id: "0123456789abcdef", build: "70",
    samples: [{ t: 1000, snk: 2 }] });
  ok("the schema carries snk", r.ok && r.trace.samples[0].snk === 2);
  const r2 = S.redactTrace({ v: S.VERSION, id: "0123456789abcdef", build: "70",
    samples: [{ t: 1000 }] });
  ok("an older build reads as -1, never 'direct'",
    r2.ok && r2.trace.samples[0].snk === -1);
  ok("the page samples snk from health", /snk: h\.snk/.test(page));
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SINK_OK");
