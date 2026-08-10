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

  function createReader() {
    let last = null;      // { t, speed, heading }
    let lastPos = null;   // { lat, lon }
    let slope = 0;        // km/h per second, for dead reckoning
    let rawG = 0;         // lateral g at the last fix
    let est = 0, estG = 0;
    let fixes = 0;

    // one fix from the Geolocation API. `speed` is m/s or null, `heading` is
    // degrees or null — both are null often enough that neither can be trusted
    function push(fix) {
      const t = fix.t;
      const pos = { lat: fix.lat, lon: fix.lon };
      let speed = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed * 3.6 : null;
      let heading = Number.isFinite(fix.heading) ? fix.heading : null;
      const dt = last ? (t - last.t) / 1000 : 0;

      // the browser's own speed is the best source; derive it from the track
      // only when the device withholds it
      if (speed == null) {
        speed = lastPos && dt > 0.05
          ? (haversineMeters(lastPos, pos) / dt) * 3.6 : (last ? last.speed : 0);
      }
      speed = clamp(speed, 0, 300);
      // same for course: fall back to the bearing between the last two fixes
      if (heading == null && lastPos && dt > 0.05 && speed > HEADING_FLOOR_KMH) {
        heading = bearingDeg(lastPos, pos);
      }

      if (last && dt > 0.05) {
        slope = clamp((speed - last.speed) / dt, -60, 60);
        rawG = last.heading != null && heading != null && speed > HEADING_FLOOR_KMH
          ? lateralG(speed, headingDelta(last.heading, heading) / dt)
          : 0;
      }
      last = { t, speed, heading };
      lastPos = pos;
      fixes++;
    }

    // called once per animation frame: extrapolate to now, then smooth
    function sample(nowMs, dt) {
      if (!last) return { speed: 0, lateralG: 0 };
      const age = clamp((nowMs - last.t) / 1000, 0, 3);
      const base = clamp(last.speed + slope * age, 0, 300);
      est += (base - est) * (1 - Math.exp(-dt / 0.35));
      estG += (rawG - estG) * (1 - Math.exp(-dt / 0.45));
      return { speed: est, lateralG: estG };
    }

    return { push, sample, fixCount: () => fixes };
  }

  window.FrunkyGeo = { haversineMeters, bearingDeg, headingDelta, lateralG, createReader,
    HEADING_FLOOR_KMH };
})();
