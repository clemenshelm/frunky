// Shared Tone.js + Web Audio stub. Both engine tests install it, so neither
// can drift into testing a different fake than the other.

// ---- native Web Audio stubs (used for one-shot clicks/impacts/swells) ------
const t0 = Date.now();
function param(v = 0) {
  const chk = (val) => { if (!Number.isFinite(val)) throw new Error("non-finite param value"); };
  // the stub REMEMBERS the last scheduled value: a test that cannot read a
  // gain back cannot tell "silent" from "playing", and silence is exactly the
  // failure mode worth guarding
  const p = {
    value: v,
    setValueAtTime(val) { chk(val); p.value = val; },
    linearRampToValueAtTime(val) { chk(val); p.value = val; },
    exponentialRampToValueAtTime(val) {
      chk(val);
      if (val <= 0) throw new Error("exp ramp to <= 0: " + val);
      p.value = val;
    },
    setTargetAtTime(val) { chk(val); p.value = val; },
    cancelScheduledValues() {},
    rampTo(val) { chk(val); p.value = val; },
  };
  return p;
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
let nodeSeq = 0;
// how many notes the arrangement actually fires — a proxy for density that a
// mix-consistency check can read
const meter = { notes: 0 };
function toneNode() {
  const id = ++nodeSeq;
  let lastStart = null;
  const n = {
    connect() { return n; }, chain() { return n; }, fan() { return n; },
    disconnect() {}, dispose() {}, start() { return n; }, stop() { return n; },
    // Real Tone.js REFUSES a voice triggered at or before its previous start
    // time, and the throw lands inside the transport callback — so every voice
    // scheduled after it in that step is simply never played, and the music
    // audibly loses parts and then stops. The old stub accepted anything,
    // which is exactly why a green fuzz run sat next to a broken browser.
    // Every call site here passes velocity last, so the time is args[len-2].
    triggerAttackRelease(...args) {
      for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error("non-finite trigger arg");
      meter.notes++;
      const t = args.length >= 3 ? args[args.length - 2] : null;
      if (typeof t === "number") {
        if (lastStart !== null && t <= lastStart) {
          throw new Error(`node ${id}: start time ${t} must be strictly greater ` +
            `than previous start time ${lastStart}`);
        }
        lastStart = t;
      }
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
  cb: null,
  manual: false, // when set, the test drives the callback itself
  scheduleRepeat(cb) {
    this.cb = cb;
    if (!this.manual) this._timer = setInterval(() => cb(fakeCtx.currentTime), SPB * 1000);
    return 1;
  },
  clear() { if (this._timer) clearInterval(this._timer); this._timer = null; this.cb = null; },
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

export { Tone, transport, fakeCtx, meter };
