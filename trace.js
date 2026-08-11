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
        v: S.VERSION, id, build, platform, ua, engineMajor, lite,
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

  const api = { create, CONSENT_KEY, PENDING_KEY, STORAGE_KEYS };
  if (typeof window !== "undefined") window.FrunkyTrace = api;
  globalThis.FrunkyTrace = api;
})();
