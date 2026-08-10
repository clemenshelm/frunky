// Shared Tone.js + Web Audio stub. Both engine tests install it, so neither
// can drift into testing a different fake than the other.

// ---- native Web Audio stubs (used for one-shot clicks/impacts/swells) ------
const t0 = Date.now();
function param(v = 0, name = "param") {
  const chk = (val) => { if (!Number.isFinite(val)) throw new Error("non-finite param value"); };
  // Real AudioParam automation is a TIMELINE: Tone refuses an event inserted
  // behind the last one and throws "the time must be greater than or equal to
  // the last scheduled time". Two shipped bugs lived in exactly that gap —
  // an automation written on every step with no cancel, on the assumption that
  // step times always increase. They do, until the scheduler falls behind once.
  let lastAt = null;
  const mark = (t) => {
    if (typeof t !== "number" || !Number.isFinite(t)) return;
    if (lastAt !== null && t < lastAt - 1e-9) {
      throw new Error(`${name}: automation at ${t.toFixed(4)} is behind the last ` +
        `scheduled time ${lastAt.toFixed(4)}`);
    }
    lastAt = t;
  };
  // the stub REMEMBERS the last scheduled value: a test that cannot read a
  // gain back cannot tell "silent" from "playing", and silence is exactly the
  // failure mode worth guarding
  const p = {
    value: v,
    setValueAtTime(val, t) { chk(val); mark(t); p.value = val; },
    linearRampToValueAtTime(val, t) { chk(val); mark(t); p.value = val; },
    exponentialRampToValueAtTime(val, t) {
      chk(val);
      if (val <= 0) throw new Error("exp ramp to <= 0: " + val);
      mark(t);
      p.value = val;
    },
    setTargetAtTime(val, t) { chk(val); mark(t); p.value = val; },
    // cancelling reopens the timeline from that point, exactly as it does in
    // the real thing — which is why a cancel is the other valid fix
    cancelScheduledValues(t) {
      if (typeof t === "number" && Number.isFinite(t) && lastAt !== null) {
        lastAt = Math.min(lastAt, t);
      }
    },
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
    this.clockOverride = null; // tests drive the audio clock directly
  }
  get currentTime() {
    return this.clockOverride == null ? (Date.now() - t0) / 1000 : this.clockOverride;
  }
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
// tests flip these to reproduce conditions a laptop never produces
const stubConfig = { loadedHangs: false };
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
    if (key === "loaded") return () => stubConfig.loadedHangs
      ? new Promise(() => {}) : Promise.resolve();
    if (key === "getTransport") return () => transport;
    if (key === "getDestination") return () => toneNode();
    if (key === "getContext") return () => ({ rawContext: fakeCtx });
    if (key === "connect") return () => {};
    if (key === "now") return () => fakeCtx.currentTime;
    return function ToneClass() { return toneNode(); };
  },
});
globalThis.Tone = Tone;

export { Tone, transport, fakeCtx, meter, stubConfig };
