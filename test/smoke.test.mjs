import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// ---- Web Audio stubs -------------------------------------------------------
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
  };
}
function node(extra = {}) {
  return {
    connect(x) { return x; },
    disconnect() {}, start() {}, stop() {},
    gain: param(1), frequency: param(440), detune: param(0), Q: param(1),
    delayTime: param(0), threshold: param(0), ratio: param(1), pan: param(0),
    type: "", buffer: null, loop: false,
    ...extra,
  };
}
class FakeAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.state = "running";
    this.destination = node();
  }
  get currentTime() { return (Date.now() - t0) / 1000; }
  resume() {}
  createGain() { return node(); }
  createOscillator() { return node(); }
  createBiquadFilter() { return node(); }
  createDynamicsCompressor() { return node(); }
  createDelay() { return node(); }
  createBufferSource() { return node(); }
  createStereoPanner() { return node(); }
  createWaveShaper() { return node({ curve: null }); }
  createConvolver() { return node({ buffer: null }); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(Math.min(len, 8)) }; }
}

// ---- DOM stubs -------------------------------------------------------------
const elements = new Map();
const listeners = new Map(); // id -> {type: fn}
function el(id) {
  if (elements.has(id)) return elements.get(id);
  const e = {
    id, value: "0", textContent: "", className: "", disabled: false,
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) {
      if (!listeners.has(id)) listeners.set(id, {});
      listeners.get(id)[type] = fn;
    },
  };
  elements.set(id, e);
  return e;
}
globalThis.window = { AudioContext: FakeAudioContext };
globalThis.document = { getElementById: (id) => el(id), activeElement: null };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);

process.on("uncaughtException", (err) => { console.error("UNCAUGHT:", err); process.exit(1); });

// cycling pseudo-random: successive rolls sweep [0,1) so every pool branch
// (progressions, harmonic rhythms, fills, ghosts, motif) gets exercised
let rc = 0;
Math.random = () => (rc = (rc + 0.377) % 1);

eval(script);

const fire = (id, type = "click") => {
  const fn = listeners.get(id)?.[type];
  if (!fn) throw new Error(`no ${type} listener on #${id}`);
  fn();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set();
const poll = setInterval(() => {
  const s = elements.get("status")?.textContent;
  if (s) seen.add(s);
}, 40);

fire("play");
fire("city");                                         // urban cruise first
await sleep(8000);                                    // thrust ebbs slowly now; give Stadt a window
el("speed").value = "120"; fire("speed", "input");   // accelerate hard
await sleep(2500);
fire("curveR");                                       // lean into a curve
await sleep(1500);
fire("modeDirect");                                   // switch measurement mode
await sleep(500);
fire("modeGps");
fire("brake");                                        // down to standstill
await sleep(8000);                                    // brake ~3.6s + GPS lag + 1.5s arming
el("speed").value = "80"; fire("speed", "input");     // sprint away
await sleep(3000);
fire("autobahn");
await sleep(11000); // long enough to cross a 16-bar section boundary (~29s)
fire("play");                                         // stop
clearInterval(poll);
await sleep(300);

console.log("statuses seen:", [...seen].join(" | "));
const estShown = elements.get("estVal").textContent;
console.log("last engine estimate:", estShown);

const failures = [];
if (![...seen].some((s) => s.startsWith("Stand"))) failures.push("never reached standstill state");
if (![...seen].some((s) => s.includes("geladen"))) failures.push("never armed at standstill");
if (!seen.has("LAUNCH")) failures.push("launch event never fired");
if (!seen.has("Schub")) failures.push("thrust state never reached");
if (!seen.has("Bremsen")) failures.push("braking state never reached");
if (!seen.has("Stadt")) failures.push("urban state never reached");
if (!seen.has("Autobahn-Flow")) failures.push("highway flow state never reached");
if (estShown === "0 km/h") failures.push("engine estimate never moved");

if (failures.length) {
  console.error("FAILURES:", failures);
  process.exit(1);
}
console.log("SMOKE_OK");
process.exit(0);
