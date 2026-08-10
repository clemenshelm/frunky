// The spatial model is the one part of the design whose CORRECTNESS is a claim
// about the human body, not about code: audio that moves against the felt
// pseudo-force is sensory conflict, which is the motion-sickness mechanism. The
// code cannot verify the claim — only the car can — but it can verify that the
// direction the code produces is the direction the design says, and that the
// A/B switch a field test needs really switches something.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

let rc = 0;
Math.random = () => (rc = (rc + 0.377) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone };
eval(script);
const Frunky = globalThis.window.Frunky;
await Frunky.start();

// settle the engine into a cruise so thrust and brake are both at rest
const settle = (speed, lat, frames = 240) => {
  for (let i = 0; i < frames; i++) Frunky.update(1 / 60, { speed, lateralG: lat });
};

// ---- curves: the mix leaves the bend the way the passenger is pushed --------
settle(80, 0);
settle(80, 0.8, 120);
let lv = Frunky.levels();
ok("a right-hand bend pushes the mix left (outward)", lv.pan < -0.1);
settle(80, -0.8, 120);
lv = Frunky.levels();
ok("a left-hand bend pushes the mix right (outward)", lv.pan > 0.1);

// the field test needs an A and a B, or "does it feel right?" has no answer
Frunky.setOption("curveOutward", false);
settle(80, 0.8, 120);
lv = Frunky.levels();
ok("the inward reading is still available for comparison", lv.pan > 0.1);
Frunky.setOption("curveOutward", true);

// ---- depth: the band recedes under thrust, comes forward under braking -----
settle(60, 0, 400);                       // rest
const rest = Frunky.levels();

// accelerate hard for a couple of seconds
let v = 60;
for (let i = 0; i < 150; i++) { v += 0.3; Frunky.update(1 / 60, { speed: v, lateralG: 0 }); }
const accel = Frunky.levels();
ok("thrust adds room", accel.room > rest.room + 0.02);
ok("thrust takes the top off (air absorption)", accel.air < rest.air - 500);

// brake hard from there
for (let i = 0; i < 150; i++) { v = Math.max(0, v - 0.5); Frunky.update(1 / 60, { speed: v, lateralG: 0 }); }
const brake = Frunky.levels();
ok("braking dries the mix out (closer)", brake.room < rest.room - 0.01);
ok("braking does not fight the brake filter over brightness", brake.air >= rest.air - 1);

// and the whole thing can be switched off for the same comparison
Frunky.setOption("inertiaDepth", false);
settle(60, 0, 60);
for (let i = 0; i < 150; i++) { v += 0.3; Frunky.update(1 / 60, { speed: v, lateralG: 0 }); }
const off = Frunky.levels();
ok("depth off leaves the room alone", Math.abs(off.room - 0.4) < 0.001);
ok("depth off leaves the top end alone", off.air > 17000);

ok("options are readable", Frunky.options().inertiaDepth === false);
Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SPATIAL_OK");
