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
  // ~0.0003° of latitude per second ≈ 33 m/s ≈ 120 km/h
  r.push({ lat: 48, lon: 11, speed: null, heading: null, t: t0 });
  r.push({ lat: 48.0003, lon: 11, speed: null, heading: null, t: t0 + 1000 });
  r.push({ lat: 48.0006, lon: 11.0001, speed: null, heading: null, t: t0 + 2000 });
  let s = { speed: 0, lateralG: 0 };
  for (let i = 0; i < 200; i++) s = r.sample(t0 + 2000 + i * 16, 0.016);
  near("speed derived from the track", s.speed, 120, 25);
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
  r2.push({ lat: 48, lon: 11, speed: null, heading: null, t: t0 });
  r2.push({ lat: 48.001, lon: 11, speed: null, heading: null, t: t0 + 1000 });
  const d2 = r2.diagnostics(t0 + 1000);
  ok("names the track as the speed source when the browser withholds it",
    d2.speedSource === "track");
  ok("names the track as the heading source when the browser withholds it",
    d2.headingSource === "track");
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("GEO_OK");
