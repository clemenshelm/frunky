// Scene scoring. The drive is the film and the engine writes the score — and
// a score knows which SCENE it is in. Until now the engine saw only speed and
// force; the same standstill got the same music whether it was buckling up,
// a red light, or a traffic jam. Five scenes now, classified from data the
// engine already has (speed history, session age, the reader's reversal flag):
//
//   ouverture  never yet cruised: ease in — the driver is parking out
//   free       ordinary driving, the arc plays at full stage
//   breath     a short stop inside flowing traffic: held sus chord, unresolved
//   patience   stop-and-go — de-arousal: capped stage, no arrival parade
//   coda       reversal + stop = probably parked: staged farewell, reversible
//
// The scene CAPS the story arc's stage (two-axis layering: the scene is the
// outer frame, the arc inside it, the drive inside both). Error costs are
// asymmetric by design: a wrong coda is music that thins and swells back.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

let rc = 0;
Math.random = () => (rc = (rc + 0.03) % 1);
transport.manual = true;
globalThis.window = { Tone: globalThis.Tone };
eval(script);
const Frunky = globalThis.window.Frunky;

ok("the __scene seam exists", typeof Frunky.__scene === "function");

await Frunky.start();
let t = 0;
// one sequencer step ≈ SPB seconds of simulated time
const step = (speed, extra) => {
  for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed, lateralG: 0, ...extra });
  transport.cb(t);
  t += SPB;
};
const steps = (n, speed, extra) => { for (let i = 0; i < n; i++) step(speed, extra); };
const SEC = Math.ceil(1 / SPB); // steps per simulated second
const sc = () => Frunky.__scene();

// ---- 1. ouverture: the session opens easy -----------------------------------
ok("a fresh session opens in the ouverture, got " + sc().scene, sc().scene === "ouverture");
ok("and the ouverture caps the stage, got " + sc().cap, sc().cap === 0.35);
steps(20 * SEC, 10);
ok("creeping around the car park is still the ouverture", sc().scene === "ouverture");
steps(7 * SEC, 60);
ok("sustained real driving ends the ouverture for good, got " + sc().scene,
  sc().scene === "free");
ok("and the cap lifts, got " + sc().cap, sc().cap === 1);

// ---- 2. breath: a red light is a held breath, not a scene change ------------
const susBefore = sc().susVoiced;
steps(4 * SEC, 0);
ok("a short stop inside flowing traffic is a breath, got " + sc().scene,
  sc().scene === "breath");
steps(8 * SEC, 0);
ok("and the pads hold a suspended chord while it lasts, voiced " +
  (sc().susVoiced - susBefore), sc().susVoiced > susBefore);
// twelve seconds at a light with NO reversal beforehand: still a breath.
// The coda needs the arm — without this line, any long stop reads as
// parked and every slow red light plays the farewell
ok("a plain long stop never becomes the coda, got " + sc().scene,
  sc().scene === "breath");
steps(6 * SEC, 60);
ok("driving on resolves back into free, got " + sc().scene, sc().scene === "free");
const susAfterFree = sc().susVoiced;
steps(8 * SEC, 60);
ok("and no sus chords are voiced while moving", sc().susVoiced === susAfterFree);

// ---- 3. patience: stop-and-go earns de-arousal, entered on a hard cut -------
for (let i = 0; i < 3; i++) { steps(8 * SEC, 25); steps(4 * SEC, 0); }
ok("three stops inside the window read as patience, got " + sc().scene,
  sc().scene === "patience");
ok("patience caps the stage at 0.45, got " + sc().cap, sc().cap === 0.45);
ok("and the arrival parade is off the table", sc().paradeAllowed === false);
steps(4 * SEC, 25);
ok("crawling on inside the jam stays patience", sc().scene === "patience");
// and the parade really stays home: a sustained sprint inside the jam — the
// exact pattern that earns the full arrival on the open road — must land
// quietly. Behavior, not the seam's word for it.
{
  const mark = Frunky.__rise().log.length;
  let v = 25;
  for (let i = 0; i < 96; i++) { v += 18 * SPB; step(v); }
  for (let i = 0; i < 96; i++) step(v);
  const kinds = [...new Set(Frunky.__rise().log.slice(mark).map((e) => e.kind))];
  ok("a sprint inside the jam never gets the parade, got " + kinds.join(","),
    !kinds.includes("arrival"));
  ok("but it still resolves with the quiet landing", kinds.includes("landing"));
}
steps(100 * SEC, 55);
ok("a hundred seconds of open road drains the jam window, got " + sc().scene,
  sc().scene === "free");
ok("and the parade is back", sc().paradeAllowed === true);

// ---- 4. coda: reversal + stop = probably parked — and reversible ------------
steps(4 * SEC, 8, { reversal: true });
ok("a low-speed reversal arms the coda", sc().revArmed === true);
steps(8 * SEC, 0);
ok("stopping while armed confirms it, got " + sc().scene, sc().scene === "coda");
const p1 = sc().codaProgress;
steps(8 * SEC, 0);
ok("the farewell is staged, not a switch: progress grows " +
  p1.toFixed(2) + " -> " + sc().codaProgress.toFixed(2), sc().codaProgress > p1);
ok("and the cap falls with it, got " + sc().cap, sc().cap < 0.7);
steps(20 * SEC, 0);
ok("twenty more seconds complete the farewell", sc().codaProgress === 1);
// it was a false alarm — the drive goes on, the score comes back
steps(6 * SEC, 40);
ok("driving on cancels the coda without ceremony, got " + sc().scene,
  sc().scene === "free");
ok("the cap is restored", sc().cap === 1);
ok("and the progress is forgotten", sc().codaProgress === 0);

// a U-turn is the same kinematics WITHOUT the stop: never a coda
steps(4 * SEC, 8, { reversal: true });
steps(10 * SEC, 45);
ok("a three-point turn that drives on never becomes a coda, got " + sc().scene,
  sc().scene === "free");

Frunky.stop();
transport.clear();

// ---- 5. the deep palette: a tonic pedal under walking chords ----------------
// Film craft: the cheapest tension device is a bass that stays while the
// harmony moves above it. Deep pieces carry it, neutral pieces do not — and
// piece one of a fresh set is deep by the wave, so a fresh start proves both.
{
  await Frunky.start();
  let t2 = 0;
  const step2 = (speed) => {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed, lateralG: 0 });
    transport.cb(t2);
    t2 += SPB;
  };
  const PIECE = 7 * 16 * 16;
  const nodes = () => Frunky.__scene().nodes;
  ok("the scene seam exposes the pedal voice", !!(nodes() && nodes().bassSub));
  const before = nodes().bassSub.trigs;
  let mood1 = null;
  for (let s = 0; s < PIECE; s++) { step2(60); if (!mood1) mood1 = Frunky.__set().piece.mood; }
  const deepTrigs = nodes().bassSub.trigs - before;
  ok("piece one of a fresh set is deep (the wave)", mood1 === "deep");
  ok("a deep piece at city speed carries the tonic pedal, got " + deepTrigs,
    deepTrigs > 0);
  const before2 = nodes().bassSub.trigs;
  let mood2 = null;
  for (let s = 0; s < PIECE; s++) { step2(60); mood2 = Frunky.__set().piece.mood; }
  const neutralTrigs = nodes().bassSub.trigs - before2;
  ok("piece two is neutral (the wave)", mood2 === "neutral");
  ok("a neutral piece at city speed has no pedal, got " + neutralTrigs,
    neutralTrigs === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("SCENE_OK");
