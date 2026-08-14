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

{
  // one mode (Build 64): a single graph — no lite loop left to test
  Frunky.setOption("carMix", true);
  await Frunky.start();
  const label = "";
  const g = Frunky.__graph();
  ok(label + "the graph exposes the car voicing nodes",
    !!(g && g.carLow && g.carMud && g.carPres && g.carAir && g.masterHp && g.makeup));

  // topology: the voicing sits in the master chain, between the DJ highpass
  // and the makeup gain — so EVERYTHING passes through it, sends included
  ok(label + "masterHp feeds the low shelf", g.masterHp.outs.has(g.carLow));
  ok(label + "the low shelf feeds the mud cut", g.carLow.outs.has(g.carMud));
  ok(label + "the mud cut feeds the presence peak", g.carMud.outs.has(g.carPres));
  ok(label + "the presence peak feeds the air shelf", g.carPres.outs.has(g.carAir));
  ok(label + "the air shelf feeds onward into makeup", g.carAir.outs.has(g.makeup));

  frames(24);
  // v3 (Build 65), from a MEASURED master spectrum (45 s simulated drive,
  // tools/mix-spectrum.json): low-mids sat 11 dB over the mids, the 2-6 kHz
  // band 20 dB under them — "massively dominant bass" even on laptop
  // speakers. Deeper shelf, the classic 280 Hz mud cut, stronger presence,
  // and an air shelf for what the one-mode carpet's lost saw stack used to
  // supply. Pinned exactly, because "somewhere in the band" is how the
  // last calibration quietly stopped matching the car
  // v4 (build 67): the field verdict after the v3 A/B — phone over Bluetooth,
  // "still a touch too bass-heavy, not much" — is worth exactly 1.5 dB more
  // shelf, not a redesign
  ok(label + "v4 shelf depth is -10, got " + g.carLow.gain.value,
    g.carLow.gain.value === -10);
  ok(label + "v3 mud cut is -3, got " + g.carMud.gain.value,
    g.carMud.gain.value === -3);
  ok(label + "v3 presence lift is 6, got " + g.carPres.gain.value,
    g.carPres.gain.value === 6);
  ok(label + "v3 air shelf is 2.5, got " + g.carAir.gain.value,
    g.carAir.gain.value === 2.5);

  // the A/B: switching the profile off must genuinely flatten both stages
  Frunky.setOption("carMix", false);
  frames(24);
  ok(label + "off means FLAT on the shelf, got " + g.carLow.gain.value,
    Math.abs(g.carLow.gain.value) < 0.01);
  ok(label + "off means flat on the peak too, got " + g.carPres.gain.value,
    Math.abs(g.carPres.gain.value) < 0.01);
  ok(label + "and flat on mud and air, got " + g.carMud.gain.value + "/" + g.carAir.gain.value,
    Math.abs(g.carMud.gain.value) < 0.01 && Math.abs(g.carAir.gain.value) < 0.01);
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

// Build 67, the second field verdict from the same drive: "the organ sticks
// out" — the long held chords, i.e. the pad carpet's voicings. One named
// trim on padVol (-2 dB), so the next adjustment is a one-line diff and this
// pin, not a hunt through a five-factor product
ok("the pad carpet carries the -2 dB field trim (PAD_TRIM 0.8)",
  /const PAD_TRIM = 0\.8/.test(script) &&
  /const padVol = PAD_TRIM \* \(0\.16 \+ 0\.2 \* flowHigh\)/.test(script));

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("CARMIX_OK");
