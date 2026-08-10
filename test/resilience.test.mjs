// The engine has to survive its own bugs. A throw inside the transport
// callback used to end the music: the callback dies and every later step goes
// with it, which the listener hears as the track simply stopping. Nothing the
// sequencer can get wrong is worth silence — and in a car there is no console,
// so what went wrong has to be readable from the engine itself.
import { readFileSync } from "node:fs";
import { transport, fakeCtx } from "./tone-stub.mjs";

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
await Frunky.start();

const step = (n, t0 = 0) => {
  for (let i = 0; i < n; i++) {
    Frunky.update(1 / 60, { speed: 60, lateralG: 0 });
    transport.cb(t0 + i * SPB);
  }
};

// ---- a bug in one step must not end the piece -------------------------------
step(64);
const before = Frunky.health();
ok("a healthy run reports no errors", before.errors === 0);

// poison one voice so the step throws, exactly as a real bug would
const realRandom = Math.random;
let poisoned = 0;
Math.random = () => {
  if (poisoned++ === 40) throw new Error("synthetic step fault");
  return realRandom();
};
step(64, 100);
Math.random = realRandom;

const after = Frunky.health();
ok("the fault was recorded", after.errors > 0);
ok("the fault is readable, not just counted",
  after.events.some((e) => e.kind === "step" && /synthetic step fault/.test(e.text)));
ok("the engine kept running through it", after.running === true);
ok("the sequencer kept advancing", after.step > before.step + 60);

// and it keeps going afterwards
const advanced = Frunky.health().step;
step(64, 200);
ok("steps continue after the fault", Frunky.health().step > advanced + 60);

// ---- a suspended audio clock is silence that looks like a crash -------------
fakeCtx.state = "suspended";
for (let i = 0; i < 200; i++) Frunky.update(1 / 60, { speed: 60, lateralG: 0 });
const susp = Frunky.health();
ok("a suspended context is noticed", susp.resumes > 0);
ok("and said out loud", susp.events.some((e) => e.kind === "audio"));
fakeCtx.state = "running";

// ---- the record is bounded ---------------------------------------------------
for (let i = 0; i < 200; i++) Frunky.log("test", "entry " + i);
ok("the event ring does not grow without bound", Frunky.health().events.length <= 40);

Frunky.stop();
transport.clear();

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("RESILIENCE_OK");
