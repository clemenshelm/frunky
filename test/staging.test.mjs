// Staging. The field report: "the whole mix is relatively flat". Accurate —
// every voice sat on the same depth plane (near-identical share of ONE room)
// and almost everything sat dead center. Production craft calls the fix
// depth staging: a sound stage has front/back (dry vs. room, a touch of
// level) and left/right (placement), and a band that uses both stops being
// a wall. Three planes here: drums and bass dry at the front, the hook in
// the middle, the chord carpet (pad + gate) clearly behind the band. Width
// is placement, never a side-show — small static pans, the way a real kit
// and band stand on a stage. The sound world owns a room size of its own
// (organic breathes, neon is close and dry), and a very quiet dark air bed
// breathes underneath so "atmosphere" is not only a metaphor.
import { readFileSync } from "node:fs";
import { transport } from "./tone-stub.mjs";

const script = readFileSync(new URL("../engine.js", import.meta.url), "utf8");
const SPB = 60 / 132 / 4;
const failures = [];
const ok = (label, cond) => { if (!cond) failures.push(label); };

function makeStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    raw: m,
  };
}
function boot(seed, store) {
  let rc = 0;
  Math.random = () => (rc = (rc + seed) % 1);
  transport.manual = true;
  const w = { Tone: globalThis.Tone };
  if (store) w.localStorage = store;
  globalThis.window = w;
  eval(script);
  return globalThis.window.Frunky;
}

// ---- 1. the stage has depth and width ---------------------------------------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  ok("the __staging seam exists", typeof Frunky.__staging === "function");
  const st = typeof Frunky.__staging === "function" ? Frunky.__staging() : null;
  ok("the seam reports after build", !!st);

  // depth: the chord carpet sits BEHIND the band — its share of the shared
  // room is clearly larger than dry, while the snare keeps only a whisper of
  // glue and the rhythm section stays at the front
  ok("the pad carpet sits behind the band (wet share > 1.25)",
    !!st && st.sends.pad > 1.25);
  ok("the gate sits behind the band too (wet share > 1.15)",
    !!st && st.sends.gate > 1.15);
  ok("depth is a plane, not an effect: carpet sends stay ≤ 2",
    !!st && st.sends.pad <= 2 && st.sends.gate <= 2);
  ok("the snare keeps only glue at the front (≤ 0.2)",
    !!st && st.sends.snare <= 0.2);

  // width: several voices stand off center, on BOTH sides, and none of them
  // leaves the stage — placement, never a ping-pong effect
  const pans = st ? Object.values(st.pans) : [];
  ok("at least four voices stand off center, saw " + pans.join(","),
    pans.filter((p) => Math.abs(p) > 0.05).length >= 4);
  ok("both sides of the stage are used",
    pans.some((p) => p > 0.05) && pans.some((p) => p < -0.05));
  ok("no voice leaves the stage (|pan| ≤ 0.35)",
    pans.length > 0 && pans.every((p) => Math.abs(p) <= 0.35));
  // the anchors stay center: kick, snare, bass carry the meter and the low
  // end — panning them is how a car mix loses its spine (they are simply not
  // in the pans table)
  ok("kick, snare and bass are not panned",
    !!st && !("kick" in st.pans) && !("snare" in st.pans) && !("bass" in st.pans));
  Frunky.stop();
  transport.clear();
}

// ---- 2. the world owns a room: organic breathes, neon stands close ----------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  const w = Frunky.__world();
  ok("every world names a room size",
    ["analog", "organic", "neon"].every((n) => typeof w.tables[n].room === "number"));
  ok("analog's room is the reference (exactly 1)", w.tables.analog.room === 1);
  ok("rooms stay within 0.6..1.5 — a world may move the room, never remove it",
    ["analog", "organic", "neon"].every((n) =>
      w.tables[n].room >= 0.6 && w.tables[n].room <= 1.5));
  ok("organic breathes more than neon",
    w.tables.organic.room > 1 && w.tables.neon.room < 1);

  // and the room really reaches the send: at a steady cruise the reverb send
  // sits at base 0.4 times the piece's room — piece by piece, base-free
  const state = { t: 0, lastNum: 0 };
  const seen = [];
  while (state.lastNum < 8) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(state.t);
    state.t += SPB;
    const p = Frunky.__set().piece;
    if (p && p.num !== state.lastNum) {
      state.lastNum = p.num;
      // one update AFTER the boundary so the ctl has seen the new world
      Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
      const s2 = typeof Frunky.__staging === "function" ? Frunky.__staging()
        : { room: {}, atmo: {} };
      seen.push({ world: Frunky.__world().name, room: s2.room.engine,
        send: s2.room.revSend });
    }
  }
  ok("each piece's room factor tracks its world",
    seen.every((r) => r.room === w.tables[r.world].room));
  // skip piece 1 (wake/thrust still settling right after start)
  ok("the send really carries the room, saw " +
    seen.slice(1).map((r) => (typeof r.send === "number" ? r.send.toFixed(3) : "?")).join(","),
    seen.slice(1).every((r) => typeof r.send === "number" &&
      Math.abs(r.send - 0.4 * w.tables[r.world].room) < 0.06));
  ok("eight pieces of staging, zero engine errors", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

// ---- 3. the air bed: atmosphere in the literal sense ------------------------
{
  const Frunky = boot(0.03, makeStore());
  await Frunky.start();
  const st0 = typeof Frunky.__staging === "function" ? Frunky.__staging() : null;
  ok("the air bed is silent at standstill", !!st0 && st0.atmo.gain <= 0.001);
  const state = { t: 0, lastNum: 0 };
  while (state.lastNum < 2) {
    for (let f = 0; f < 4; f++) Frunky.update(SPB / 4, { speed: 60, lateralG: 0 });
    transport.cb(state.t);
    state.t += SPB;
    const p = Frunky.__set().piece;
    if (p && p.num !== state.lastNum) state.lastNum = p.num;
  }
  const st1 = typeof Frunky.__staging === "function" ? Frunky.__staging() : null;
  ok("the air bed breathes in with the drive, got " + (st1 && st1.atmo.gain),
    !!st1 && st1.atmo.gain > 0.005);
  ok("and stays air, never a wash (≤ 0.05)", !!st1 && st1.atmo.gain <= 0.05);
  ok("zero engine errors with the bed running", Frunky.health().errors === 0);
  Frunky.stop();
  transport.clear();
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("STAGING_OK");
