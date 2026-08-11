// Performance and headroom. Crackle on a weak device has exactly three
// mechanisms left in this architecture: the render thread misses a deadline
// (an underrun — the only mechanism no main-thread number can see), the
// scheduler falls behind its look-ahead once and fires a backlog as a burst,
// and a graph carrying effects the device cannot afford. Each one gets a
// countermeasure here, and each countermeasure is asserted, not assumed:
//   1. the context asks for "playback" latency — buffers, not reflexes
//   2. the RenderCapacity probe feeds the strain machine where it exists
//   3. lean sheds the chorus and the convolver, the two render-thread costs
//   4. one proven-late step raises the look-ahead for the rest of the session
import { readFileSync } from "node:fs";
import { Tone as baseTone, transport, fakeCtx, toneCtx } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

let rc = 0;
Math.random = () => (rc = (rc + 0.377) % 1);
transport.manual = true;

// ---- 1. the context is created for playback, once, before any node ---------
// "interactive" asks the browser for its smallest render quantum — headroom
// traded for a latency this app cannot even perceive, since nothing is played
// live and every event is scheduled a quarter second ahead. The order matters
// as much as the option: a node built before setContext lands on the DEFAULT
// context and stays there, so the whole graph must come after the swap.
{
  const calls = [];
  let ctxOpts = null;
  const passthrough = new Set(["start", "loaded", "getTransport",
    "getDestination", "getContext", "connect", "now"]);
  const recorder = new Proxy({}, {
    get(_, key) {
      if (key === "Context") {
        return function FakeToneContext(o) { calls.push("context"); ctxOpts = o || null; };
      }
      if (key === "setContext") return () => { calls.push("setContext"); };
      const v = baseTone[key];
      if (passthrough.has(key)) return v;
      return function ToneClass(...a) { calls.push("node"); return v(...a); };
    },
  });
  const realTone = globalThis.Tone;
  globalThis.Tone = recorder;
  globalThis.window = { Tone: recorder };
  eval(script);
  const Frunky = globalThis.window.Frunky;
  await Frunky.start();

  ok("a context is created explicitly", calls.includes("context"));
  ok("it asks for playback latency", !!ctxOpts && ctxOpts.latencyHint === "playback");
  const firstNode = calls.indexOf("node");
  const set = calls.indexOf("setContext");
  ok("setContext happens before the first node is built",
    set >= 0 && firstNode >= 0 && set < firstNode);

  // a second start must NOT create a second context — contexts are never freed
  Frunky.stop();
  await Frunky.start();
  ok("the context is created exactly once across restarts",
    calls.filter((c) => c === "context").length === 1);
  Frunky.stop();
  globalThis.Tone = realTone;
}

// ---- helpers for the stub-Tone sections ------------------------------------
const boot = async (opts) => {
  globalThis.window = { Tone: globalThis.Tone };
  eval(script);
  const Frunky = globalThis.window.Frunky;
  if (opts && opts.lite) Frunky.setOption("lite", true);
  await Frunky.start();
  return Frunky;
};
const drive = (Frunky, n, t0) => {
  for (let i = 0; i < n; i++) {
    Frunky.update(1 / 60, { speed: 60, lateralG: 0 });
    transport.cb(t0 + i * SPB);
  }
};

// ---- 2. the render-thread probe feeds the strain machine -------------------
// stepCost measures the MAIN thread; an underrun happens on the render thread
// and is the crackle itself, not a proxy for it. Where the browser exposes
// RenderCapacity, an underrun must be recorded, said out loud, and answered
// by the same thinning that answers main-thread strain.
{
  fakeCtx.clockOverride = 0;
  const cap = fakeCtx.renderCapacity;
  cap.started = false; cap.onupdate = null;
  const Frunky = await boot();

  ok("the probe is started with the graph", cap.started === true);
  ok("and subscribed", typeof cap.onupdate === "function");
  ok("no reading yet reads as unsupported", Frunky.health().renderLoad === -1);

  cap.onupdate({ averageLoad: 0.34, peakLoad: 0.5, underrunRatio: 0 });
  const h1 = Frunky.health();
  ok("render load is reported", Math.abs(h1.renderLoad - 0.34) < 1e-9);
  ok("peak render load is kept", Math.abs(h1.renderPeak - 0.5) < 1e-9);
  ok("no underrun yet", h1.underruns === 0);

  drive(Frunky, 40, 10);
  ok("a healthy render thread does not thin the arrangement",
    Frunky.health().lean === false);

  cap.onupdate({ averageLoad: 0.92, peakLoad: 1, underrunRatio: 0.02 });
  const h2 = Frunky.health();
  ok("the underrun is counted", h2.underruns === 1);
  ok("and said out loud", h2.events.some((e) => e.kind === "render"));
  drive(Frunky, 16, 20);
  ok("an underrun latches lean at the next barline", Frunky.health().lean === true);

  Frunky.stop();
  ok("the probe stops with the graph", cap.started === false);
}

// ---- 2b. a browser without the probe loses nothing -------------------------
{
  const saved = fakeCtx.renderCapacity;
  delete fakeCtx.renderCapacity;
  const Frunky = await boot();
  drive(Frunky, 40, 30);
  const h = Frunky.health();
  ok("no probe reads as unsupported, not as idle", h.renderLoad === -1);
  ok("and the engine runs normally without it", h.running === true && h.errors === 0);
  Frunky.stop();
  fakeCtx.renderCapacity = saved;
}

// ---- 3. lean sheds the render-thread costs, and gives them back ------------
// Thinning used to drop NOTES — main-thread work and voices — while the two
// per-sample costs, the chorus and the convolution reverb, kept running at
// full price. A disconnected subtree is not pulled by Web Audio at all, so
// the shed has to be topological, not a gain set to zero.
{
  fakeCtx.renderCapacity.started = false; fakeCtx.renderCapacity.onupdate = null;
  const Frunky = await boot();
  const g = Frunky.__graph();
  ok("the graph seam exposes the shed parties",
    !!(g && g.chorus && g.revSend && g.reverb && g.padLp && g.gateLp && g.busHarm));
  ok("the full graph routes the pad through the chorus", g.padLp.outs.has(g.chorus));
  ok("the full graph feeds the reverb", g.revSend.outs.has(g.reverb));

  // an underrun latches lean at the next barline — the shed must come with it
  fakeCtx.renderCapacity.onupdate({ averageLoad: 0.95, peakLoad: 1, underrunRatio: 0.05 });
  drive(Frunky, 16, 50);
  ok("lean is latched", Frunky.health().lean === true);
  ok("the reverb input is cut", !g.revSend.outs.has(g.reverb));
  ok("the chorus is fully unhooked", g.chorus.outs.size === 0);
  ok("the pad is rewired straight to its bus", g.padLp.outs.has(g.busHarm));
  ok("the gate no longer feeds the chorus", !g.gateLp.outs.has(g.chorus));
  ok("the gate keeps its direct path", g.gateLp.outs.has(g.busHarm));

  // recovery: strain decays on cheap steps, lean unlatches, the graph returns
  drive(Frunky, 96, 60);
  ok("lean recovers on its own", Frunky.health().lean === false);
  ok("the reverb is fed again", g.revSend.outs.has(g.reverb));
  ok("the pad routes through the chorus again", g.padLp.outs.has(g.chorus));
  ok("the chorus feeds its bus again", g.chorus.outs.has(g.busHarm));
  ok("the gate feeds the chorus again", g.gateLp.outs.has(g.chorus));
  ok("the direct pad wire is gone again", !g.padLp.outs.has(g.busHarm));
  Frunky.stop();
}

// ---- 3b. the lite graph has no chorus, and the shed must know that ---------
{
  fakeCtx.renderCapacity.started = false; fakeCtx.renderCapacity.onupdate = null;
  const Frunky = await boot({ lite: true });
  const g = Frunky.__graph();
  ok("lite builds without a chorus", g.chorus === null);
  fakeCtx.renderCapacity.onupdate({ averageLoad: 0.95, peakLoad: 1, underrunRatio: 0.05 });
  drive(Frunky, 16, 200);
  ok("lite lean still cuts the reverb", !g.revSend.outs.has(g.reverb));
  ok("and does not throw over the missing chorus", Frunky.health().errors === 0);
  drive(Frunky, 96, 210);
  ok("lite recovery restores the reverb", g.revSend.outs.has(g.reverb));
  Frunky.stop();
}

// ---- 4. one proven-late step raises the look-ahead for good ----------------
// The burst detection exists; what was missing is the obvious response. A
// device that fell behind 250 ms of look-ahead once needs more slack, not a
// note saying it happened. Raised once, kept for the session — including
// across a watchdog rebuild, which rebuilds the graph but not the evidence.
{
  fakeCtx.clockOverride = 300;
  const Frunky = await boot();
  ok("the base look-ahead is 250ms", toneCtx.lookAhead === 0.25);

  drive(Frunky, 40, 300); // past the warm-up window, nothing late
  ok("healthy steps do not touch it", toneCtx.lookAhead === 0.25);

  transport.cb(299); // one step whose events are already in the past
  ok("a proven-late step raises the look-ahead", toneCtx.lookAhead === 0.5);
  ok("and says so", Frunky.health().events.some(
    (e) => e.kind === "late" && /lookahead/.test(e.text)));

  const notesBefore = Frunky.health().events.filter(
    (e) => /lookahead/.test(e.text)).length;
  transport.cb(298.9);
  ok("it is raised once, not per late step", toneCtx.lookAhead === 0.5);
  ok("and noted once", Frunky.health().events.filter(
    (e) => /lookahead/.test(e.text)).length === notesBefore);

  // a rebuild must keep the raised value — the device did not get faster
  Frunky.stop();
  await Frunky.start();
  ok("a rebuild keeps the raised look-ahead", toneCtx.lookAhead === 0.5);
  Frunky.stop();
  fakeCtx.clockOverride = null;
}

transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PERFORMANCE_OK");
