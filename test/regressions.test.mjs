// Regression tests for fixes that shipped without one first. Every case here
// reproduces a fault that reached the car, and each would have caught it.
import { readFileSync } from "node:fs";
import { transport, fakeCtx, stubConfig } from "./tone-stub.mjs";

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

// ---- 1. a scheduler catch-up must not poison the rest of the drive ---------
// A backlog fires steps whose times cluster, repeat, or move backwards. Two
// automations assumed times always increase and wrote with no cancel; Tone
// refuses an event behind the last one, so ONE burst threw for every step
// afterwards. The stub now enforces the same rule.
await Frunky.start();
{
  let t = 0, threw = null;
  const drive = (n, jitter) => {
    for (let i = 0; i < n; i++) {
      Frunky.update(1 / 60, { speed: 45, lateralG: 0.2 });
      try {
        transport.cb(t + (jitter ? (i % 3) * -0.04 : 0));
      } catch (err) { threw = threw || err; }
      t += SPB;
    }
  };
  drive(320, false);                    // settle, and reach several sections
  drive(320, true);                     // a burst: times that do not advance cleanly
  drive(160, false);                    // and normal service afterwards
  ok("a catch-up burst does not throw: " + (threw && threw.message),
    threw === null);
  ok("the engine is still running after a burst", Frunky.health().running === true);
  ok("and it still advances", Frunky.health().step > 700);
}
Frunky.stop();
transport.clear();

// ---- 2. lateness measured against the right clock ---------------------------
// Tone.now() already contains the 250 ms look-ahead. Measuring against it
// counted a perfectly healthy step as late and thinned the arrangement out at
// 2 % load. Late means the events are in the PAST.
await Frunky.start();
{
  fakeCtx.clockOverride = 100;
  for (let i = 0; i < 60; i++) {
    Frunky.update(1 / 60, { speed: 45, lateralG: 0 });
    transport.cb(100.25 + i * SPB);   // a full look-ahead of lead: healthy
  }
  ok("a step with a full look-ahead of lead is not late", Frunky.health().lateSteps === 0);
  ok("and the arrangement is not thinned for it", Frunky.health().strain <= 0.5);

  const before = Frunky.health().lateSteps;
  for (let i = 0; i < 40; i++) {
    fakeCtx.clockOverride = 200 + i * SPB;
    Frunky.update(1 / 60, { speed: 45, lateralG: 0 });
    transport.cb(199 + i * SPB);      // the event time has already passed
  }
  ok("a step whose events are in the past IS late", Frunky.health().lateSteps > before);
  fakeCtx.clockOverride = null;
}
Frunky.stop();
transport.clear();

// ---- 3. a hanging sample load must not hang the start button ---------------
// On a weak connection Tone.loaded() simply never settles, and the page sat on
// "preparing audio" forever. The synth fallbacks are already in the graph.
{
  stubConfig.loadedHangs = true;
  const started = await Promise.race([
    Frunky.start(),
    new Promise((r) => setTimeout(() => r("timeout"), 9000)),
  ]);
  ok("start completes even when the samples never arrive", started === true);
  ok("and says so", Frunky.health().events.some((e) => e.kind === "samples"));
  stubConfig.loadedHangs = false;
  Frunky.stop();
  transport.clear();
}

// ---- 4. pulling away blooms, a traffic-light sprint lands ------------------
// The rhythm section used to arrive in one lump because standstill was a hard
// switch. It now fades in — but a launch must NOT wait for that fade.
await Frunky.start();
{
  const settleStill = () => { for (let i = 0; i < 400; i++) Frunky.update(1 / 60, { speed: 0, lateralG: 0 }); };
  settleStill();
  ok("standstill is quiet", Frunky.health().wake < 0.1);

  // an ordinary pull-away: about 6 km/h per second, so 30 km/h after five
  let v = 0;
  for (let i = 0; i < 60; i++) { v += 0.1; Frunky.update(1 / 60, { speed: v, lateralG: 0 }); }
  const afterOneSecond = Frunky.health().wake;
  ok("one second into a normal departure the band has not arrived: " +
    afterOneSecond.toFixed(2), afterOneSecond < 0.55);
  for (let i = 0; i < 400; i++) { v = Math.min(30, v + 0.1); Frunky.update(1 / 60, { speed: v, lateralG: 0 }); }
  ok("a few seconds later it is playing: " + Frunky.health().wake.toFixed(2),
    Frunky.health().wake > 0.8);

  // a sprint off the line must LAND, not fade in — about 28 km/h per second
  settleStill();
  ok("back to quiet", Frunky.health().wake < 0.15);
  let lv = 0;
  for (let i = 0; i < 30; i++) { lv += 0.47; Frunky.update(1 / 60, { speed: lv, lateralG: 0 }); }
  ok("half a second after a launch the beat is there: " + Frunky.health().wake.toFixed(2),
    Frunky.health().wake > 0.8);
}
Frunky.stop();
transport.clear();

// ---- 5. thinning out must not flicker --------------------------------------
// A section that drops and restores its layers mid-bar is heard as the band
// falling out of sync with itself — instruments appearing and vanishing, the
// arp changing rate under a held note. Whatever the load is doing, the
// ARRANGEMENT may only change at a bar line, and only with hysteresis.
await Frunky.start();
{
  let t = 0, changes = [], lastLean = null;
  const stepOnce = (expensive) => {
    Frunky.update(1 / 60, { speed: 45, lateralG: 0 });
    const realNow = performance.now.bind(performance);
    if (expensive) { let f = 0; performance.now = () => (f += 70); }
    transport.cb(t);
    performance.now = realNow;
    const h = Frunky.health();
    if (h.lean !== lastLean) { changes.push({ step: Math.round(t / SPB), lean: h.lean }); lastLean = h.lean; }
    t += SPB;
  };
  for (let i = 0; i < 64; i++) stepOnce(false);          // settle
  // alternate cheap and expensive steps: strain oscillates around its threshold
  for (let i = 0; i < 256; i++) stepOnce(i % 3 === 0);
  for (let i = 0; i < 64; i++) stepOnce(false);          // and calm again

  const midBar = changes.filter((c) => c.step % 16 !== 0);
  ok("the arrangement never changes mid-bar: " + JSON.stringify(midBar.slice(0, 3)),
    midBar.length === 0);
  ok("and it does not flicker bar to bar: " + changes.length + " changes",
    changes.length <= 4);
}
Frunky.stop();
transport.clear();

// ---- 6. layers that arrive at a speed must fade in --------------------------
// The highway elements were gated by a threshold: cross it and a sustained bass
// appears, the arp changes rate, the harmony switches source — all at once and
// at full strength. A layer that switches on is heard as a mistake; a layer
// that grows is heard as the scene opening.
await Frunky.start();
{
  // the motorway latch lives in the sequencer, so the transport has to run:
  // roughly one sixteenth every seven frames at 132 BPM
  let ft = 0;
  const hold = (speed, frames) => {
    for (let i = 0; i < frames; i++) {
      Frunky.update(1 / 60, { speed, lateralG: 0 });
      if (i % 7 === 0) { transport.cb(ft); ft += SPB; }
    }
  };
  hold(45, 600);                                   // town: the flow layer is out
  ok("the flow layer starts closed: " + Frunky.health().flowFade.toFixed(2),
    Frunky.health().flowFade < 0.05);

  hold(130, 60);                                   // one second on the motorway
  const early = Frunky.health().flowFade;
  ok("a second in it has only begun: " + early.toFixed(2), early < 0.45);
  hold(130, 400);
  ok("several seconds later it is there: " + Frunky.health().flowFade.toFixed(2),
    Frunky.health().flowFade > 0.75);

  hold(40, 500);                                   // and it leaves the same way
  ok("it closes again", Frunky.health().flowFade < 0.3);
}
Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("REGRESSIONS_OK");
