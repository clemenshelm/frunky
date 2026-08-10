// Real-GPS input for the driver page: turns browser Geolocation fixes into the
// {speed, lateralG} picture the music engine wants.
//
// A car browser delivers roughly one fix per second, and the engine runs at 60
// frames per second. Feeding it that staircase directly would read as violent
// acceleration once a second, so the reader does what the simulator's engine
// side has always done: extrapolate along the last known slope (dead
// reckoning), then one-pole smooth. Same treatment, same numbers — which is
// what makes the test bench's "GPS reality" mode a real rehearsal for this.
(() => {
  "use strict";
  const EARTH_R = 6371000;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rad = (d) => (d * Math.PI) / 180;

  function haversineMeters(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // compass bearing a -> b, 0..360, 0 = north
  function bearingDeg(a, b) {
    const dLon = rad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  // signed shortest turn from h1 to h2, -180..180. Right turn = positive.
  // Wrapping matters: 350° -> 10° is a 20° right turn, not 340° left
  function headingDelta(h1, h2) {
    return ((((h2 - h1) % 360) + 540) % 360) - 180;
  }

  // lateral acceleration in g for a car at `speedKmh` turning at `degPerSec`.
  // a = v * omega; a 0.45 g corner is a brisk one, so that is full scale
  const G = 9.80665;
  function lateralG(speedKmh, degPerSec) {
    const v = speedKmh / 3.6;
    return clamp((v * rad(degPerSec)) / G / 0.45, -1, 1);
  }

  // Speed below which heading is noise, not information: a stationary or
  // crawling GPS receiver reports a wandering course, and that would swing the
  // whole mix left and right at a red light
  const HEADING_FLOOR_KMH = 15;
  // A computer has no GPS. It locates over wifi or by IP address, reports no
  // speed at all, and "moves" in jumps of hundreds of metres as the estimate
  // is revised. Three rules keep that from being heard as a drive:
  const ACC_TRUST_M = 25;    // derive speed from the track only at real GPS accuracy
  const MAX_DERIVED_KMH = 200; // a first reading above this is a relocation, not a car
  const MAX_ACCEL_KMH_S = 54;  // ~1.5 g; a Tesla launch is about half of this
  // A car browser is not obliged to deliver at 1 Hz, and the first fixes after a
  // cold start can be seconds apart. 2.5 s was tight enough to call a working
  // receiver dead; 5 s at 100 km/h is 140 m, which is where claiming to know
  // the speed really does become dishonest
  const STALE_S = 5;         // beyond this we no longer claim to know the speed
  const MAX_EXTRAP_S = 1.2;  // how far dead reckoning may run past the last fix

  function createReader() {
    let last = null;      // { t, speed, heading }
    let lastPos = null;   // { lat, lon }
    let slope = 0;        // km/h per second, for dead reckoning
    let rawG = 0;         // lateral g at the last fix
    let pendingDerived = null; // last track-derived speed, accepted or not
    let est = 0, estG = 0;
    let fixes = 0;
    // field-test diagnostics: what the receiver actually gave us, as opposed
    // to what we derived. Whether the Tesla browser reports speed and heading
    // at all is the single biggest unknown of the in-car test
    const stats = { fixes: 0, accuracy: null, intervalMs: null, lastFixAt: null,
      speedSource: "—", headingSource: "—", rejected: 0 };

    // one fix from the Geolocation API. `speed` is m/s or null, `heading` is
    // degrees or null — both are null often enough that neither can be trusted
    function push(fix) {
      const t = fix.t;
      const pos = { lat: fix.lat, lon: fix.lon };
      const reported = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed * 3.6 : null;
      const repHeading = Number.isFinite(fix.heading) ? fix.heading : null;
      const dt = last ? (t - last.t) / 1000 : 0;
      if (last) stats.intervalMs = t - last.t;
      if (Number.isFinite(fix.accuracy)) stats.accuracy = fix.accuracy;
      stats.lastFixAt = t;

      // what the track itself says, independent of what the device claims
      let derived = null, bearing = null;
      if (lastPos && dt > 0.05) {
        const dist = haversineMeters(lastPos, pos);
        derived = (dist / dt) * 3.6;
        if (dist > 1) bearing = bearingDeg(lastPos, pos);
      }

      const prev = last ? last.speed : 0;
      let speed, accepted = true;
      if (reported != null) {
        speed = reported;
        stats.speedSource = "coords";
      } else if (!(Number.isFinite(fix.accuracy) && fix.accuracy <= ACC_TRUST_M)) {
        // the position is a neighbourhood, not a car: the difference between
        // two such guesses is noise, and noise divided by a second is a speed
        speed = 0;
        stats.speedSource = "grob";
      } else if (derived == null) {
        speed = prev;
        stats.speedSource = "track";
      } else {
        stats.speedSource = "track";
        // A relocation and a real launch look identical in one sample, so ask
        // for CORROBORATION: an isolated spike is refused, but two consecutive
        // derivations that agree with each other are a moving car — which is
        // also how a genuine standing start gets through, since its first
        // sample is implausible against a speed of zero by definition
        const sane = derived <= MAX_DERIVED_KMH;
        const plausible = sane && Math.abs(derived - prev) / dt <= MAX_ACCEL_KMH_S;
        const corroborated = sane && pendingDerived != null &&
          Math.abs(derived - pendingDerived) / dt <= MAX_ACCEL_KMH_S;
        if (plausible || corroborated) {
          speed = derived;
        } else {
          speed = prev;
          accepted = false;
          stats.rejected++;
        }
        pendingDerived = derived;
      }
      speed = clamp(speed, 0, 300);

      // course: the device's, or the bearing between the last two fixes
      let heading = repHeading;
      stats.headingSource = repHeading != null ? "coords" : "track";
      if (heading == null && bearing != null && speed > HEADING_FLOOR_KMH) heading = bearing;

      if (last && dt > 0.05) {
        // a refused sample carries no trend: extrapolating along a slope we
        // just called implausible is how a single jump becomes a permanent one
        slope = accepted ? clamp((speed - last.speed) / dt, -60, 60) : 0;
        rawG = last.heading != null && heading != null && speed > HEADING_FLOOR_KMH
          ? lateralG(speed, headingDelta(last.heading, heading) / dt)
          : 0;
      }
      last = { t, speed, heading };
      lastPos = pos;
      fixes++;
      stats.fixes = fixes;
    }

    // called once per animation frame: extrapolate to now, then smooth
    function sample(nowMs, dt) {
      if (!last) return { speed: 0, lateralG: 0 };
      const age = (nowMs - last.t) / 1000;
      // Dead reckoning has a horizon. Past it we are not estimating any more,
      // we are asserting — and an assertion with nothing behind it is how a
      // parked computer ends up frozen at 86 km/h with the highway playing.
      // No fix, no speed: fall back to standstill and say so
      const lost = !isParked() && age > STALE_S;
      const base = lost
        ? 0
        : clamp(last.speed + slope * Math.min(age, MAX_EXTRAP_S), 0, 300);
      const target = lost ? 0 : rawG;
      est += (base - est) * (1 - Math.exp(-dt / 0.35));
      estG += (target - estG) * (1 - Math.exp(-dt / 0.45));
      return { speed: est, lateralG: estG };
    }

    // A parked car produces no new fixes, because nothing moved — the receiver
    // is fine and the position is still true. Calling that a lost signal was
    // wrong twice over, and it dropped the music to a standstill at every red
    // light. Only a stream that goes quiet while we were MOVING is lost.
    // ...and "parked" has to be KNOWN, not merely a zero we invented. A wifi
    // fix too coarse to yield a speed also reads as zero, and that one really
    // is blind — the difference is whether the reading came from the receiver
    const PARKED_KMH = 2;
    const isParked = () =>
      last != null && last.speed <= PARKED_KMH && stats.speedSource !== "grob";
    const isStale = (nowMs) =>
      last == null || (!isParked() && (nowMs - last.t) / 1000 > STALE_S);

    // a snapshot for the field-test overlay; ageMs is measured, not stored,
    // because "how stale is the fix right now" is the question that matters
    function diagnostics(nowMs) {
      return {
        fixes: stats.fixes,
        ageMs: stats.lastFixAt == null ? null : nowMs - stats.lastFixAt,
        intervalMs: stats.intervalMs,
        accuracy: stats.accuracy,
        speedSource: stats.speedSource,
        headingSource: stats.headingSource,
        rejected: stats.rejected,
        stale: isStale(nowMs),
        parked: isParked(),
      };
    }

    return { push, sample, diagnostics, isStale, fixCount: () => fixes };
  }

  // The Geolocation spec allows position.timestamp to be either a Unix epoch
  // value or milliseconds since the page loaded, and browsers genuinely differ.
  // Reading a page-relative timestamp as an epoch one puts every fix decades in
  // the past, so the receiver is declared dead the moment it starts working —
  // which is exactly how a working Tesla reads "no GPS signal" while a phone is
  // fine. When the reported time is not plausibly the same clock as ours, the
  // moment the fix ARRIVED is the honest answer
  const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
  function fixTime(reported, now) {
    return Number.isFinite(reported) && Math.abs(reported - now) < CLOCK_TOLERANCE_MS
      ? reported : now;
  }

  window.FrunkyGeo = { haversineMeters, bearingDeg, headingDelta, lateralG, createReader,
    fixTime, HEADING_FLOOR_KMH, STALE_S };
})();
