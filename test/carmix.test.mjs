// The car voicing. Every listening room this product targets is a car — the
// Tesla's own browser, or a phone playing over Bluetooth into the same
// cabin. A cabin adds up to ~12 dB/octave of bass below 70–90 Hz ("cabin
// gain"), and road noise masks exactly the quiet details; a mix tuned on
// desktop speakers arrives bass-heavy and detail-poor, which is the field
// report this stage answers ("der Bass ist sehr dominant und Details kommen
// nicht gut zur Geltung").
//
// So the master chain carries a permanent car voicing: a low shelf pulls the
// sub region back before the cabin doubles it, a presence peak lifts the
// detail band the road noise eats. ON by default on every device — the
// bench keeps an A/B switch, because the right amount is decided by ears in
// the actual car, and an A/B needs a B.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

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

ok("carMix is a real option", typeof Frunky.options().carMix === "boolean");
ok("and it is ON by default — every target room is a car",
  Frunky.options().carMix === true);

function frames(n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 40, lateralG: 0 });
    transport.cb(t);
    t += SPB;
  }
}

for (const lite of [false, true]) {
  Frunky.setOption("lite", lite);
  Frunky.setOption("carMix", true);
  await Frunky.start();
  const label = lite ? "lite: " : "full: ";
  const g = Frunky.__graph();
  ok(label + "the graph exposes the car voicing nodes",
    !!(g && g.carLow && g.carPres && g.masterHp && g.makeup));

  // topology: the voicing sits in the master chain, between the DJ highpass
  // and the makeup gain — so EVERYTHING passes through it, sends included
  ok(label + "masterHp feeds the low shelf", g.masterHp.outs.has(g.carLow));
  ok(label + "the low shelf feeds the presence peak", g.carLow.outs.has(g.carPres));
  ok(label + "the presence peak feeds onward into makeup", g.carPres.outs.has(g.makeup));

  frames(24);
  ok(label + "the low shelf pulls the cabin band back, got " + g.carLow.gain.value,
    g.carLow.gain.value <= -3 && g.carLow.gain.value >= -8);
  ok(label + "the presence peak lifts the detail band, got " + g.carPres.gain.value,
    g.carPres.gain.value >= 1.5 && g.carPres.gain.value <= 5);
  // v2 after the 2026-08-12 field test ("still very bass-heavy, details
  // disappear under the driving noise"): the cabin adds its own low end at
  // speed, so the shelf goes deeper and the detail band comes further
  // forward — pinned exactly, because "somewhere in the band" is how the
  // last calibration quietly stopped matching the car
  ok(label + "v2 shelf depth is -6.5", g.carLow.gain.value === -6.5);
  ok(label + "v2 presence lift is 4", g.carPres.gain.value === 4);

  // the A/B: switching the profile off must genuinely flatten both stages
  Frunky.setOption("carMix", false);
  frames(24);
  ok(label + "off means FLAT on the shelf, got " + g.carLow.gain.value,
    Math.abs(g.carLow.gain.value) < 0.01);
  ok(label + "off means flat on the peak too, got " + g.carPres.gain.value,
    Math.abs(g.carPres.gain.value) < 0.01);
  Frunky.setOption("carMix", true);
  frames(24);
  ok(label + "and back on restores the voicing", g.carLow.gain.value <= -3);

  Frunky.stop();
  transport.clear();
}
Frunky.setOption("lite", false);

// the corner frequencies are the design; the stub cannot see filter types,
// so the source carries them where a reviewer (and this test) can read them
ok("the low shelf sits at the cabin-gain corner (~100 Hz, lowshelf)",
  /carLow = reg\(new Tone\.Filter\(\{ frequency: 100, type: "lowshelf"/.test(script));
ok("the presence peak sits in the detail band (~3.2 kHz, peaking)",
  /carPres = reg\(new Tone\.Filter\(\{ frequency: 3200, type: "peaking"/.test(script));

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("CARMIX_OK");
