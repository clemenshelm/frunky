// The one place that decides what a Frunky trace may contain.
//
// Loaded by the browser as a plain script and by the collector through the same
// file, so client and server cannot disagree about the shape: there is exactly
// one definition, and a field that does not appear here cannot be sent, cannot
// be received, and cannot be stored.
//
// The design rule is that redaction walks the SPEC, never the input. A value
// only reaches the output if a field of that name and type is declared below,
// so "somebody added a field that forwards its input" is not a thing that can
// happen quietly — the new field has to be written here, in the open, next to
// the reasons.
//
// What is deliberately absent, and why:
//
//   position, heading, accuracy   a coordinate is the person; the music engine
//                                 never needed one, only a speed
//   speed as a number             a metre-accurate speed timeline IS a movement
//                                 profile. Ten-km/h buckets answer the only
//                                 question we ask of it ("was the car moving
//                                 when the sound stopped") and are not a route
//   wall-clock time               samples carry milliseconds since the drive
//                                 started. The collector stamps arrival to the
//                                 hour, which is enough to find a report again
//                                 and not enough to time a journey
//   the user agent                reduced to one of five classes in the browser,
//                                 before anything is sent
//   any persistent identifier     the trace id is random and lives for one
//                                 drive. There is no device id, no cookie, no
//                                 account, and therefore nothing to join on
//
// The one field that carries free text is `msgs` — JavaScript error messages,
// which are the single most valuable thing a remote crash report can bring home
// and the only place a page value could in principle echo out. Frunky has no
// text input anywhere, so the exposure is theoretical; it is sanitised anyway,
// because "theoretical" is not a policy: letters and light punctuation only, no
// digits, no URLs, no paths, no addresses, and a hard length cap.
(() => {
  "use strict";

  const VERSION = 1;

  const PLATFORMS = ["tesla", "ios", "android", "desktop", "other"];
  // "" is the honest scene: a sample whose state we could not read is not a
  // cruise, and inventing one would show up as a shape in the viewer
  const SCENES = ["", "standstill", "launch", "thrust", "brake", "cruise", "city", "highway"];
  const GPS_SOURCES = ["none", "coords", "track", "grob"];
  const END_REASONS = ["user", "unload", "error", "timeout"];
  const EVENT_KINDS = [
    "start", "stop", "launch", "freeze", "stall", "rebuild", "resume",
    "jserror", "param", "loadtimeout", "gpserror", "watchdog", "lite", "consent",
  ];
  // The vocabulary an event may add to its kind. An enum rather than a string,
  // so an event can carry a cause without opening a text channel.
  const EVENT_CODES = [
    "", "our-js", "browser-stopped", "hidden", "gc", "mixed", "unknown",
    "timeout", "denied", "unavailable", "nan", "rebuilt", "refused", "failed",
    "on", "off",
  ];

  // 10-km/h buckets, with standstill given its own — the difference between
  // "stopped at a light" and "crawling" is a musical state, not a rounding
  const SPEED_LABELS = ["steht", "2–9", "10–19", "20–29", "30–39", "40–49", "50–59",
    "60–69", "70–79", "80–89", "90–99", "100–109", "110–119", "120+"];
  const TOP_BUCKET = SPEED_LABELS.length - 1;

  function speedBucket(kmh) {
    const v = typeof kmh === "number" && Number.isFinite(kmh) ? kmh : 0;
    if (v < 2) return 0;
    return Math.min(TOP_BUCKET, 1 + Math.floor(v / 10));
  }

  // One of five classes, decided in the browser. The full agent string is never
  // sent: a car's exact firmware build plus a coarse arrival time is a small
  // enough crowd to be worth not collecting.
  function platformClass(ua) {
    const s = typeof ua === "string" ? ua : "";
    if (/Tesla/i.test(s)) return "tesla";
    if (/iPhone|iPad|iPod/i.test(s)) return "ios";
    if (/Android/i.test(s)) return "android";
    if (/Macintosh|Windows|X11|Linux|CrOS/i.test(s)) return "desktop";
    return "other";
  }

  // An allow-list of shapes, not a deny-list of them.
  //
  // The first version of this removed what looked dangerous — URLs, paths,
  // addresses, anything with a digit — and a token shaped like `sk-live-abcdefg`
  // walked straight through it, because it is none of those things. Denying
  // patterns means losing to the pattern nobody thought of, so the rule is
  // inverted: a token survives only if it is an ordinary WORD. Everything that
  // carries information — identifiers, paths, hostnames, keys, numbers — is by
  // construction not one.
  //
  // The cost is real and worth naming: "read-only" and "engine.js" do not
  // survive either, so a message reads a little thinner than the original. The
  // sentence still says what broke, which is what it was wanted for.
  const MSG_MAX = 80;
  const WORD_RE = /^[A-Za-z]+('[A-Za-z]+)?[.,:;)]?$/;
  function sanitizeMessage(s) {
    if (typeof s !== "string") return "";
    return s
      .split(/\s+/)
      .map((t) => t.replace(/^[("'[{]+/, ""))
      .filter((t) => WORD_RE.test(t))
      .join(" ")
      .trim()
      .slice(0, MSG_MAX);
  }

  // ---- the spec -----------------------------------------------------------
  const int = (min, max) => ({ t: "int", min, max });
  const bool = () => ({ t: "bool" });
  // fallback null means: this value is load-bearing, drop the record that holds it
  const oneOf = (values, fallback) => ({ t: "enum", values, fallback });
  const obj = (fields, opt) => ({ t: "obj", fields, optional: !!(opt && opt.optional) });
  const arr = (item, cap) => ({ t: "arr", item, cap });
  const text = () => ({ t: "text" });

  const HOUR_MS = 3600e3;
  const DAY_MS = 24 * HOUR_MS;

  const MAX_SAMPLES = 720;   // one an hour at the 5-second cadence
  const MAX_EVENTS = 200;
  const MAX_MSGS = 8;

  const SAMPLE = obj({
    t: int(0, DAY_MS),
    speed: int(0, TOP_BUCKET),
    scene: oneOf(SCENES, ""),
    load: int(0, 100),
    notes: int(0, 2000),
    strain: int(0, 100),
    late: int(0, 1e6),
    stalls: int(0, 1e5),
    errors: int(0, 1e5),
    resumes: int(0, 1e5),
    fixAge: int(0, 600e3),
    gps: oneOf(GPS_SOURCES, "none"),
    lt: int(0, 600e3),          // long-task milliseconds inside this window
  });

  const EVENT = obj({
    t: int(0, DAY_MS),
    kind: oneOf(EVENT_KINDS, null),   // an event we cannot name is not an event
    n: int(0, 1e7),
    code: oneOf(EVENT_CODES, ""),
  });

  const END = obj({
    t: int(0, DAY_MS),
    reason: oneOf(END_REASONS, "error"),
    freezes: int(0, 1e5),
    worstFreeze: int(0, 600e3),
    maxSpeed: int(0, TOP_BUCKET),
    minNotes: int(0, 2000),
    maxNotes: int(0, 2000),
  }, { optional: true });

  const TRACE = {
    v: { t: "version" },
    id: { t: "id" },
    build: { t: "build" },
    platform: oneOf(PLATFORMS, "other"),
    lite: bool(),
    opts: obj({ curveOutward: bool(), inertiaDepth: bool() }),
    samples: arr(SAMPLE, MAX_SAMPLES),
    events: arr(EVENT, MAX_EVENTS),
    msgs: arr(text(), MAX_MSGS),
    end: END,
  };

  const ID_RE = /^[0-9a-f]{16}$/;
  const BUILD_RE = /^[0-9]{1,4}$/;

  // A sentinel rather than null/undefined, because "this field produced
  // nothing" has to be distinguishable from "this field produced null"
  const NOTHING = Symbol("nothing");

  function coerce(spec, value, dropped, path) {
    switch (spec.t) {
      case "int": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.round(Math.min(spec.max, Math.max(spec.min, n)));
      }
      case "bool":
        return value === true || value === 1 || value === "true";
      case "enum": {
        if (typeof value === "string" && spec.values.includes(value)) return value;
        if (value !== undefined) dropped.push(path);
        return spec.fallback === null ? NOTHING : spec.fallback;
      }
      case "text": {
        const s = sanitizeMessage(value);
        return s;
      }
      case "obj": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return spec.optional ? NOTHING : buildFrom(spec.fields, {}, dropped, path);
        }
        return buildFrom(spec.fields, value, dropped, path);
      }
      case "arr": {
        if (!Array.isArray(value)) return [];
        const out = [];
        for (let i = 0; i < value.length && out.length < spec.cap; i++) {
          const v = coerce(spec.item, value[i], dropped, path);
          if (v !== NOTHING) out.push(v);
        }
        if (value.length > spec.cap) dropped.push(path + ":over-cap");
        return out;
      }
      default:
        return NOTHING;
    }
  }

  // Walks the SPEC, so an input key with no matching field never reaches the
  // output — it is only ever recorded as having been dropped.
  function buildFrom(fields, source, dropped, path) {
    const out = {};
    for (const key of Object.keys(fields)) {
      const v = coerce(fields[key], source[key], dropped, path + "." + key);
      if (v === NOTHING) {
        // a required value we could not read invalidates the whole record
        if (fields[key].t === "enum") return NOTHING;
        continue;
      }
      out[key] = v;
    }
    for (const key of Object.keys(source)) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) {
        dropped.push(path ? path + "." + key : key);
      }
    }
    return out;
  }

  function redactTrace(raw) {
    const dropped = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, trace: null, dropped, reason: "not an object" };
    }
    if (raw.v !== VERSION) return { ok: false, trace: null, dropped, reason: "schema version" };
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) {
      return { ok: false, trace: null, dropped, reason: "id" };
    }

    const trace = { v: VERSION, id: raw.id };
    trace.build = typeof raw.build === "string" && BUILD_RE.test(raw.build) ? raw.build : "0";
    if (raw.build !== undefined && trace.build === "0" && raw.build !== "0") dropped.push("build");

    for (const key of Object.keys(TRACE)) {
      if (key === "v" || key === "id" || key === "build") continue;
      const v = coerce(TRACE[key], raw[key], dropped, key);
      if (v !== NOTHING) trace[key] = v;
    }
    for (const key of Object.keys(raw)) {
      if (!Object.prototype.hasOwnProperty.call(TRACE, key)) dropped.push(key);
    }
    return { ok: true, trace, dropped, reason: "" };
  }

  // Random, 64 bits, one drive long. Not a device id: it is minted when a drive
  // starts and forgotten when it ends, so two drives by the same car cannot be
  // joined — which is the property that keeps this out of "profiling".
  function newTraceId() {
    const bytes = new Uint8Array(8);
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (c && typeof c.getRandomValues === "function") {
      c.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }

  const api = {
    VERSION, PLATFORMS, SCENES, GPS_SOURCES, END_REASONS, EVENT_KINDS, EVENT_CODES,
    SPEED_LABELS, MAX_SAMPLES, MAX_EVENTS, MAX_MSGS, MSG_MAX,
    speedBucket, platformClass, sanitizeMessage, redactTrace, newTraceId,
    // Exported so the privacy sweep can build its input from the SPEC rather
    // than from a hand-written sample. A hand-written sample only ever poisons
    // the fields somebody remembered to put in it, which is precisely the field
    // a newly added leak would not be in.
    SPEC: TRACE,
  };
  if (typeof window !== "undefined") window.FrunkyTraceSchema = api;
  globalThis.FrunkyTraceSchema = api;
})();
