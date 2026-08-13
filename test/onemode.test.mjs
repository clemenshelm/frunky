// ONE mode (Build 64). Field directive: "the whole platform only makes
// sense on the Tesla browser and the phone — that should be the default
// and everything should run there. If we build something that doesn't run
// reliably there, we are lying to ourselves. One mode that sounds great
// and performs great."
//
// So the lite/full split is gone. One graph, budgeted for the weakest
// target device, by one rule: FAT oscillators stay on MONO voices (one
// voice — trivial cost, identity), the big POLYPHONIC carpets play a
// single oscillator (padS at 24 voices x 3 oscillators was the real cost)
// with the always-on chorus supplying the width, and the sampled crate
// carries the luxury (playback is nearly free). The lean governor stays:
// overload protection is an airbag, not a mode.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

// ---- 1. the tripwire: the engine never branches on the device again ---------
{
  ok("no opts.lite branch anywhere in the engine (one graph)",
    !/opts\.lite/.test(script));
  ok("no lite oscillator variants in the sound worlds",
    !/lite: "/.test(script));
  // the probe itself STAYS — as a device-class label for the trace, so the
  // field data can still say "this was a car unit"
  ok("the device probe still reports to telemetry",
    /lite: lowPower/.test(script) && /tracer\.begin\(\{ lite: Frunky\.options\(\)\.lite/.test(page));
  ok("but the page offers no mode switch any more",
    !/Sparmodus/.test(page) && !/frunky\.lite/.test(page));
}

// ---- 2. the one budget: carpet single-osc, mono fat, capped polyphony -------
{
  ok("the pad carpet is single-oscillator in every world",
    /pad: \{ osc: \{ type: "sawtooth" \}, attack: 1\.1/.test(script) &&
    /pad: \{ osc: \{ type: "triangle" \}, attack: 1\.5/.test(script) &&
    /pad: \{ osc: \{ type: "sawtooth" \}, attack: 0\.8/.test(script));
  ok("polyphony is capped at the target device's budget",
    /poly\(padS, 24\);/.test(script) && /poly\(padTri, 24\);/.test(script) &&
    /poly\(brassS, 10\);/.test(script) && /poly\(stabS, 12\);/.test(script));
  ok("one room for every device (1.6 s)",
    /reverb = reg\(new Tone\.Reverb\(\{ decay: 1\.6, preDelay: 0\.02, wet: 1 \}\)\);/.test(script));
  ok("two rise voices, mono and fat",
    /for \(let i = 0; i < 2; i\+\+\) \{/.test(script));
}

// ---- 3. the chorus is the width now — always built, shed only by strain -----
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
  ok("the chorus exists on every device", !!g.chorus);
  ok("the strings load on every device (no device gate on the crate)",
    !!Frunky.__world().samplers.strHi && !!Frunky.__world().samplers.strLo);
  ok("zero errors on the one graph", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("ONEMODE_OK");
