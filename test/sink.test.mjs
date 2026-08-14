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
// route the stream into an <audio> element (default), or connect straight to
// the destination (the old path, kept as the A/B and the fallback). Exactly
// one of the two is ever connected — both at once would double the output.
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
  constructor() { this.srcObject = null; this.played = false; this.paused = false; }
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

// ---- 1. the default: the limiter feeds a media element, and only it --------
{
  const sinkDests = [];
  fakeCtx.createMediaStreamDestination = () => {
    const d = { stream: { id: "sink-stream" }, __sinkDest: true };
    sinkDests.push(d);
    return d;
  };
  const F = await boot();
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
  const F = await boot();
  F.setOption("mediaSink", false);
  await F.start();
  eq("with the option off the direct path is live", F.health().sink, false);
  ok("mediaSink is a real, defaulted option",
    F.options().mediaSink === false && /mediaSink: true/.test(script));
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

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SINK_OK");
