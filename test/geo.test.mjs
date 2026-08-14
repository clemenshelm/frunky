// The GPS reader is the one part of the car path the simulator cannot rehearse:
// the bench synthesises a degraded signal, but only real fixes carry null
// speeds, null headings and the 360°/0° seam. So it gets its own tests.
import { readFileSync } from "node:fs";

globalThis.window = {};
eval(readFileSync(new URL("../geo.js", import.meta.url), "utf8"));
const Geo = globalThis.window.FrunkyGeo;

const failures = [];
const near = (label, got, want, tol) => {
  if (!Number.isFinite(got) || Math.abs(got - want) > tol) {
    failures.push(`${label}: got ${got}, wanted ${want} ±${tol}`);
  }
};
const ok = (label, cond) => { if (!cond) failures.push(label); };

// ---- heading arithmetic: the seam is where naive subtraction breaks ---------
near("headingDelta 350->10 is a small right turn", Geo.headingDelta(350, 10), 20, 0.001);
near("headingDelta 10->350 is a small left turn", Geo.headingDelta(10, 350), -20, 0.001);
near("headingDelta 90->180 turns right", Geo.headingDelta(90, 180), 90, 0.001);
near("headingDelta no turn", Geo.headingDelta(42, 42), 0, 0.001);

// ---- distance ---------------------------------------------------------------
near("one degree of latitude", Geo.haversineMeters({ lat: 48, lon: 11 }, { lat: 49, lon: 11 }),
  111195, 200);
near("same point is zero", Geo.haversineMeters({ lat: 48, lon: 11 }, { lat: 48, lon: 11 }), 0, 0.001);

// ---- bearing ----------------------------------------------------------------
near("due north", Geo.bearingDeg({ lat: 48, lon: 11 }, { lat: 48.01, lon: 11 }), 0, 0.5);
near("due east", Geo.bearingDeg({ lat: 48, lon: 11 }, { lat: 48, lon: 11.01 }), 90, 0.5);

// ---- lateral g --------------------------------------------------------------
// 50 km/h through 5°/s is 13.9 m/s × 0.0873 rad/s = 1.21 m/s² = 0.124 g,
// and full scale is a 0.45 g corner
near("gentle corner", Geo.lateralG(50, 5), 0.275, 0.01);
ok("a right turn is positive", Geo.lateralG(50, 5) > 0);
ok("a left turn is negative", Geo.lateralG(50, -5) < 0);
ok("hard corners clamp to full scale", Geo.lateralG(200, 30) === 1);
ok("standing still has no lateral force", Geo.lateralG(0, 30) === 0);

// ---- the reader: real fixes, with the fields browsers withhold --------------
{
  const r = Geo.createReader();
  const t0 = 1_000_000;
  // a browser that reports speed directly (m/s)
  r.push({ lat: 48, lon: 11, speed: 10, heading: 90, t: t0 });
  r.push({ lat: 48, lon: 11.0001, speed: 20, heading: 90, t: t0 + 1000 });
  // dead reckoning: half a second past the last fix, the estimate must have
  // moved PAST it along the slope, not sat on it
  let s = { speed: 0 };
  for (let i = 0; i < 30; i++) s = r.sample(t0 + 1000 + i * 16, 0.016);
  ok("speed follows the fix", s.speed > 30 && s.speed < 90);
  ok("no phantom cornering on a straight line", Math.abs(s.lateralG) < 0.01);
}
{
  // a browser that withholds speed and heading: both must be derived
  const r = Geo.createReader();
  const t0 = 2_000_000;
  // a track curving east at ~0.0003° of latitude per second ≈ 33 m/s ≈ 120 km/h.
  // Two headings are needed before a turn rate exists at all, so this needs
  // more than a couple of fixes — as a real curve does
  let lat = 48, lon = 11, hdg = 0;
  const STEP_M = 33.4;                 // per second ≈ 120 km/h
  for (let i = 0; i <= 6; i++) {
    r.push({ lat, lon, speed: null, heading: null, accuracy: 8, t: t0 + i * 1000 });
    const h = (hdg * Math.PI) / 180;
    lat += (STEP_M * Math.cos(h)) / 111320;
    lon += (STEP_M * Math.sin(h)) / (111320 * Math.cos((lat * Math.PI) / 180));
    hdg += 6;                          // a steady 6°/s bend
  }
  // stay inside the staleness horizon: past it the reader is SUPPOSED to
  // stop claiming a speed, which is a different assertion (below)
  let s = { speed: 0, lateralG: 0 };
  for (let i = 0; i < 120; i++) s = r.sample(t0 + 6000 + i * 16, 0.016);
  near("speed derived from the track", s.speed, 120, 30);
  ok("cornering derived from the track", Math.abs(s.lateralG) > 0.001);
}
{
  // at a red light the receiver's course wanders; that must not swing the mix
  const r = Geo.createReader();
  const t0 = 3_000_000;
  r.push({ lat: 48, lon: 11, speed: 0.2, heading: 10, t: t0 });
  r.push({ lat: 48, lon: 11, speed: 0.1, heading: 200, t: t0 + 1000 });
  r.push({ lat: 48, lon: 11, speed: 0.3, heading: 40, t: t0 + 2000 });
  let s = { speed: 0, lateralG: 0 };
  for (let i = 0; i < 100; i++) s = r.sample(t0 + 2000 + i * 16, 0.016);
  ok("standstill stays quiet", s.speed < 3);
  ok("wandering course at standstill is ignored", Math.abs(s.lateralG) < 0.01);
}
{
  // no fix yet: the page must still be able to run a frame loop
  const r = Geo.createReader();
  const s = r.sample(Date.now(), 0.016);
  ok("no fix reads as standing still", s.speed === 0 && s.lateralG === 0);
  ok("fix count starts at zero", r.fixCount() === 0);
}

// ---- the desktop trap -------------------------------------------------------
// A computer has no GPS. It locates over wifi, reports no speed at all, and
// relocates in jumps of hundreds of metres. Read as motion, one such jump is a
// launch to highway speed — and since no further fix ever arrives, the
// extrapolated speed then stays there forever. Sitting still must read as
// sitting still.
{
  const r = Geo.createReader();
  const t0 = 5_000_000;
  // a wifi fix, then the same spot re-estimated 300 m away, then silence
  r.push({ lat: 48, lon: 11, speed: null, heading: null, accuracy: 35, t: t0 });
  r.push({ lat: 48.0027, lon: 11, speed: null, heading: null, accuracy: 35, t: t0 + 1000 });
  let s = { speed: 0 };
  for (let i = 0; i < 60; i++) s = r.sample(t0 + 1000 + i * 16, 0.016);
  ok("a relocation jump is not acceleration", s.speed < 25);
  // ten seconds of silence: the reader must not still be claiming a speed
  for (let i = 0; i < 700; i++) s = r.sample(t0 + 1000 + i * 16, 0.016);
  ok("a speed with no fix behind it decays away", s.speed < 2);
  ok("a stale stream is reported as stale", r.diagnostics(t0 + 12000).stale === true);
}
{
  // IP-level accuracy: the position is a city, not a car. Deriving a speed
  // from the difference between two such guesses is noise with a unit
  const r = Geo.createReader();
  const t0 = 6_000_000;
  r.push({ lat: 48, lon: 11, speed: null, heading: null, accuracy: 3000, t: t0 });
  r.push({ lat: 48.004, lon: 11.004, speed: null, heading: null, accuracy: 3000, t: t0 + 1000 });
  let s = { speed: 0 };
  for (let i = 0; i < 60; i++) s = r.sample(t0 + 1000 + i * 16, 0.016);
  ok("coarse fixes produce no speed", s.speed < 2);
  ok("coarse fixes are named as such", r.diagnostics(t0 + 1000).speedSource === "grob");
}
{
  // the real car case must keep working: good accuracy, a real reported speed,
  // fixes arriving about once a second
  const r = Geo.createReader();
  const t0 = 7_000_000;
  for (let i = 0; i <= 5; i++) {
    r.push({ lat: 48 + i * 0.0003, lon: 11, speed: 25 + i, heading: 0, accuracy: 6,
      t: t0 + i * 1000 });
  }
  let s = { speed: 0 };
  for (let i = 0; i < 60; i++) s = r.sample(t0 + 5000 + i * 16, 0.016);
  near("a real drive still tracks", s.speed, 108, 12);
  ok("a live stream is not stale", r.diagnostics(t0 + 5200).stale === false);
}

// ---- field-test diagnostics -------------------------------------------------
// The in-car test's real question is whether this browser reports speed and
// heading at all; a reader that cannot say so leaves the trip unevaluable
{
  const r = Geo.createReader();
  const t0 = 4_000_000;
  let d = r.diagnostics(t0);
  ok("no fixes yet reports no age", d.fixes === 0 && d.ageMs === null);
  r.push({ lat: 48, lon: 11, speed: 12, heading: 90, accuracy: 8, t: t0 });
  r.push({ lat: 48.001, lon: 11, speed: 13, heading: 92, accuracy: 5, t: t0 + 1000 });
  d = r.diagnostics(t0 + 1400);
  ok("counts fixes", d.fixes === 2);
  near("reports fix age", d.ageMs, 400, 1);
  near("reports the measured update interval", d.intervalMs, 1000, 1);
  near("reports accuracy", d.accuracy, 5, 0.001);
  ok("names the receiver as the speed source", d.speedSource === "coords");
  ok("names the receiver as the heading source", d.headingSource === "coords");

  const r2 = Geo.createReader();
  r2.push({ lat: 48, lon: 11, speed: null, heading: null, accuracy: 8, t: t0 });
  r2.push({ lat: 48.001, lon: 11, speed: null, heading: null, accuracy: 8, t: t0 + 1000 });
  const d2 = r2.diagnostics(t0 + 1000);
  ok("names the track as the speed source when the browser withholds it",
    d2.speedSource === "track");
  ok("names the track as the heading source when the browser withholds it",
    d2.headingSource === "track");
}

// ---- the receiver lies too (build 74) ---------------------------------------
// The derived path always asked for corroboration; the REPORTED path was
// trusted raw. But Android's fused location does produce isolated speed
// spikes at rest (multipath in a street canyon) — and an accepted 0→60
// teleport arms slope +60 km/h/s, spikes the music's energy, and can fire
// the launch cannon while parked at a light. Same contract as the derived
// path: an isolated implausible report is refused, two consecutive reports
// that agree are a moving car. ~1.5 g stays the plausibility line, so a
// real Tesla launch (about half of that) is accepted on the first fix.
{
  const r = Geo.createReader();
  const t0 = 6_000_000;
  for (let i = 0; i < 4; i++) {
    r.push({ lat: 48, lon: 11, speed: 0, heading: null, accuracy: 6, t: t0 + i * 1000 });
  }
  // one teleport: 60 km/h out of nowhere, gone again on the next fix
  r.push({ lat: 48, lon: 11, speed: 16.7, heading: null, accuracy: 6, t: t0 + 4000 });
  let s = { speed: 0 };
  for (let i = 0; i < 40; i++) s = r.sample(t0 + 4000 + i * 16, 0.016);
  ok("an isolated reported spike does not move the car (got " +
    s.speed.toFixed(1) + " km/h)", s.speed < 10);
  ok("and is counted as rejected", r.diagnostics(t0 + 4600).rejected >= 1);
  r.push({ lat: 48, lon: 11, speed: 0, heading: null, accuracy: 6, t: t0 + 5000 });
  for (let i = 0; i < 40; i++) s = r.sample(t0 + 5000 + i * 16, 0.016);
  ok("after the spike the car is still parked (got " + s.speed.toFixed(1) + ")",
    s.speed < 5);
}
{
  // a REAL launch is about 27 km/h/s and must pass on the FIRST fix — the
  // launch moment is the one the whole product exists for
  const r = Geo.createReader();
  const t0 = 6_100_000;
  for (let i = 0; i < 3; i++) {
    r.push({ lat: 48, lon: 11, speed: 0, heading: null, accuracy: 6, t: t0 + i * 1000 });
  }
  r.push({ lat: 48, lon: 11.0001, speed: 7.5, heading: null, accuracy: 6, t: t0 + 3000 });
  let s = { speed: 0 };
  for (let i = 0; i < 60; i++) s = r.sample(t0 + 3000 + i * 16, 0.016);
  ok("a plausible launch is accepted without delay (got " +
    s.speed.toFixed(1) + " km/h)", s.speed > 15);
}
{
  // two consecutive high reports that agree are a moving car, however
  // implausible the first jump looked — the corroboration contract
  const r = Geo.createReader();
  const t0 = 6_200_000;
  for (let i = 0; i < 3; i++) {
    r.push({ lat: 48, lon: 11, speed: 0, heading: null, accuracy: 6, t: t0 + i * 1000 });
  }
  r.push({ lat: 48, lon: 11.0004, speed: 16.7, heading: null, accuracy: 6, t: t0 + 3000 });
  r.push({ lat: 48, lon: 11.0008, speed: 16.9, heading: null, accuracy: 6, t: t0 + 4000 });
  let s = { speed: 0 };
  for (let i = 0; i < 80; i++) s = r.sample(t0 + 4000 + i * 16, 0.016);
  ok("two agreeing reports overrule the plausibility line (got " +
    s.speed.toFixed(1) + " km/h)", s.speed > 35);
}

// ---- the clock trap ---------------------------------------------------------
// position.timestamp may be a Unix epoch value OR milliseconds since page load,
// and browsers really do differ. Reading the second as the first puts every fix
// decades in the past, so a working receiver is declared dead on its first fix
{
  const now = 1_770_000_000_000;
  ok("an epoch timestamp is trusted", Geo.fixTime(now - 400, now) === now - 400);
  ok("a page-relative timestamp is refused", Geo.fixTime(5230, now) === now);
  ok("a missing timestamp falls back to arrival", Geo.fixTime(undefined, now) === now);
  ok("a wildly skewed device clock falls back to arrival",
    Geo.fixTime(now - 86_400_000, now) === now);
  ok("a small skew is tolerated", Geo.fixTime(now - 2000, now) === now - 2000);
}
{
  // a receiver that delivers every 3 s is slow, not broken
  const r = Geo.createReader();
  const t0 = 8_000_000;
  r.push({ lat: 48, lon: 11, speed: 20, heading: 0, accuracy: 7, t: t0 });
  r.push({ lat: 48.0005, lon: 11, speed: 21, heading: 0, accuracy: 7, t: t0 + 3000 });
  ok("a 3 s gap is not yet stale", r.diagnostics(t0 + 3500).stale === false);
  ok("a 7 s gap is stale", r.diagnostics(t0 + 10000).stale === true);
}

// ---- parked is not the same as blind ----------------------------------------
// A stationary car produces no new fixes, because nothing moved. Reading that
// as "signal lost" and dropping the music to a standstill is wrong twice over:
// the receiver is fine, and the car is genuinely where it says it is. Only a
// stream that went quiet while we were MOVING is a lost signal.
{
  const r = Geo.createReader();
  const t0 = 9_000_000;
  r.push({ lat: 48, lon: 11, speed: 0, heading: null, accuracy: 3, t: t0 });
  ok("a minute parked is not a lost signal", r.isStale(t0 + 60000) === false);
  ok("and it is reported as parked", r.diagnostics(t0 + 60000).parked === true);
  let s = { speed: 0 };
  for (let i = 0; i < 200; i++) s = r.sample(t0 + 20000 + i * 16, 0.016);
  ok("and it still reads as standing still", s.speed < 1);
}
{
  // moving, then the stream stops: that IS a lost signal
  const r = Geo.createReader();
  const t0 = 9_500_000;
  r.push({ lat: 48, lon: 11, speed: 14, heading: 0, accuracy: 4, t: t0 });
  r.push({ lat: 48.0004, lon: 11, speed: 14, heading: 0, accuracy: 4, t: t0 + 1000 });
  ok("a moving stream that stops is stale", r.isStale(t0 + 8000) === true);
  ok("and it is not called parked", r.diagnostics(t0 + 8000).parked === false);
}
{
  // crawling counts as moving — a car at walking pace still updates
  const r = Geo.createReader();
  const t0 = 9_800_000;
  r.push({ lat: 48, lon: 11, speed: 3, heading: 0, accuracy: 4, t: t0 });
  ok("crawling is not parked", r.diagnostics(t0 + 20000).parked === false);
  ok("and going quiet while crawling is stale", r.isStale(t0 + 20000) === true);
}


// ---- motion capability probe ------------------------------------------------
// Does THIS browser expose an IMU? Nobody documents it (the Tesla browser
// least of all), so the page measures it: listen for devicemotion, classify
// what arrives. The probe never prompts — a permission-gated sensor reports
// "gated", and asking is a separate, deliberate act.
{
  const fakeWin = (dm) => {
    const w = {
      addEventListener: (k, f) => { w.listeners[k] = f; },
      listeners: {},
      fire: (e) => w.listeners.devicemotion && w.listeners.devicemotion(e),
    };
    if (dm === "plain") w.DeviceMotionEvent = function () {};
    if (dm === "gated") {
      w.DeviceMotionEvent = function () {};
      w.DeviceMotionEvent.requestPermission = () => {};
    }
    return w;
  };
  const capture = () => {
    const c = { cb: null };
    c.setTimeout = (fn) => { c.cb = fn; return 1; };
    return c;
  };

  ok("createMotionProbe exists", typeof Geo.createMotionProbe === "function");

  // no constructor at all: the answer is immediate
  {
    const p = Geo.createMotionProbe({ addEventListener: () => {} }, capture());
    p.start();
    ok("no DeviceMotionEvent constructor is unavailable, got " + p.state().verdict,
      p.state().verdict === "unavailable");
  }
  // real values arriving settles the question without waiting for the window
  {
    const w = fakeWin("plain");
    let told = null;
    const p = Geo.createMotionProbe(w, capture());
    p.start((v) => { told = v; });
    w.fire({ rotationRate: { alpha: 3.2, beta: 0, gamma: 0 } });
    ok("numeric rotation is values, got " + p.state().verdict, p.state().verdict === "values");
    ok("the verdict callback fired with it", told === "values");
    ok("and the yaw is readable, got " + p.state().yaw, p.state().yaw === 3.2);
  }
  // an accelerometer without a gyro still counts: values, yaw stays null
  {
    const w = fakeWin("plain");
    const p = Geo.createMotionProbe(w, capture());
    p.start();
    w.fire({ rotationRate: null, accelerationIncludingGravity: { x: 0.4, y: 0, z: 9.8 } });
    ok("numeric acceleration alone is values, got " + p.state().verdict,
      p.state().verdict === "values");
    ok("but the yaw stays null without a gyro", p.state().yaw === null);
  }
  // events that only ever carry nulls: the browser has the API, not the sensor
  {
    const w = fakeWin("plain");
    const c = capture();
    const p = Geo.createMotionProbe(w, c);
    p.start();
    w.fire({ rotationRate: { alpha: null, beta: null, gamma: null }, acceleration: null });
    ok("null-only events stay pending inside the window", p.state().verdict === "pending");
    c.cb();
    ok("and classify as silent when the window closes, got " + p.state().verdict,
      p.state().verdict === "silent");
  }
  // no events and a permission gate: gated, and the probe must NOT have asked
  {
    const w = fakeWin("gated");
    const c = capture();
    let asked = false;
    w.DeviceMotionEvent.requestPermission = () => { asked = true; };
    const p = Geo.createMotionProbe(w, c);
    p.start();
    c.cb();
    ok("permission-gated silence reads gated, got " + p.state().verdict,
      p.state().verdict === "gated");
    ok("and the probe never prompted on its own", asked === false);
  }
  // no events, no gate: the API is a stub
  {
    const w = fakeWin("plain");
    const c = capture();
    const p = Geo.createMotionProbe(w, c);
    p.start();
    c.cb();
    ok("event-less plain API reads unavailable, got " + p.state().verdict,
      p.state().verdict === "unavailable");
  }
  // late values after a silent verdict must not flip history: verdict settles once
  {
    const w = fakeWin("plain");
    const c = capture();
    let calls = 0;
    const p = Geo.createMotionProbe(w, c);
    p.start(() => { calls++; });
    c.cb();
    w.fire({ rotationRate: { alpha: 1.0 } });
    ok("the verdict settles exactly once, got " + calls, calls === 1);
    ok("but the live yaw keeps updating for the display, got " + p.state().yaw,
      p.state().yaw === 1.0);
  }
}

// ---- reversal detection: the parking signature ------------------------------
// Below the heading floor GPS course is noise per fix, but the MOVEMENT
// direction over a completed stretch of ground still speaks: direction is
// computed only once >=6 m of net displacement beat the position noise, and a
// flip of >120 deg between consecutive stretches at crawling speed is a
// reversal — the kinematic signature of parking (and of a three-point turn,
// which is why the engine arms rather than concludes on it).
{
  const D = 7.2e-5; // ~8 m of latitude
  const creep = (r, t0, n, dir, kmh, acc) => {
    for (let i = 0; i < n; i++) {
      r.push({ lat: 48 + dir * D * i, lon: 11, speed: kmh / 3.6, heading: null,
        accuracy: acc == null ? 5 : acc, t: t0 + i * 1000 });
    }
    return t0 + n * 1000;
  };
  // creep forward, then back over the same ground: reversal
  {
    const r = Geo.createReader();
    let t = creep(r, 10_000_000, 4, +1, 8);
    ok("no reversal while creeping one way", r.sample(t, 0.016).reversal !== true);
    for (let i = 0; i < 4; i++) {
      r.push({ lat: 48 + 3 * D - D * i, lon: 11, speed: 8 / 3.6, heading: null,
        accuracy: 5, t: t + i * 1000 });
    }
    ok("creep-and-reverse raises the reversal flag", r.sample(t + 4000, 0.016).reversal === true);
    ok("and the diagnostics can say how fresh it is",
      Number.isFinite(r.diagnostics(t + 4000).reversalAgeMs));
  }
  // the same geometry at road speed is a U-turn, not a parking shuffle
  {
    const r = Geo.createReader();
    let t = creep(r, 20_000_000, 4, +1, 40);
    for (let i = 0; i < 4; i++) {
      r.push({ lat: 48 + 3 * D - D * i, lon: 11, speed: 40 / 3.6, heading: null,
        accuracy: 5, t: t + i * 1000 });
    }
    ok("a fast about-face is not a reversal", r.sample(t + 4000, 0.016).reversal !== true);
  }
  // parked jitter never completes a stretch, so it can never flip one
  {
    const r = Geo.createReader();
    const t0 = 30_000_000;
    for (let i = 0; i < 60; i++) {
      r.push({ lat: 48 + (i % 2 ? 1.5e-5 : -1.5e-5), lon: 11, speed: 0, heading: null,
        accuracy: 5, t: t0 + i * 1000 });
    }
    ok("standstill jitter is not a reversal", r.sample(t0 + 60000, 0.016).reversal !== true);
  }
  // a neighbourhood-grade fix is not ground truth: no stretches from wifi
  {
    const r = Geo.createReader();
    let t = creep(r, 40_000_000, 4, +1, 8, 500);
    for (let i = 0; i < 4; i++) {
      r.push({ lat: 48 + 3 * D - D * i, lon: 11, speed: 8 / 3.6, heading: null,
        accuracy: 500, t: t + i * 1000 });
    }
    ok("coarse fixes never claim a reversal", r.sample(t + 4000, 0.016).reversal !== true);
  }
  // the flag arms a window, it is not a latch: it expires
  {
    const r = Geo.createReader();
    let t = creep(r, 50_000_000, 4, +1, 8);
    for (let i = 0; i < 4; i++) {
      r.push({ lat: 48 + 3 * D - D * i, lon: 11, speed: 8 / 3.6, heading: null,
        accuracy: 5, t: t + i * 1000 });
    }
    ok("fresh reversal is armed", r.sample(t + 4000, 0.016).reversal === true);
    ok("and thirty seconds later it has expired",
      r.sample(t + 4000 + 30000, 0.016).reversal !== true);
  }
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("GEO_OK");
