// Drives the real engine module through its public API with a synthetic
// drive — the same script the bench page's buttons produce, minus the DOM.
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");

// ---- native Web Audio stubs (used for one-shot clicks/impacts/swells) ------
const t0 = Date.now();
function param(v = 0) {
  const chk = (val) => { if (!Number.isFinite(val)) throw new Error("non-finite param value"); };
  return {
    value: v,
    setValueAtTime: chk,
    linearRampToValueAtTime: chk,
    exponentialRampToValueAtTime(val) {
      chk(val);
      if (val <= 0) throw new Error("exp ramp to <= 0: " + val);
    },
    setTargetAtTime: chk,
    cancelScheduledValues() {},
    rampTo: chk,
  };
}
function rawNode(extra = {}) {
  return {
    connect(x) { return x; },
    disconnect() {}, start() {}, stop() {},
    gain: param(1), frequency: param(440), detune: param(0), Q: param(1),
    type: "", buffer: null, loop: false,
    ...extra,
  };
}
class FakeAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.state = "running";
    this.destination = rawNode();
  }
  get currentTime() { return (Date.now() - t0) / 1000; }
  resume() {}
  createGain() { return rawNode(); }
  createOscillator() { return rawNode(); }
  createBiquadFilter() { return rawNode(); }
  createBufferSource() { return rawNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(Math.min(len, 8)) }; }
}
const fakeCtx = new FakeAudioContext();

// ---- Tone.js stub ----------------------------------------------------------
// Generic chainable nodes; a working Transport that actually drives the
// 16th-note callback so the sequencer and phase machine really run.
function toneNode() {
  const n = {
    connect() { return n; }, chain() { return n; }, fan() { return n; },
    disconnect() {}, dispose() {}, start() { return n; }, stop() { return n; },
    triggerAttackRelease(...args) {
      for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error("non-finite trigger arg");
    },
    triggerAttack() {}, triggerRelease() {}, releaseAll() {},
    ready: Promise.resolve(),
    gain: param(1), frequency: param(440), Q: param(1), pan: param(0),
    volume: param(0), feedback: param(0), delayTime: param(0), wet: param(1),
    detune: param(0), amplitude: param(1),
    loaded: true,
  };
  return n;
}
const SPB = 60 / 132 / 4;
const transport = {
  bpm: param(132),
  swing: 0,
  swingSubdivision: "16n",
  _timer: null,
  scheduleRepeat(cb) {
    this._timer = setInterval(() => cb(fakeCtx.currentTime), SPB * 1000);
    return 1;
  },
  clear() { if (this._timer) clearInterval(this._timer); this._timer = null; },
  cancel() {},
  start() {}, stop() { this.clear(); }, pause() {},
};
const Tone = new Proxy({}, {
  get(_, key) {
    if (key === "start") return async () => {};
    if (key === "loaded") return async () => {};
    if (key === "getTransport") return () => transport;
    if (key === "getDestination") return () => toneNode();
    if (key === "getContext") return () => ({ rawContext: fakeCtx });
    if (key === "connect") return () => {};
    if (key === "now") return () => fakeCtx.currentTime;
    return function ToneClass() { return toneNode(); };
  },
});
globalThis.Tone = Tone;
// ---- host stubs --------------------------------------------------------------
// engine.js touches no DOM at all — it only needs somewhere to publish itself
globalThis.window = { Tone };

process.on("uncaughtException", (err) => { console.error("UNCAUGHT:", err); process.exit(1); });
process.on("unhandledRejection", (err) => { console.error("UNHANDLED:", err); process.exit(1); });

// cycling pseudo-random: successive rolls sweep [0,1) so every pool branch
// (progressions, harmonic rhythms, fills, ghosts, chord styles) gets exercised
let rc = 0;
Math.random = () => (rc = (rc + 0.377) % 1);

eval(script);

const Frunky = globalThis.window.Frunky;
if (!Frunky) { console.error("engine.js published no window.Frunky"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the synthetic drive -----------------------------------------------------
// A 60 Hz loop integrates toward a target speed and feeds the engine, exactly
// as the driver page's frame loop does with real GPS.
let speed = 0, target = 0, accel = 20, lat = 0;
const seen = new Set();
let lastDesc = null, maxSpeedSeen = 0;
let prev = Date.now();
const loop = setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  const d = target - speed, stepSize = accel * dt;
  speed = Math.abs(d) <= stepSize ? target : speed + Math.sign(d) * stepSize;
  Frunky.update(dt, { speed, lateralG: lat });
  if (Frunky.isRunning()) {
    seen.add(Frunky.status().text);
    const desc = Frunky.describe();
    if (desc) lastDesc = desc;
    maxSpeedSeen = Math.max(maxSpeedSeen, speed);
  }
}, 16);

const driveTo = (v, a) => { target = v; accel = a; };

await Frunky.start();
await sleep(3000);                    // standstill: 1.5 s of stillness arms the launch
driveTo(45, 26);                      // the sprint away from the light
await sleep(3000);
driveTo(45, 26);
await sleep(8000);                    // hold city speed: urban groove
driveTo(130, 16);                     // out onto the highway
await sleep(6000);
lat = 0.7;                            // lean into a long curve
await sleep(2000);
lat = 0;
await sleep(11000);                   // long enough to cross a 16-bar boundary
driveTo(0, 28);                       // brake all the way down
await sleep(6000);
Frunky.stop();
clearInterval(loop);
await sleep(300);

console.log("statuses seen:", [...seen].join(" | "));
console.log("peak speed fed:", Math.round(maxSpeedSeen), "km/h");
if (lastDesc) {
  console.log("last arrangement:", lastDesc.form.join(" "),
    "· Stück", lastDesc.num, "·", lastDesc.partName, "· Takt", lastDesc.bar + "/16");
  console.log("last chips:", lastDesc.chips.map(([k, v]) => k + " " + v).join(" | "));
}

const failures = [];
const chipKeys = lastDesc ? lastDesc.chips.map(([k]) => k) : [];
if (![...seen].some((s) => s.startsWith("Stand"))) failures.push("never reached standstill state");
if (![...seen].some((s) => s.includes("geladen"))) failures.push("never armed at standstill");
if (!seen.has("LAUNCH")) failures.push("launch event never fired");
if (!seen.has("Schub")) failures.push("thrust state never reached");
if (!seen.has("Bremsen")) failures.push("braking state never reached");
if (!seen.has("Stadt")) failures.push("urban state never reached");
if (!seen.has("Autobahn-Flow")) failures.push("highway flow state never reached");
if (!lastDesc) failures.push("engine never described a piece");
if (!chipKeys.includes("Akkorde")) failures.push("arrangement chips never rendered");
if (!chipKeys.includes("Key")) failures.push("per-piece key chip never rendered");
if (Frunky.isRunning()) failures.push("engine still running after stop()");

if (failures.length) {
  console.error("FAILURES:", failures);
  process.exit(1);
}
console.log("SMOKE_OK");
process.exit(0);
