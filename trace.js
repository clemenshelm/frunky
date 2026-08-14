// The browser half of Frunky's tracing: it watches a drive and, if — and only
// if — the driver has said yes, sends home a technical picture of it.
//
// Three properties are deliberate and each cost something:
//
// Minimisation happens here, not on the server. Every value is bucketed,
// classified or dropped before it is put on the wire, so the collector never
// receives the thing it would then have to promise not to keep. A server-side
// filter is a promise; not transmitting is a fact.
//
// A failed send is kept and retried, including across a page load. A car drives
// through tunnels, and the drives that end badly are exactly the drives worth
// having — losing them because the network blinked would leave us with a
// dataset of journeys that went fine.
//
// And nothing in here may ever throw into the caller. This runs inside the
// frame loop that produces the music; a diagnostics bug that silences the
// music would be a worse bug than any it could help find. Every entry point is
// wrapped, and the tests drive it with a storage that refuses and a fetch that
// explodes.
(() => {
  "use strict";

  const CONSENT_KEY = "frunky.trace.consent";
  const PENDING_KEY = "frunky.trace.pending";
  // The ids of drives this device has sent. They stay HERE and are never
  // transmitted as a set — they are kept because they are the only handle
  // anyone has on those records, and without them "delete my data" is a
  // sentence rather than a button. Capped, and cleared when the data is.
  const SENT_KEY = "frunky.trace.sent";
  const SENT_MAX = 20;
  const STORAGE_KEYS = [CONSENT_KEY, PENDING_KEY, SENT_KEY];

  function create(config) {
    const S = globalThis.FrunkyTraceSchema;
    const cfg = config || {};
    const endpoint = typeof cfg.endpoint === "string" ? cfg.endpoint : "";
    const build = typeof cfg.build === "string" ? cfg.build : "0";
    const now = typeof cfg.now === "function" ? cfg.now : () => Date.now();
    const doFetch = typeof cfg.fetch === "function" ? cfg.fetch : null;
    const storage = cfg.storage || null;
    const platform = S.platformClass(cfg.userAgent);
    // How weak is this machine? The Tesla's agent string names no vendor at all
    // — plain "Linux Chrome" — so "which car" is unanswerable and "how much
    // machine" is both answerable and the more useful question anyway.
    const posInt = (v, cap) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(cap, Math.round(v)) : 0;
    const hw = posInt(cfg.hardwareConcurrency, 64);
    const mem = posInt(cfg.deviceMemory, 128);
    // reduced here, once, at the only place that ever sees the raw string
    const ua = S.uaTokens(cfg.userAgent);
    const engineMajor = S.engineMajor(cfg.userAgent);

    // storage is a courtesy, not a dependency: Safari in private mode throws on
    // every call, and a driver whose browser refuses it still gets music
    const read = (k) => { try { return storage ? storage.getItem(k) : null; } catch (err) { void err; return null; } };
    const write = (k, v) => { try { if (storage) storage.setItem(k, v); } catch (err) { void err; } };
    const erase = (k) => { try { if (storage) storage.removeItem(k); } catch (err) { void err; } };

    let consentState = null;
    const raw = read(CONSENT_KEY);
    if (raw === "1") consentState = true;
    else if (raw === "0") consentState = false;

    let id = null;
    let startedAt = 0;
    let samples = [];
    let events = [];
    let msgs = [];
    let ended = null;
    let opts = { curveOutward: true, inertiaDepth: true };
    let lite = false;
    let stride = 1, seen = 0;
    let pendingSnap = null;
    const sessionSent = new Set();

    const enabled = () => consentState === true && !!endpoint && !!doFetch;

    // ---- what this device sent ---------------------------------------------
    const ID_RE = /^[0-9a-f]{16}$/;
    function storedSent() {
      try {
        const raw = read(SENT_KEY);
        if (!raw) return [];
        const a = JSON.parse(raw);
        return Array.isArray(a) ? a.filter((x) => typeof x === "string" && ID_RE.test(x)) : [];
      } catch (err) { void err; return []; }
    }
    // storage may be absent or refuse; the session set is what keeps erasure
    // working for the drive currently in progress in that case
    const sent = () => [...new Set([...storedSent(), ...sessionSent])];
    function rememberSent(traceId) {
      sessionSent.add(traceId);
      // the in-memory half needs the same cap as the stored one, or a device
      // that drives all day keeps every id it ever sent for as long as the tab
      // is open — which is the unbounded identifier list the cap exists to stop
      while (sessionSent.size > SENT_MAX) sessionSent.delete(sessionSent.values().next().value);
      const a = storedSent().filter((x) => x !== traceId);
      a.push(traceId);
      while (a.length > SENT_MAX) a.shift();
      write(SENT_KEY, JSON.stringify(a));
    }
    function forgetSent(traceId) {
      sessionSent.delete(traceId);
      const a = storedSent().filter((x) => x !== traceId);
      if (a.length) write(SENT_KEY, JSON.stringify(a));
      else erase(SENT_KEY);
    }

    // ---- the buffer ---------------------------------------------------------
    // A drive longer than the cap thins instead of stopping. Truncating would
    // answer "did the music survive the whole drive?" with silence, at exactly
    // the point where the answer becomes interesting.
    function pushSample(s) {
      seen++;
      if (seen % stride !== 0) return;
      samples.push(s);
      if (samples.length >= S.MAX_SAMPLES) {
        samples = samples.filter((_, i) => i % 2 === 0);
        stride *= 2;
      }
    }

    function reset() {
      samples = []; events = []; msgs = []; ended = null;
      stride = 1; seen = 0;
    }

    // ---- the public surface -------------------------------------------------
    function begin(options) {
      try {
        if (!enabled()) { id = null; return null; }
        id = S.newTraceId();
        startedAt = now();
        reset();
        if (options) {
          lite = !!options.lite;
          if (options.opts) {
            opts = { curveOutward: !!options.opts.curveOutward,
              inertiaDepth: !!options.opts.inertiaDepth };
          }
        }
        return id;
      } catch (err) { void err; return null; }
    }

    function sample(state) {
      try {
        if (!enabled() || !id || !state) return;
        const n = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : (d || 0));
        // a probe value: non-negative numbers pass, everything else is "no probe"
        const probe = (v) =>
          typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : -1;
        pushSample({
          t: now() - startedAt,
          speed: S.speedBucket(state.speed),
          scene: typeof state.scene === "string" ? state.scene : "",
          load: Math.round(n(state.load) * 100),
          notes: Math.round(n(state.notes)),
          strain: Math.round(n(state.strain) * 100),
          late: Math.round(n(state.late)),
          stalls: Math.round(n(state.stalls)),
          errors: Math.round(n(state.errors)),
          resumes: Math.round(n(state.resumes)),
          fixAge: Math.round(n(state.fixAge)),
          gps: typeof state.gps === "string" ? state.gps : "none",
          lt: Math.round(n(state.lt)),
          // a suspended context is silence with a healthy sequencer behind it,
          // which is exactly what "it got stuck" has looked like all along
          audio: typeof state.audio === "string" ? state.audio : "",
          // the render thread's own account: the engine reports 0..1 (or -1
          // where the browser has no probe), the wire carries a percent —
          // and "not measured" must never be mistaken for "idle"
          rload: typeof state.rload === "number" && Number.isFinite(state.rload) &&
            state.rload >= 0 ? Math.round(state.rload * 100) : -1,
          under: Math.round(n(state.under)),
          // growth diagnostics: a leak's signature is a monotonic climb
          // across the drive — "not measured" stays distinct from "zero"
          heap: typeof state.heap === "number" && Number.isFinite(state.heap) &&
            state.heap >= 0 ? Math.round(state.heap) : -1,
          voices: Math.round(n(state.voices)),
          // the audibility layers: output RMS and the automated gain
          // positions. -1 = "no probe", which must never read as "parked"
          out: probe(state.out), gm: probe(state.gm), gd: probe(state.gd),
          gh: probe(state.gh), gdr: probe(state.gdr), air: probe(state.air),
          // the drift watch (build 68): output-clock glitch episodes, worst
          // stall ms, and the path's learned jitter — the hiccup layer no
          // other counter here can see
          gl: probe(state.gl), gx: probe(state.gx), aj: probe(state.aj),
          // which recipe frames the current piece (build 69) — the index a
          // thumb event is read against. -1 = no piece yet
          rcp: probe(state.rcp),
          // build 70: which output path actually played (snk), and the
          // render-thread pulse (pg episodes / px worst ms) — the layer the
          // extrapolated audio clock cannot see
          snk: probe(state.snk), pg: probe(state.pg), px: probe(state.px),
        });
      } catch (err) { void err; }
    }

    function event(kind, code, n) {
      try {
        if (!enabled() || !id) return;
        if (events.length >= S.MAX_EVENTS) return;
        events.push({ t: now() - startedAt, kind, code: code || "",
          n: typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0 });
      } catch (err) { void err; }
    }

    function message(text) {
      try {
        if (!enabled() || !id) return;
        const clean = S.sanitizeMessage(text);
        if (!clean) return;
        if (msgs.includes(clean)) return;      // the same error 400 times is one fact
        if (msgs.length >= S.MAX_MSGS) return;
        msgs.push(clean);
      } catch (err) { void err; }
    }

    function end(reason) {
      try {
        if (!enabled() || !id) return;
        let freezes = 0, worstFreeze = 0;
        for (const e of events) {
          if (e.kind === "freeze") { freezes++; worstFreeze = Math.max(worstFreeze, e.n); }
        }
        let maxSpeed = 0, minNotes = samples.length ? Infinity : 0, maxNotes = 0;
        for (const s of samples) {
          maxSpeed = Math.max(maxSpeed, s.speed);
          minNotes = Math.min(minNotes, s.notes);
          maxNotes = Math.max(maxNotes, s.notes);
        }
        ended = {
          t: now() - startedAt,
          reason: typeof reason === "string" ? reason : "error",
          freezes, worstFreeze, maxSpeed,
          minNotes: Number.isFinite(minNotes) ? minNotes : 0,
          maxNotes,
        };
      } catch (err) { void err; }
    }

    // What actually goes on the wire — built from the schema's own vocabulary
    // and then run through the schema's redactor, so "the client sends only
    // what the schema allows" is enforced by the same code the server uses
    // rather than by this file agreeing with it.
    function snapshot() {
      if (!id) return null;
      const draft = {
        v: S.VERSION, id, build, platform, ua, engineMajor, hw, mem, lite,
        opts: { curveOutward: !!opts.curveOutward, inertiaDepth: !!opts.inertiaDepth },
        samples, events, msgs,
      };
      if (ended) draft.end = ended;
      const r = S.redactTrace(draft);
      return r.ok ? r.trace : null;
    }

    async function post(snap) {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
        // a page being unloaded still delivers a keepalive request; without it
        // the drive that ended by closing the tab is the one we never see
        keepalive: true,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
      return !!(res && res.ok);
    }

    async function flush() {
      let snap = null;
      try {
        if (!enabled()) return false;
        snap = pendingSnap || snapshot();
        if (!snap) return false;
        write(PENDING_KEY, JSON.stringify(snap));
        const okSent = await post(snap);
        if (!okSent) { pendingSnap = snap; return false; }
        pendingSnap = null;
        rememberSent(snap.id);
        erase(PENDING_KEY);
        return true;
      } catch (err) {
        // A throw here is a network that is not there, and the whole point of
        // the pending slot is that such a drive is not lost. Keeping `snap` out
        // of the try is what makes the retry real rather than nominal.
        void err;
        pendingSnap = snap;
        return false;
      }
    }

    // Called once at page load: a drive that ended in a crash or a tunnel left
    // its snapshot behind, and this is the only chance it ever gets.
    async function recover() {
      try {
        if (!enabled()) return false;
        const held = read(PENDING_KEY);
        if (!held) return false;
        const parsed = JSON.parse(held);
        const r = S.redactTrace(parsed);
        if (!r.ok) { erase(PENDING_KEY); return false; }
        const okSent = await post(r.trace);
        if (!okSent) return false;
        rememberSent(r.trace.id);
        erase(PENDING_KEY);
        return true;
      } catch (err) { void err; return false; }
    }

    // Erasure. Every drive this device delivered is asked to be deleted, one
    // request per id — the collector needs no account to authorise that, because
    // the id IS the only handle on the record and whoever holds it is the only
    // person who ever had it.
    //
    // An id is forgotten only once its deletion was actually acknowledged. A
    // network that refused leaves it on the device, so the next attempt can
    // finish the job instead of the record becoming unreachable forever.
    async function eraseAll() {
      let done = 0;
      try {
        const ids = sent();
        if (id) ids.push(id);
        if (!endpoint || !doFetch) return 0;
        for (const one of [...new Set(ids)]) {
          try {
            const res = await doFetch(endpoint + "/" + encodeURIComponent(one), {
              method: "DELETE", mode: "cors", credentials: "omit", cache: "no-store",
            });
            if (res && res.ok === false) continue;
            forgetSent(one);
            done++;
          } catch (err) { void err; }
        }
        return done;
      } catch (err) { void err; return done; }
    }

    // Withdrawal has to reach what was already sent, or it is not withdrawal.
    // Note the order: consent goes off FIRST and unconditionally. Whether the
    // deletion request got through is a separate question from whether we are
    // still allowed to collect, and tying them together would leave a driver
    // who said no, on a bad connection, still being traced.
    async function setConsent(value) {
      try {
        const next = value === true;
        consentState = next;
        write(CONSENT_KEY, next ? "1" : "0");
        if (next) return false;
        pendingSnap = null;
        reset();
        erase(PENDING_KEY);
        const erased = await eraseAll();
        id = null;
        return erased > 0;
      } catch (err) { void err; id = null; return false; }
    }

    return {
      consent: () => consentState,
      setConsent,
      enabled,
      begin, sample, event, message, end, flush, recover, snapshot,
      sent, eraseAll,
      id: () => id,
      pending: () => pendingSnap !== null,
      __storageKeys: () => STORAGE_KEYS.slice(),
    };
  }

  // The silence watchdog: turns "the engine schedules notes but the master
  // output carries no signal" from 200 samples a human must read into ONE
  // event with a duration. A pure decision so it can be tested without a
  // browser. Musical silence is not a failure: it only watches stretches
  // where notes ARE being scheduled (a coda fade or a stopped engine stands
  // it down), and a browser without the output probe (out = -1) can never
  // arm it. Fires "on" once per episode after `armMs`, and "off" with the
  // episode's total duration when signal returns.
  function makeSilenceWatch(armMs) {
    const arm = typeof armMs === "number" && Number.isFinite(armMs) && armMs > 0
      ? armMs : 10000;
    let since = null;   // when the current silent-while-scheduling stretch began
    let fired = false;
    return (t, out, notes) => {
      try {
        const silent = typeof out === "number" && out >= 0 && out < 2 &&
          typeof notes === "number" && notes > 0;
        if (!silent) {
          if (fired) { const dur = t - since; since = null; fired = false;
            return { code: "off", n: dur }; }
          since = null;
          return null;
        }
        if (since === null) since = t;
        if (!fired && t - since >= arm) { fired = true; return { code: "on", n: t - since }; }
        return null;
      } catch (err) { void err; return null; }
    };
  }

  // ---- the drift watch (build 68) ------------------------------------------
  // The hiccup detector. A 262 s phone drive with audible hiccups recorded a
  // spotless trace — late 0, stalls 0, under 0 — because the phone's Chrome
  // has no RenderCapacity API, and the hiccup layer (render/output) was
  // therefore invisible. What every browser CAN say is how the audio clock
  // moves against the wall clock: when the output stalls, the audio clock
  // falls behind by exactly the audible gap.
  // Fed every ~250 ms with (wallMs, audioSec). It first LEARNS the device's
  // natural jitter (burst rendering makes drift oscillate; a fixed threshold
  // would false-fire on exactly the bursty Bluetooth paths this exists for),
  // then counts drift jumps past the learned threshold as glitch episodes.
  // read() → { gl: episodes (cumulative), gx: worst excess ms, aj: learned
  // jitter ms } — aj is -1 until the first calibration, per the trace contract.
  function makeDriftWatch() {
    const CAL = 20, WIN = 8;
    const win = [];
    let fed = 0, thr = 0, ajMs = -1;
    let inGlitch = false, gl = 0, gx = 0;
    let lastWall = -1;
    function feed(wallMs, audioSec) {
      try {
        if (typeof wallMs !== "number" || !Number.isFinite(wallMs)) return;
        if (typeof audioSec !== "number" || !Number.isFinite(audioSec)) return;
        // a feed gap means the clock legitimately stood still (suspend,
        // hidden tab): recalibrate instead of counting a phantom glitch
        if (lastWall >= 0 && wallMs - lastWall > 1000) {
          win.length = 0; fed = 0; thr = 0; inGlitch = false;
        }
        lastWall = wallMs;
        const d = wallMs / 1000 - audioSec;
        if (fed < CAL) {
          win.push(d); if (win.length > CAL) win.shift();
          fed++;
          if (fed === CAL) {
            const j = Math.max(...win) - Math.min(...win);
            thr = Math.max(0.05, j * 2);
            // the learned jitter characterises the output path itself and is
            // recorded once, from the first (clean-boot) calibration
            if (ajMs < 0) ajMs = Math.round(j * 1000);
            while (win.length > WIN) win.shift();
          }
          return;
        }
        // baseline = the recent windowed minimum: slow clock-rate wander
        // follows it, a real stall jumps past it within one feed
        const base = Math.min(...win);
        const excess = d - base;
        if (excess > thr) {
          if (!inGlitch) { inGlitch = true; gl++; }
          const ms = Math.round(excess * 1000);
          if (ms > gx) gx = ms;
        } else if (excess < thr / 2) {
          inGlitch = false;
        }
        win.push(d); if (win.length > WIN) win.shift();
      } catch (err) { void err; }
    }
    feed.read = () => ({ gl, gx, aj: ajMs });
    return feed;
  }

  // The pulse watch (build 70). The drift watch above came back CLEAN on the
  // very drive that stuttered (376 s, build 68: gl 0, aj 53) — and that is
  // not an acquittal, because Chrome's audio clock is EXTRAPOLATED: it keeps
  // advancing smoothly across render-thread stalls, which is exactly the
  // audible layer on a phone whose Chrome has no RenderCapacity. This watch
  // is fed wall-clock stamps taken INSIDE the render thread (an AudioWorklet
  // posts Date.now() every ~0.5 s of rendered audio): a stalled render
  // thread cannot stamp, so the gap between stamps IS the audible gap —
  // immune to main-thread jank, because a queued message carries the stamp
  // it was made with, not the time it arrived.
  function makePulseWatch() {
    const NOMINAL = 500;   // the worklet's stamping cadence, ms of audio time
    const THR = 1500;      // a gap beyond this is a stall, not scheduling jitter
    let last = -1, pg = 0, px = 0;
    function feed(stampMs) {
      try {
        if (typeof stampMs !== "number" || !Number.isFinite(stampMs)) return;
        if (last >= 0) {
          const gap = stampMs - last;
          if (gap > THR) {
            pg++;
            const ex = Math.round(gap - NOMINAL);
            if (ex > px) px = ex;
          }
        }
        last = stampMs;
      } catch (err) { void err; }
    }
    feed.read = () => ({ pg, px });
    // a suspend/resume is a legitimate silence, not a stall: reset forgives
    // the NEXT gap while the episode ledger stands
    feed.reset = () => { last = -1; };
    return feed;
  }

  const api = { create, CONSENT_KEY, PENDING_KEY, STORAGE_KEYS, makeSilenceWatch,
    makeDriftWatch, makePulseWatch };
  if (typeof window !== "undefined") window.FrunkyTrace = api;
  globalThis.FrunkyTrace = api;
})();
