// Frunky music engine — shared by the driver page (drive.html) and the
// internal test bench (index.html). It owns everything musical: the Tone.js
// graph, the sequencer, the song form, and the continuous force mappings.
//
// It knows nothing about where its input comes from. Feed it
//   Frunky.update(dt, { speed, lateralG })
// once per animation frame — speed in km/h, lateralG in -1..1 (positive =
// pushed right, i.e. a left-hand curve) — and it does the rest.
(() => {
  "use strict";
  // per-piece transposition, applied ONLY at the Hz conversion: all pattern
  // arithmetic (pentatonic guards, chord math) stays in untransposed A-space
  let tp = 0;
  const F = (m) => 440 * Math.pow(2, (m + tp - 69) / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const db = (g) => 20 * Math.log10(Math.max(g, 0.0001));

  // ---- music constants -----------------------------------------------------

  const BPM = 132;
  const SPB = 60 / BPM / 4;

  // pattern pools — sections rotate through these every 16 bars.
  // modal harmony, no dominant tension: open voicings, thirds kept high,
  // the bass owns the low register alone (ROOTS runs parallel to PROGS)
  const PROGS = [
    [[57, 64, 67, 71], [53, 60, 64, 67], [55, 59, 62, 69], [57, 64, 67, 71]], // Am9 Fmaj9 Gadd9 Am9
    [[57, 64, 67, 71], [50, 57, 62, 66], [57, 64, 67, 72], [55, 62, 64, 71]], // Am9 Dadd9 Am7 G6/9 — dorian lift
    [[57, 64, 67, 71], [52, 59, 62, 67], [53, 60, 64, 67], [55, 59, 62, 69]], // Am9 Em7 Fmaj9 Gadd9
    [[57, 64, 67, 71], [53, 57, 62, 65], [55, 62, 64, 71], [57, 64, 67, 71]], // Am9 Dm7 G6/9 Am9 — i iv VII i
  ];
  const ROOTS = [
    [33, 29, 31, 33],
    [33, 38, 33, 31],
    [33, 28, 29, 31],
    [33, 38, 31, 33],
  ];
  // sections keep their progression or move to a musical neighbour —
  // never a blind jump across the pool
  const PROG_NEXT = [[1, 3], [0, 2], [1, 0], [0, 2]];
  // ---- harmonic palettes ---------------------------------------------------
  // "It always uses a very similar chord set." Accurate: one global pool, all
  // of it Am-modal. Industry practice makes harmonic identity a PER-SONG
  // commitment — the axis loop (Am F C G) carries hundreds of hits as a
  // song-level choice, and a film cue commits to one harmonic world so the
  // leitmotif can return recolored by it. So the piece rolls a PALETTE from
  // its mood, the way it rolls its arc. Three rules keep every palette safe
  // by construction (pinned in palette.test.mjs): every progression OPENS on
  // the Am9 home voicing — the pivot chord, so any section change and any
  // palette change passes through home; every chord stays in the white-note
  // world plus dorian F#, so the pentatonic material — arps, blips, licks,
  // the leitmotif — stays consonant over every palette; and adjacent chords
  // (including the loop seam back to the top) always share a tone — the
  // common-tone craft of chorale voice leading, hand-voiced, never generated.
  const SUS_PROGS = [ // suspended/quartal, thirdless, floating — deep's home
    [[57, 64, 67, 71], [50, 57, 64, 67], [57, 64, 67, 71], [55, 60, 62, 69]], // Am9 Dsus9 Am9 Gsus9
    [[57, 64, 67, 71], [52, 62, 64, 71], [55, 60, 62, 69], [57, 64, 67, 71]], // Am9 E7sus Gsus9 Am9
    [[57, 64, 67, 71], [55, 60, 62, 69], [50, 57, 64, 67], [52, 62, 64, 71]], // Am9 Gsus9 Dsus9 E7sus
  ];
  const SUS_ROOTS = [
    [33, 38, 33, 31],
    [33, 28, 31, 33],
    [33, 31, 38, 28],
  ];
  const SUS_NEXT = [[1, 2], [0, 2], [1, 0]];
  const LIGHT_PROGS = [ // relative-major axis loops — anthem's brightness
    [[57, 64, 67, 71], [53, 60, 64, 67], [55, 60, 64, 72], [55, 59, 62, 69]], // Am9 Fmaj9 C/G Gadd9 — the axis
    [[57, 64, 67, 71], [53, 60, 64, 67], [55, 59, 62, 69], [48, 60, 64, 71]], // Am9 Fmaj9 Gadd9 Cmaj7
    [[57, 64, 67, 71], [52, 59, 62, 67], [53, 60, 64, 67], [55, 60, 64, 72]], // Am9 Em7 Fmaj9 C/G — the descent
  ];
  const LIGHT_ROOTS = [
    [33, 29, 36, 31],
    [33, 29, 31, 36],
    [33, 28, 29, 36],
  ];
  const LIGHT_NEXT = [[1, 2], [0, 2], [0, 1]];
  const LAMENT_PROGS = [ // the Andalusian descent — romantic-minor gravity
    // (the Muse element): the bass falls A G F E under white-note chords,
    // E as thirdless E7sus so the lament stays inside the consonance rule
    [[57, 64, 67, 71], [55, 59, 62, 64], [53, 60, 64, 67], [52, 62, 64, 71]], // Am9 G6 Fmaj9 E7sus
    [[57, 64, 67, 71], [53, 60, 64, 67], [52, 62, 64, 71], [57, 64, 67, 71]], // Am9 Fmaj9 E7sus Am9
    [[57, 64, 67, 71], [55, 59, 62, 64], [52, 62, 64, 71], [53, 60, 64, 67]], // Am9 G6 E7sus Fmaj9
  ];
  const LAMENT_ROOTS = [
    [33, 31, 29, 28],
    [33, 29, 28, 33],
    [33, 31, 28, 29],
  ];
  const LAMENT_NEXT = [[1, 2], [0, 2], [0, 1]];
  const PALETTES = {
    modal: { progs: PROGS, roots: ROOTS, next: PROG_NEXT },
    sus: { progs: SUS_PROGS, roots: SUS_ROOTS, next: SUS_NEXT },
    light: { progs: LIGHT_PROGS, roots: LIGHT_ROOTS, next: LIGHT_NEXT },
    lament: { progs: LAMENT_PROGS, roots: LAMENT_ROOTS, next: LAMENT_NEXT },
  };
  // deep floats, anthem brightens, and modal stays everyone's second home —
  // palette changes stay frequent enough to notice, never total
  const PALETTE_POOL = {
    deep: ["sus", "lament", "modal"],
    neutral: ["modal", "light"],
    anthem: ["light", "lament", "modal"],
  };
  // ---- sound worlds --------------------------------------------------------
  // "We always use the same instruments." Accurate: pieces roll key, mood,
  // recipe, arc, palette and motif — and hand it all to one fixed orchestra.
  // Orchestration is the last classical identity axis, and in film scoring
  // THE cue decision: the same leitmotif recolored by instrument beats any
  // harmonic recoloring. The album practice bounds it: every track its own
  // arrangement, ONE production sound. So a world is a curated preset bundle
  // over the EXISTING voices — swap, never stack (render cost stays flat on
  // the car unit), the backbone (thrust, car mix, roles, the hook chain the
  // recipe owns) untouched. analog IS today's sound, pinned verbatim by
  // world.test.mjs as the regression reference. trim is a physics
  // compensation in dB (a triangle pad carries far less energy than a saw
  // pad), bounded by the test so a world can never smuggle in a mix change.
  const SOUNDWORLDS = {
    analog: { // today's park — punchy club kick, saw washes, warm gate
      kick: { pitchDecay: 0.08, octaves: 1.9, decay: 0.26 },
      hat: { closed: 0.04, open: 0.26 },
      snare: { decay: 0.13 },
      room: 1, // the reference room — staging scales the shared send by this
      bass: { osc: { type: "fattriangle", count: 2, spread: 8 }, lite: "triangle", lp: 480, trim: 0 },
      pad: { osc: { type: "fatsawtooth", count: 3, spread: 14 }, lite: "sawtooth", attack: 1.1, release: 1.6, trim: 0 },
      gate: { osc: { type: "fattriangle", count: 2, spread: 12 }, lite: "triangle", trim: 0 },
      blip: { osc: { type: "square" }, trim: 0 },
    },
    organic: { // round and woody — soft kick, breathy hats, triangle washes
      kick: { pitchDecay: 0.15, octaves: 1.4, decay: 0.34 },
      hat: { closed: 0.065, open: 0.34 },
      snare: { decay: 0.19 },
      room: 1.35, // woody and airy: organic breathes in a bigger room
      bass: { osc: { type: "triangle" }, lite: "triangle", lp: 360, trim: 1.5 },
      pad: { osc: { type: "fattriangle", count: 3, spread: 10 }, lite: "triangle", attack: 1.5, release: 2.2, trim: 2.5 },
      gate: { osc: { type: "fattriangle", count: 2, spread: 8 }, lite: "triangle", trim: 0.5 },
      blip: { osc: { type: "triangle" }, trim: 2 },
    },
    neon: { // tight and cold — clarity, one pane of glass, crisp air.
      // v3 after the third field report ("much too loud, unbearable"): the
      // square bass was wrong physics twice over — ~4.8 dB more RMS than
      // analog's fattriangle at equal peak, with the energy in the
      // fundamental and low harmonics, exactly the band the bass lowpass
      // PASSES. No trim wins that fight. Cold now means CLARITY: the tight
      // kick, crisp hats and small room carry the identity, the bass goes
      // triangle in a window darker than analog's, the gate goes hollow,
      // and only the pad keeps the glass (the world.test saw ceiling)
      kick: { pitchDecay: 0.06, octaves: 2.05, decay: 0.2 },
      hat: { closed: 0.03, open: 0.2 },
      snare: { decay: 0.1 },
      room: 0.85,
      bass: { osc: { type: "triangle" }, lite: "triangle", lp: 380, trim: -1 },
      pad: { osc: { type: "fatsawtooth", count: 3, spread: 14 }, lite: "sawtooth", attack: 0.8, release: 1.2, trim: -2 },
      gate: { osc: { type: "fattriangle", count: 2, spread: 10 }, lite: "triangle", trim: -1 },
      blip: { osc: { type: "square" }, trim: -1 },
    },
  };
  // deep rounds off, anthem goes cold and bright, analog stays everyone's
  // second home — and never the same world twice in a row (album practice:
  // consecutive tracks must not share a sound)
  const WORLD_POOL = {
    deep: ["organic", "analog"],
    neutral: ["analog", "organic", "neon"],
    anthem: ["neon", "analog"],
  };
  const BASSPATS = [
    [2, 6, 10, 14], // straight offbeats
    [2, 6, 11, 14], // funk push on the and-of-three
    [2, 10, 13],    // laid back, with holes
    [0, 2, 4, 6, 8, 10, 12, 14], // driving straight 8ths — the Muse engine
  ];
  // harmonic rhythm: per bar / held / anticipated on the and-of-four / anticipated
  // at an odd spot. Changes ARRIVE early but always belong to the NEXT bar —
  // the bass root only ever moves on the one, so the one stays the one.
  const HRS = ["bar", "twobar", "push", "sync"];
  const SYNCPOS = [10, 12]; // and-of-three / beat four
  // chord instrumentation pool — the cure for "waaah, waaah, waaah":
  // wash = the sustained pad, keys = rolled Rhodes with a whisper of pad,
  // broken = the chord flows as an 8th-note figure on the Rhodes,
  // gate = the classic trance gate: chord chopped by a rhythm mask
  const PADSTYLES = ["wash", "keys", "broken", "gate"];
  const BROKENPATS = [
    [0, 1, 2, 3, 2, 1, 3, 2],
    [0, 2, 1, 3, 0, 2, 3, 1],
    [0, 3, 1, 2, 1, 3, 2, 1],
  ]; // chord-tone indices, one per 8th
  // 16th on/off masks. Each one REPEATS every half bar: an irregular mask
  // reads as randomness rather than groove, and a listener can only enjoy a
  // pulse they can predict. No hole is longer than two steps, so the envelope's
  // release always bridges it
  const GATEPATS = [
    [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0],
    [1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
    [1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0], // 3-3-2
  ];
  const FILLS = ["toms", "sweep", "swell"];
  // the fill crate — hand-set drum phrases, three sizes, the drummer's
  // hierarchy: a small shrug every few bars, a half-bar answer at phrase
  // ends, a full-bar statement into a new part. Fills mark FORM boundaries
  // (the boundary predictable, the content not — that is what the ear
  // counts as musical intent), so they live at bar tails, never mid-bar.
  // [pos, voice, pitch, vel] — voice: t tom (pitch=f0), s snare, g ghost, k kick
  const DRUMFILLS = {
    small: [
      [[13, "g", 0, 0.5], [14, "t", 170, 0.7], [15, "t", 140, 0.9]],
      [[14, "g", 0, 0.5], [15, "s", 0, 0.8]],
      [[12, "t", 190, 0.6], [14, "t", 150, 0.8], [15, "g", 0, 0.5]],
    ],
    medium: [
      [[10, "s", 0, 0.6], [11, "g", 0, 0.4], [12, "t", 180, 0.7],
        [13, "t", 150, 0.8], [14, "t", 125, 0.9], [15, "g", 0, 0.5]],
      [[10, "t", 200, 0.6], [12, "s", 0, 0.7], [13, "g", 0, 0.4],
        [14, "s", 0, 0.85], [15, "t", 130, 0.9]],
      [[8, "k", 0, 0.7], [10, "s", 0, 0.6], [12, "t", 170, 0.75],
        [14, "t", 140, 0.85], [15, "s", 0, 0.9]],
    ],
    large: [
      [[4, "s", 0, 0.6], [6, "t", 200, 0.65], [8, "s", 0, 0.7],
        [10, "t", 170, 0.75], [12, "t", 150, 0.85], [13, "g", 0, 0.5],
        [14, "t", 125, 0.95], [15, "s", 0, 1]],
      [[4, "t", 210, 0.55], [7, "g", 0, 0.4], [8, "t", 180, 0.7],
        [11, "g", 0, 0.45], [12, "s", 0, 0.8], [14, "t", 140, 0.9],
        [15, "t", 120, 1]],
    ],
  };
  // call-and-response answers for the square-wave blip voice (pentatonic, high)
  const BLIPS = [[76, 74, 72], [72, 76, 79], [74, 72, 69]];
  // bass licks as [pos, semitones-from-root]: pickups into the next ONE.
  // One register above the groove so they connect instead of interrupting
  const LICKS = [
    [[10, 5], [12, 7], [14, 10], [15, 12]],  // run-up into the one
    [[10, 12], [12, 7], [13, 12], [15, 10]], // octave bounce
    [[11, 12], [12, 10], [13, 7], [15, 5]],  // walk-down, resolves on the one
  ];
  // melodic bass lines: pentatonic-safe intervals per pattern hit
  const BASSMELS = [
    [0, 0, 7, 0],
    [0, 12, 7, 10],
    [0, 3, 5, 7],
  ];

  // (the sung-voice engine lived here — parked and removed; git remembers.
  // Lead melody is the hardest problem in generative music and the GM samples
  // capped it. The hook riff carries the chorus identity instead.)
  // the bass sits in the pocket: consistently a touch behind the beat
  function bassT(t) { return t + 0.008 + (Math.random() - 0.5) * 0.006; }

  // highway harmony: the section progressions retire on the open road.
  // A pedal holds Am while one inner voice walks (chorale trick), and every
  // 24 bars the anthem lift — bVI–bVII–i, F G Am — opens the sky for 8 bars.
  const PEDALPROG = [[57, 64, 67, 71], [57, 65, 67, 72], [57, 64, 67, 71], [57, 64, 69, 74]];
  const PEDALROOTS = [33, 33, 33, 33];
  const LIFTPROG = [[53, 60, 65, 69], [55, 62, 67, 71], [57, 64, 69, 72], [57, 64, 69, 76]];
  const LIFTROOTS = [29, 31, 33, 33];
  const PENTA = [9, 0, 2, 4, 7]; // A C D E G — safe over the lift cadence
  // A-minor-pentatonic arps: consonant over every chord in the pools
  const ARPS = [
    [57, 60, 62, 64, 67, 64, 62, 60],
    [57, 62, 64, 67, 69, 67, 64, 62],
    [64, 62, 60, 57, 60, 62, 64, 67],
  ];
  // ---- rise figure ---------------------------------------------------------
  // The engine feedback, EV edition. A siren-style pitch sweep was tried and
  // failed twice over: a glissando knows neither key nor grid, and a rising
  // continuous tone reads as alarm. The model here is the traction inverter
  // of a tram — successive rising tones that OVERLAP — translated into the
  // one musical device built from overlapping entries: a canon. Voices enter
  // on the 8th grid and climb this pentatonic ladder, so no overlap can be
  // dissonant; the window is Shepard-shaped (entries start low, voices fade
  // toward the top), so the ascent never runs out of register — an EV has no
  // redline. When the push ebbs the last voices LAND on a chord tone: the
  // figure cadences instead of being switched off.
  const RISE_LADDER = [64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88]; // E G A C D…
  const RISE_LEN = 6;                      // notes per voice, about an octave of climb
  const RISE_ENV = [0.55, 0.8, 1, 1, 0.8, 0.55]; // Shepard window: in low, out high
  const RISE_ON = 0.15, RISE_OFF = 0.08;   // thrust hysteresis, in engagement order
  // the full celebration is rationed: it needs a SUSTAINED sprint (hot 8ths
  // with push > 0.5) and a stretch of restraint since the last one. In town,
  // every light is a sprint — scarcity is what keeps the parade a payoff.
  const RISE_FULL_HOT = 24;                // ≈ 3 bars genuinely sprinting
  const RISE_COOLDOWN = 512;               // steps ≈ 32 bars ≈ 58 s

  // ---- song form ----------------------------------------------------------
  // A piece = a script of parts. Verse delivers, chorus pays off (the SAME
  // hook every time), the bridge disrupts so the last chorus feels like release.
  const FORMS = [
    ["A", "A", "B", "A", "B", "C", "B"],
    ["A", "B", "A", "B", "C", "B", "B"],
    ["A", "A", "B", "A", "C", "B", "B"],
  ]; // the bridge always resolves into a chorus — its breakdown must earn a payoff
  const PART_NAMES = { A: "Strophe", B: "Refrain", C: "Bridge" };
  // every piece rolls its own key and mood: variation pools can't fix a
  // universe where the tonic never moves. Small moves only (±2/±3 semitones)
  const TRANSPOSES = [-3, -2, 0, 0, 2, 3];
  const KEYNAMES = { "-3": "F♯m", "-2": "Gm", "0": "Am", "2": "Hm", "3": "Cm" };
  // macro arc: the mood is DRAMATURGY, not a pool. A DJ set is a wave —
  // warm-up, build, peak, breathe, rebuild, then the double peak — and the
  // valleys are what make the peaks land; a dice roll gives neither. The wave
  // is indexed by the running episode number and cycles (~27 min per lap),
  // so a 40-minute drive rides one full wave and starts earning the next.
  // deep pulls the payoff elements back, anthem leans into them
  const SET_WAVE = ["deep", "neutral", "anthem", "neutral", "deep", "neutral", "anthem", "anthem"];

  // the residency: the set state survives the drive. A daily 10-minute
  // commute never reaches minute 35 of one drive — its staleness comes from
  // every drive starting at episode one. Persisting {episode, key, walk
  // position} makes the next drive the NEXT EPISODE of a running set: it
  // resumes wherever the wave stood and the key must move on. The payload is
  // versioned and validated field by field; anything unreadable starts a
  // fresh set — a hostile store must never crash the music.
  const SET_KEY = "frunky.set.v1";
  function setStore() {
    // window.localStorage can THROW on access in hardened privacy modes
    try { return (typeof window !== "undefined" && window.localStorage) || null; }
    catch (err) { void err; return null; }
  }
  function loadSet() {
    try {
      const st = setStore();
      const raw = st && st.getItem(SET_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return null;
      if (!Number.isInteger(d.num) || d.num < 1) return null;
      if (!TRANSPOSES.includes(d.tp)) return null;
      // the palette is OPTIONAL, same doctrine as the motif: an unknown name
      // is discarded on its own and the episode survives on modal. But the
      // walk position must tell the truth about the pool it claims — an
      // index outside the named palette poisons the whole payload
      const pal = PALETTES[d.pal] ? d.pal : "modal";
      if (!Number.isInteger(d.progIdx) || !PALETTES[pal].progs[d.progIdx]) return null;
      // the motif is OPTIONAL: a pre-motif payload (old data, new code) must
      // resume its episode and simply roll a fresh theme, and a corrupt
      // motif is discarded on its own — it must never cost the residency
      let motif = null;
      if (Array.isArray(d.m) && d.m.length >= 3 && d.m.length <= 8 &&
          d.m.every((r) => Array.isArray(r) && r.length === 4 &&
            r.every((x) => Number.isFinite(x)) &&
            Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= 15 &&
            r[1] >= 1 && r[1] <= 8 && r[2] >= 0 && r[2] <= 2 &&
            RIFFSET.includes(r[3]))) {
        motif = d.m.map(([p, dd, a, s]) => ({ p, d: dd, a, s }));
      }
      return { num: d.num, tp: d.tp, progIdx: d.progIdx, pal, motif };
    } catch (err) { void err; return null; }
  }
  function saveSet(num, tpv, progIdx, motif, pal) {
    try {
      const st = setStore();
      if (st) st.setItem(SET_KEY, JSON.stringify({ v: 1, num, tp: tpv, progIdx, pal,
        m: motif ? motif.map((n) => [n.p, n.d, n.a, n.s]) : undefined }));
    } catch (err) { void err; }
  }
  // ---- composition dice ----------------------------------------------------
  // Every COMPOSED decision (piece, part bundle, per-occurrence ornament)
  // draws from its own keyed random stream instead of the global Math.random.
  // The global stream is consumed by every note that happens to sound
  // (micro-timing, velocities), so composition outcomes used to depend on
  // exactly how many notes had played — and every new roll added to newPiece
  // shifted every seed-dependent test in the suite. A keyed stream bounds the
  // blast radius: a new decision is a new key, and existing keys keep their
  // answers. Note jitter stays on Math.random — it is texture, not identity.
  let diceSeed = "";
  const diceStreams = new Map();
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dicer(tag) {
    let s = diceStreams.get(tag);
    if (!s) { s = mulberry32(hash32(diceSeed + ":" + tag)); diceStreams.set(tag, s); }
    return s;
  }
  // one pick, everywhere: pool minus what must be avoided, from a given stream
  const pick = (pool, avoid, rnd) => {
    const p = avoid != null && pool.length > 1 ? pool.filter((x) => x !== avoid) : pool;
    return p[Math.floor(rnd() * p.length)];
  };

  function rollBundle(role, progIdx, mood, notLike, recipe, rnd) {
    // a sibling part must be tellable apart: never the same chord style or
    // bass pattern as the bundle it plays against (contrast is the form)
    // the recipe curates which bass patterns may play under its kick —
    // and, where it declares them, which harmonic rhythms fit its pulse
    const bassChoices = (recipe.bass || [0, 1, 2]).map((i) => BASSPATS[i]);
    const hrPool = recipe.hrs || HRS;
    const b = {
      progIdx,
      hr: hrPool[Math.floor(rnd() * hrPool.length)],
      bassPat: pick(bassChoices, notLike && notLike.bassPat, rnd),
      bassMel: rnd() < (role === "chorus" ? 0.5 : 0.3)
        ? BASSMELS[Math.floor(rnd() * BASSMELS.length)] : null,
      arpSeq: ARPS[Math.floor(rnd() * ARPS.length)],
      arpOct: role === "bridge" ? 12 : rnd() < 0.2 ? 12 : 0,
      ghosts: rnd() < 0.5,
      bassFill: rnd() < 0.5,
      blips: rnd() < (role === "verse" ? 0.4 : 0.2) * (mood === "deep" ? 0.5 : 1),
      brassy: role === "chorus" &&
        rnd() < (mood === "anthem" ? 0.7 : mood === "deep" ? 0.15 : 0.5),
      snare: role === "chorus" ? mood !== "deep"
        : rnd() < (mood === "anthem" ? 0.6 : 0.35),
      // the verse never gates: a piece must not OPEN on its most aggressive
      // chord voice. The gate is a development, so it belongs to the parts
      // that arrive after the listener has settled in
      padStyle: pick(role === "verse" ? ["wash", "keys", "broken"]
        : role === "chorus" ? ["wash", "keys", "gate"] : PADSTYLES,
        notLike && notLike.padStyle, rnd),
    };
    // curation (auditory scene analysis: at most one rhythmic protagonist,
    // and figures must agree on WHEN harmony changes):
    // – broken/gate figures change chords on barlines only, so anticipating
    //   harmonic rhythms would announce a chord the figure keeps contradicting
    if (b.padStyle === "broken" || b.padStyle === "gate")
      b.hr = rnd() < 0.5 ? "bar" : "twobar";
    // – the gate IS the foreground rhythm: blips and brass would fight it
    if (b.padStyle === "gate") { b.blips = false; b.brassy = false; }
    // – broken Rhodes 8ths share the arp's register: stream segregation by
    //   octave distance (Bregman) instead of two interleaved mid-range lines
    if (b.padStyle === "broken") b.arpOct = 12;
    // – one answerer: blips and brass both answer the hook, and two
    //   answerers at once is chatter, not a conversation. Brass only ever
    //   rolls in the chorus, so the chorus keeps the brass; the last-chorus
    //   payoff in loadPart stays the sanctioned everything-moment
    if (b.blips && b.brassy) b.blips = false;
    // – broken and gate ARE the eighth-note figure; a melodic bass line is
    //   a second one, and two interleaved figures bury the pulse the groove
    //   needs (Witek) — the bass melody belongs under wash and keys
    if (b.padStyle === "broken" || b.padStyle === "gate") b.bassMel = null;
    return b;
  }
  // ---- album DNA -----------------------------------------------------------
  // "So far it sounds like variations of the same track." Accurate: pieces
  // differed in key, mood and hook, but shared the four-on-floor kick, the
  // hat grid, the swing and the hook's instrument — exactly the dimensions
  // listeners use to tell one song on an album from the next. So every piece
  // rolls a RECIPE: a curated frame (groove template, lead instrument, bass
  // curation) inside which the generative material is rolled as before.
  // Quality lives in the frame — each recipe is a proven song shape, not a
  // dice product; variety lives in the filling. Same doctrine as the chord
  // styles: curation over free combinatorics, pools as data.
  const GROOVES = {
    // the founding sound: four-on-floor, offbeat hats, trait-gated backbeat
    four: { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snareAt: [4, 12],
      ghostAt: [7, 10, 15], coreSnare: false, kickW: 1, swing: 0.22 },
    // funk strut: broken kick (one, and-of-two, and-of-three), swung harder
    broken: { kick: [0, 6, 10], hat: [2, 6, 10, 14], snareAt: [4, 12],
      ghostAt: [7, 15], coreSnare: false, kickW: 1, swing: 0.3 },
    // halftime dub: half the kicks, twice the weight, the snare owns the
    // THREE — the backbone, so it plays whatever the mood rolled — and no
    // ghost chatter, because the space is the point
    half: { kick: [0, 10], hat: [4, 12], snareAt: [8],
      ghostAt: [], coreSnare: true, kickW: 1.15, swing: 0.16 },
    // glam stomp, nearly straight: heavy four with a backbeat that always
    // speaks — arena drums under the fuzz bass, no ghost chatter
    stomp: { kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snareAt: [4, 12],
      ghostAt: [], coreSnare: true, kickW: 1.1, swing: 0.08 },
  };
  // bass entries are BASSPATS indices: one rhythmic protagonist per recipe —
  // a broken kick over a funk-push bass is two soloists fighting (Bregman),
  // and halftime keeps only the laid-back pattern with the holes in it
  // palettes: the recipe curates its harmonic language the way it curates
  // its bass patterns — the colossus is the Muse drama (lament/modal), the
  // dub is open space (sus/modal), the strut never walks the lament; club
  // stays the generalist (null = whatever the mood offers). hrs: the stomp
  // lives on a straight pulse (Witek: groove is an inverted U over
  // syncopation), so anticipated chords are the one thing it never does
  const RECIPES = [
    { name: "club", groove: "four", lead: "guitar", bass: [0, 1, 2],
      palettes: null, hrs: null },
    { name: "strut", groove: "broken", lead: "square", bass: [0, 2],
      palettes: ["light", "modal"], hrs: null },
    { name: "dub", groove: "half", lead: "warm", bass: [2],
      palettes: ["sus", "modal"], hrs: null },
    // the Muse element: the bass is the star. The hook moves into a fuzz
    // bass an octave down, the drums stomp nearly straight, and the bass
    // pattern drives in 8ths — Bregman still holds: ONE protagonist
    { name: "colossus", groove: "stomp", lead: "fuzz", bass: [3],
      palettes: ["lament", "modal"], hrs: ["bar", "twobar"] },
  ];
  // the mood curates the recipes the way it curates palette, arc and world:
  // deep never stomps or struts (introspection has no glam), anthem never
  // drops to halftime at its peak. This ended the field-report combination
  // "colossus in a Deep organic piece" — nothing sounded wrong, but the
  // frame and the mood told different stories, so no groove emerged
  const RECIPE_POOL = {
    deep: ["club", "dub"],
    neutral: ["club", "strut", "dub"],
    anthem: ["club", "strut", "colossus"],
  };

  // ---- story arc -----------------------------------------------------------
  // "Every piece should carry its own emotion, story, character." The craft
  // gap was INSIDE the piece: parts returned with identical density, so verse
  // one and verse three stood on the same stage — the piece RAN instead of
  // TELLING. Composers stage a piece (sparse open, growth, peak near the end,
  // strip-back before it), and the cheapest, strongest tool for that is the
  // arrangement ladder: WHICH materials speak is decided by where the piece
  // stands, not only by what the bundle rolled. So every piece rolls an ARC —
  // one stage value per form slot — and the stage gates the ornament family
  // when a part is loaded. The materials still return; the arc decides which
  // of them are on stage THIS time. The drive keeps modulating vertically
  // inside the scene, untouched — same two-axis layering as film scoring.
  const ARCS = {
    // the classic silhouette: sparse open, growth, peak at two thirds
    classic: [0.3, 0.5, 0.7, 0.55, 0.85, 0.7, 1],
    // patience — each part adds, nothing leaves, the peak is the end
    slowburn: [0.2, 0.35, 0.5, 0.6, 0.75, 0.9, 1],
    // opens hot, breathes mid-piece, double peak at the end
    banger: [0.7, 1, 0.8, 1, 0.6, 0.9, 1],
  };
  // the mood picks the character: deep never opens hot, anthem never crawls —
  // the set wave gets narrative teeth beyond density
  const ARC_POOL = {
    deep: ["slowburn", "classic"],
    neutral: ["classic", "slowburn", "banger"],
    anthem: ["banger", "classic"],
  };
  // which stage a material needs before it may speak. Kick, bass, hats and
  // the chord bed are NEVER gated here — even the barest part must groove
  const ARC_GATE = { brassy: 0.6, blips: 0.5, ghosts: 0.45, bassFill: 0.35,
    lick: 0.4, snareGhosts: 0.55, hookLift: 0.8 };

  // ---- scene scoring -------------------------------------------------------
  // The drive is the film and this engine writes the score — and a score
  // knows which SCENE it is in. Until now the engine saw only speed and
  // force: the same standstill got the same music whether the driver was
  // buckling up, waiting at a light, or crawling through a jam. Five scenes,
  // classified from what the engine already has (speed history, session age,
  // the GPS reader's reversal flag) — never from anything a driver cannot
  // feel themselves:
  //   ouverture  never yet cruised: ease in, the driver is parking out
  //   free       ordinary driving — the arc plays at full stage
  //   breath     a short stop inside flowing traffic: a held, UNRESOLVED sus
  //              chord; the departure itself is the resolution
  //   patience   stop-and-go: de-arousal — capped stage, softer kick, no
  //              arrival parade. Entered on a hard cut, deliberately: abrupt
  //              transitions calm better in high-demand traffic (v.d.Zwaag)
  //   coda       reversal + stop = probably parked. A staged farewell that
  //              ends on a resolution — and cancels without ceremony if the
  //              drive goes on, because a wrong coda must cost nothing
  // The scene CAPS the story arc's stage: scene outside, arc inside, the
  // drive modulating inside both — three nested layers, film-score style.
  const SCENE_CAP = { ouverture: 0.35, free: 1, breath: 1, patience: 0.45 };
  const OUVERTURE_KMH = 15, OUVERTURE_HOLD_S = 5;
  const STOP_WINDOW_MS = 90000, STOPS_FOR_PATIENCE = 3;
  const CODA_ARM_KMH = 12, CODA_ARM_MS = 30000, CODA_CONFIRM_MS = 5000;
  const CODA_RAMP_MS = 20000, CODA_CANCEL_KMH = 10;
  // the parade is a celebration, and neither a jam nor a farewell is the
  // place for one — the quiet landing still resolves every sprint
  const paradeAllowed = () =>
    engine.scene !== "patience" && engine.scene !== "coda";

  function classifyScene(dt, speed, rev) {
    const e = engine;
    // stop bookkeeping: a completed moving→stopped transition is one stop
    if (speed > 10) e.wasMoving = true;
    if (e.wasMoving && speed < 2) { e.stopLog.push(clock); e.wasMoving = false; }
    while (e.stopLog.length && clock - e.stopLog[0] > STOP_WINDOW_MS) e.stopLog.shift();
    // the ouverture ends once, on the first sustained real driving
    if (!e.everCruised) {
      e.cruiseHold = speed > OUVERTURE_KMH ? e.cruiseHold + dt : 0;
      if (e.cruiseHold >= OUVERTURE_HOLD_S) e.everCruised = true;
    }
    // a reversal ARMS the coda; only a stop confirms it — a three-point turn
    // has the same kinematics and differs only in what happens next
    if (rev && speed < CODA_ARM_KMH && e.everCruised) {
      e.revArmedUntil = clock + CODA_ARM_MS;
    }
    const stoodFor = e.standstillSince != null ? clock - e.standstillSince : 0;

    let next;
    if (e.scene === "coda" && speed <= CODA_CANCEL_KMH) {
      next = "coda";
      e.codaProgress = clamp((clock - e.codaAt) / CODA_RAMP_MS, 0, 1);
    } else if (e.scene !== "coda" && clock < e.revArmedUntil &&
        stoodFor > CODA_CONFIRM_MS) {
      next = "coda";
      e.codaAt = clock; e.codaProgress = 0; e.codaResolved = false;
    } else {
      if (e.scene === "coda") { // cancelled: the drive goes on
        e.codaAt = null; e.codaProgress = 0; e.codaResolved = false;
        e.revArmedUntil = -1;
      }
      next = !e.everCruised ? "ouverture"
        : e.stopLog.length >= STOPS_FOR_PATIENCE ? "patience"
        : stoodFor > 1500 ? "breath" : "free";
    }
    if (next !== e.scene) {
      if (next === "patience" || next === "coda") e.sceneHushPending = true;
      e.scene = next;
      e.gatesDirty = true;
    }
    e.sceneCap = e.scene === "coda"
      ? clamp(1 - 0.8 * e.codaProgress, 0.2, 1) : SCENE_CAP[e.scene];
  }

  // the scene caps the arc: which materials speak is decided by the SMALLER
  // of "where the piece stands" and "what the scene allows". Gating always
  // derives from the part's rolled flags, so a lifted cap can bring a
  // material BACK — a one-way mutation could only ever remove
  // reorchestration: apply a world's presets to the existing voices — swap,
  // never stack, the same nodes in new colors. Called at part boundaries
  // only, right before the hush, so a mid-note oscillator change never sounds
  function applySoundWorld(name) {
    const W = SOUNDWORLDS[name];
    if (!W || !kickS) return;
    kickS.set({ pitchDecay: W.kick.pitchDecay, octaves: W.kick.octaves,
      envelope: { decay: W.kick.decay } });
    hatC.set({ envelope: { decay: W.hat.closed } });
    hatO.set({ envelope: { decay: W.hat.open } });
    snareS.set({ envelope: { decay: W.snare.decay } });
    bassS.set({ oscillator: opts.lite ? { type: W.bass.lite } : W.bass.osc });
    // the bass cutoff is automated per NOTE (drive-dependent formula in
    // bassNote), so a static filter write here would be a no-op overwritten
    // by the next note — build 36 shipped exactly that bug. The world
    // recolors by SCALING that formula instead, anchored on analog's park,
    // so analog scales by exactly 1. ONE mechanism, on purpose
    engine.worldCutScale = W.bass.lp / SOUNDWORLDS.analog.bass.lp;
    // the world's room: a factor on the shared reverb send — organic
    // breathes, neon stands close. One send, one knob, no second reverb
    engine.worldRoom = W.room || 1;
    padS.set({ oscillator: opts.lite ? { type: W.pad.lite } : W.pad.osc,
      envelope: { attack: W.pad.attack, release: W.pad.release } });
    gateS.set({ oscillator: opts.lite ? { type: W.gate.lite } : W.gate.osc });
    blipS.set({ oscillator: W.blip.osc });
    if (worldBaseVol) {
      bassS.volume.value = worldBaseVol.bass + W.bass.trim;
      padS.volume.value = worldBaseVol.pad + W.pad.trim;
      gateS.volume.value = worldBaseVol.gate + W.gate.trim;
      blipS.volume.value = worldBaseVol.blip + W.blip.trim;
    }
    engine.worldApplied = name;
  }
  function applyStageGates() {
    const eff = Math.min(engine.stageBase, engine.sceneCap);
    engine.stage = eff;
    const r = engine.rolledFlags || {};
    engine.brassy = !!r.brassy && eff >= ARC_GATE.brassy;
    engine.blips = !!r.blips && eff >= ARC_GATE.blips;
    engine.ghosts = !!r.ghosts && eff >= ARC_GATE.ghosts;
    engine.bassFill = !!r.bassFill && eff >= ARC_GATE.bassFill;
    engine.lick = eff >= ARC_GATE.lick ? r.lick || null : null;
    engine.hookLift = !!r.hookLift && eff >= ARC_GATE.hookLift;
    engine.snareGhosts = eff >= ARC_GATE.snareGhosts;
  }

  // hook riff: the piece's identity. Earworm research says simple — small
  // range, plain contour, ONE twist; songwriting craft says rhythm-first,
  // 3–5 notes, the rests ARE the hook. This is NOT a melody, on purpose.
  const HOOKCELLS = [
    [[0, 2, 1], [3, 1, 0.7], [6, 2, 0.9], [10, 2, 0.8], [12, 3, 1]],
    [[0, 1, 1], [2, 1, 0.7], [4, 2, 0.9], [10, 2, 1], [14, 2, 0.8]],
    [[0, 3, 1], [4, 1, 0.7], [6, 2, 1], [12, 3, 0.9]],
    // dotted lengths: lines must not live on straight halves and quarters
    // alone — the lilt of a dotted 8th is variance the ear counts as intent
    [[0, 1.5, 1], [3, 1.5, 0.7], [6, 2, 0.9], [12, 3.5, 1]],
  ]; // [pos, dur16, accent — dur may be dotted (fractional)]
  const RIFFSET = [0, 3, 5, 7, 10, 12]; // A minor pentatonic over the root
  // the LEITMOTIF: film scoring's strongest device — one motif, returning
  // transformed by the scene. Rolled once per SET LAP (the 8-episode wave)
  // and persisted with the residency, it is the melodic DNA every piece of
  // the lap derives its hook from: the call IS the motif, the response is
  // re-answered per piece, the recipe decides the presentation. Recognition
  // inside the lap, freshness across laps — "ah, MY theme today"
  function genMotif(rnd) {
    const cell = HOOKCELLS[Math.floor(rnd() * HOOKCELLS.length)];
    let pi = 0;
    const used = new Set([RIFFSET[0]]);
    return cell.map(([p, d, a], i) => {
      if (i > 0 && rnd() >= 0.55) { // 55%: repeat the pitch — economy
        const cand = clamp(pi + (rnd() < 0.5 ? -1 : 1), 0, RIFFSET.length - 1);
        // a hook owns at most three pitches in its run — more is a scale, not a hook
        if (used.size < 3 || used.has(RIFFSET[cand])) { pi = cand; used.add(RIFFSET[pi]); }
      }
      if (i === cell.length - 1) pi = rnd() < 0.6 ? 0 : 4; // land home or b7
      return { p, d, a, s: RIFFSET[pi] };
    });
  }
  function genHook(motif, rnd) {
    const call = motif.map((n) => ({ ...n }));
    // response: identical rhythm, but a real answer — the middle of the line
    // sits a pentatonic 4th higher (contour change you can HEAR), then falls
    // to the answering tone. Changing only the last note reads as "same".
    const resp = call.map((n, i) => {
      if (i === 0) return { ...n };
      if (i === call.length - 1) return { ...n, s: RIFFSET[rnd() < 0.5 ? 3 : 1] };
      return { ...n, s: RIFFSET[Math.min(RIFFSET.indexOf(n.s) + 2, RIFFSET.length - 1)] };
    });
    return { call, resp };
  }
  function newPiece() {
    // harmonic anchors walk the progression graph: verse where we are,
    // chorus and bridge on neighbours. "Where we are" includes the previous
    // DRIVE: after a resume, engine.progIdx and setPrev carry the old set's
    // position, so the walk and the key-avoidance continue across the boundary
    const prev = engine.piece || engine.setPrev;
    const num = prev ? prev.num + 1 : 1;
    // the wave, not the dice: the episode number decides the mood
    const mood = SET_WAVE[(num - 1) % SET_WAVE.length];
    // the recipe: the piece's frame, drawn from the MOOD's pool (the
    // combination matrix — deep never stomps, anthem never drops to
    // halftime). Never the same one twice in a row — that rotation is what
    // makes consecutive pieces read as different SONGS. Rolled BEFORE the
    // palette, because the frame curates its harmonic language
    const recipePool = RECIPE_POOL[mood].map((n) => RECIPES.find((r) => r.name === n));
    const recipe = pick(recipePool,
      engine.piece ? RECIPES.find((r) => r.name === engine.piece.recipe) : null,
      dicer("recipe:" + num));
    // the palette: the piece's harmonic world — the mood's pool, narrowed
    // by the recipe's language (a funk strut never walks the lament). The
    // walk continues inside a palette and RESETS to home when the palette
    // changes — and the reset is what makes the change safe, because index 0
    // opens on the Am9 pivot voicing in every palette
    const prevPal = engine.piece ? engine.piece.paletteName
      : engine.setPrev ? engine.setPrev.pal : null;
    const moodPal = PALETTE_POOL[mood];
    const palPool = recipe.palettes
      ? moodPal.filter((p) => recipe.palettes.includes(p)) : moodPal;
    const paletteName = pick(palPool.length ? palPool : recipe.palettes,
      null, dicer("palette:" + num));
    const P = PALETTES[paletteName];
    const walk = dicer("walk:" + num);
    const pA = paletteName === prevPal ? engine.progIdx : 0;
    const pB = pick(P.next[pA], null, walk);
    const pC = pick(P.next[pB], null, walk);
    // the arc: the piece's character — where its peak lies. Chosen from the
    // mood's pool, so the wave shapes the story, not only the density
    const arcName = pick(ARC_POOL[mood], null, dicer("arc:" + num));
    // the sound world: the piece's orchestra, drawn from the mood's pool and
    // never the same twice in a row — consecutive tracks must not share a
    // sound, exactly the recipe's rotation rule
    const world = pick(WORLD_POOL[mood], engine.piece ? engine.piece.world : null,
      dicer("world:" + num));
    const A = rollBundle("verse", pA, mood, null, recipe, dicer("bundle:A:" + num));
    const B = rollBundle("chorus", pB, mood, A, recipe, dicer("bundle:B:" + num)); // chorus must contrast the verse
    const C = rollBundle("bridge", pC, mood, B, recipe, dicer("bundle:C:" + num)); // bridge must contrast the chorus
    // the leitmotif renews with the LAP, never with the piece: a fresh set
    // and every return to the wave's start roll a new theme, everything in
    // between inherits — across drives, via the residency
    if (!engine.setMotif || (num - 1) % SET_WAVE.length === 0) {
      engine.setMotif = genMotif(dicer("motif:" + num));
    }
    engine.piece = {
      num,
      recipe: recipe.name, groove: recipe.groove, lead: recipe.lead,
      arcName,
      paletteName,
      world,
      // a COPY: a launch rewrites this piece's script, and mutating the shared
      // pool entry would corrupt the form for every piece that follows
      form: pick(FORMS, null, dicer("form:" + num)).slice(),
      idx: 0,
      pulled: false,
      tp: pick(TRANSPOSES, prev ? prev.tp : null, dicer("tp:" + num)),
      mood,
      parts: { A, B, C },
      hook: genHook(engine.setMotif, dicer("hook:" + num)),
    };
    // persist the episode as it BEGINS: a drive can end anywhere inside it,
    // and the next drive should resume as if this piece finished. Every form
    // closes on the chorus, so pB is where the walk stands when it ends
    saveSet(num, engine.piece.tp, pB, engine.setMotif, paletteName);
  }
  function loadPart(t) {
    const piece = engine.piece;
    const label = piece.form[piece.idx];
    const b = piece.parts[label];
    const P = PALETTES[piece.paletteName];
    Object.assign(engine, {
      progIdx: b.progIdx, prog: P.progs[b.progIdx], roots: P.roots[b.progIdx],
      hr: b.hr, bassPat: b.bassPat, bassMel: b.bassMel,
      arpSeq: b.arpSeq, arpOct: b.arpOct, ghosts: b.ghosts, bassFill: b.bassFill,
      blips: b.blips, brassy: b.brassy, snare: b.snare, padStyle: b.padStyle,
    });
    // the piece's key: F() reads tp, the thrust drone must follow the tonic
    tp = engine.piece.tp;
    if (thrustSub) thrustSub.frequency.value = F(33);
    // the piece's orchestra: reorchestrate at the boundary (the hush below
    // covers the seam), and only when the world actually changes
    if (engine.worldApplied !== piece.world) applySoundWorld(piece.world);
    // the piece's frame: groove template, lead voice, and the swing that
    // belongs to the groove (Transport-level — the step length never moves)
    engine.recipe = engine.piece.recipe;
    engine.grooveName = engine.piece.groove;
    engine.groove = GROOVES[engine.piece.groove];
    engine.lead = engine.piece.lead;
    if (transport) transport.swing = engine.groove.swing;
    // per-occurrence freshness: ornaments re-roll, one trait may flip.
    // One keyed stream per (piece, slot): this occurrence's rolls can never
    // shift another part's — see the composition dice above
    const occ = dicer("occ:" + piece.num + ":" + piece.idx);
    engine.lick = occ() < 0.4 ? LICKS[Math.floor(occ() * LICKS.length)] : null;
    engine.blipSeq = BLIPS[Math.floor(occ() * BLIPS.length)];
    engine.syncPos = SYNCPOS[Math.floor(occ() * SYNCPOS.length)];
    engine.partLabel = label;
    engine.brokenPat = BROKENPATS[Math.floor(occ() * BROKENPATS.length)];
    engine.gatePat = GATEPATS[Math.floor(occ() * GATEPATS.length)];
    // an octave up is the most piercing thing the hook can do; keep it rare
    engine.hookLift = occ() < 0.2;
    if (occ() < 0.3) engine.ghosts = !engine.ghosts;
    // the story arc: the slot's stage decides which of the returning
    // materials speak THIS time. The rolled flags are recorded after every
    // per-occurrence roll — a re-rolled lick or a flipped ghost trait must
    // not sneak past the arc — and the gates derive from them, so a scene
    // whose cap moves mid-part can re-gate without re-rolling
    engine.stageBase = ARCS[piece.arcName][piece.idx];
    engine.rolledFlags = { brassy: engine.brassy, blips: engine.blips,
      ghosts: engine.ghosts, bassFill: engine.bassFill, lick: engine.lick,
      hookLift: engine.hookLift };
    // the last chorus gets everything: pop practice — the final return
    // carries the ornaments the earlier ones held back. The gate style
    // keeps its curation (the gate IS the foreground rhythm, brass and
    // blips would fight it — Bregman outranks the payoff)
    if (label === "B" && piece.idx === piece.form.lastIndexOf("B") &&
        engine.padStyle !== "gate") {
      engine.rolledFlags.brassy = true;
      engine.rolledFlags.blips = true;
      engine.rolledFlags.hookLift = true;
    }
    applyStageGates();
    rebalance();
    // lingering notes must not carry the old harmony — or, at a piece
    // boundary, the old KEY — into the new part. The pads were released here
    // already; the sustained highway root, the gate's long tails and the
    // Rhodes were not, and a bass drone from the previous key sounding under
    // the new one is exactly "the instruments don't fit together"
    hush(t);
  }
  // Every combination of layers has to land on the same loudness — that is the
  // whole discipline of vertical layering, and it cannot be done by tuning
  // each voice, because the voices are chosen at runtime. Uncorrelated sources
  // sum in POWER, so N similar layers are about sqrt(N) louder than one; the
  // family level therefore tracks sqrt(reference / N). The moves are small on
  // purpose (about ±1 dB): this is levelling, not an effect
  function rebalance() {
    if (!busHarm) return;
    let n = 1;                                     // the arp is always there
    if (engine.padStyle === "gate") n += 2;        // the pad bed AND the gate
    else if (engine.padStyle === "broken") n += 1; // a Rhodes figure, no bed
    else n += 1;                                   // wash or keys: the bed
    if (engine.blips) n += 0.6;
    if (engine.brassy) n += 0.6;
    busHarm.gain.rampTo(clamp(Math.sqrt(2.8 / n), 0.75, 1.15), 0.5);
  }

  // silence everything that can still be ringing from the previous harmony
  function hush(t) {
    padS.releaseAll(t); padTri.releaseAll(t); gateS.releaseAll(t);
    bassSubS.triggerRelease(t);
    if (rhodes && rhodes.loaded) rhodes.releaseAll(t);
  }

  // swing lives in the Tone.js Transport now — hum() only adds micro-jitter
  // micro-timing only ever pushes LATE. A jitter that can move a note earlier
  // can invert the order of two events on the same voice, which Tone refuses
  // outright — and human players drag, they do not anticipate
  function hum(t, pos) { void pos; return t + Math.random() * 0.005; }
  function vel(v) { return v * (0.85 + Math.random() * 0.3); }
  // which chord of the 4-slot progression a bar sits on — the ONE place the
  // harmonic-rhythm arithmetic lives, so a fifth hr type cannot miss a site
  const chordIdx = (bar, hr) => (hr === "twobar" ? Math.floor(bar / 2) % 4 : bar % 4);

  const engine = {
    running: false,
    energy: 0,
    launchBoost: 0,
    prevEst: 0,
    accelEst: 0,
    thrust: 0,
    brake: 0,
    urban: 0,
    wake: 0,          // how far the rhythm section has faded in, 0..1
    flowFade: 0,      // how far the motorway layer has faded in, 0..1
    fillAt: -1,
    prog: null,   // the section object: rolled ONCE per boundary, only read in steps
    roots: null,
    bassPat: null,
    arpSeq: null,
    arpOct: 0,
    hr: "bar",
    fill: "toms",
    drumFill: null,   // the bar's chosen fill phrase, or null
    ghosts: false,
    bassFill: false,  // Daði: octave pops + approach notes into the next chord
    blips: false,     // Daði: square-wave answers to the arp
    blipSeq: null,
    brassy: false,    // Parov: anticipated brass stab on the and-of-four
    lick: null,       // playful bass figure, once per 8-bar phrase
    lickFlashUntil: 0,
    bassMel: null,    // the pattern itself turns melodic: root/fifth/octave/seventh
    syncPos: 12,      // where a "sync" section lets the next chord arrive
    snare: false,     // backbeat + ghost-note chatter
    padStyle: "wash", // chord instrumentation: wash / keys / broken / gate
    brokenPat: null,
    gatePat: null,
    barInPart: 0,
    stage: 1,        // the story arc's stage for the current part, 0..1
    stageBase: 1,    // the arc's own stage, before the scene caps it
    sceneCap: 0.35,  // what the scene allows — the session opens easy
    rolledFlags: null, // the part's rolled ornaments, pre-gate
    gatesDirty: false, // the cap moved: re-gate on the next barline
    sceneHushPending: false, // patience/coda enter on a hard cut
    scene: "ouverture",
    everCruised: false,
    cruiseHold: 0,
    stopLog: [],     // clock stamps of moving→stopped transitions
    wasMoving: false,
    revArmedUntil: -1,
    codaAt: null,
    codaProgress: 0,
    codaResolved: false,
    susVoiced: 0,    // how often the breath held its sus chord
    snareGhosts: false, // ghost chatter needs the stage, not only the trait
    lean: false,     // the device is overloaded: play less, not nothing
    hookLift: false,
    pullChorus: false, // a launch pulls the chorus forward at the next boundary
    dropAt: -1,        // step index of a scheduled drop-gap release
    liftActive: false,
    riseOn: false,    // rise-figure engagement latch (thrust hysteresis)
    warp: 0,          // auditory exclusion under hard push, 0..1
    flowOn: false,    // latched highway-harmony switch (hysteresis, barline only)
    flowStartBar: 0,  // when the highway latched on — the lift hazard's clock
    liftStart: -1,    // bar the current lift began, -1 = pedal phase
    liftArm: -1,      // bar the armed lift will begin (4 build bars before it)
    lastLiftEnd: -1e9,
    progIdx: 0,       // position in the progression graph
    piece: null,      // the current piece: form script + part bundles + hook
    partLabel: "",
    standstillSince: null,
    armed: false,
  };

  // ---- Tone.js graph -------------------------------------------------------

  let raw = null, noiseBuf = null;
  let nodes = [];
  const reg = (n) => { nodes.push(n); return n; };
  // Tone's PolySynth defaults to 32 voices and DROPS a note once they are all
  // busy — with 1.6 s pad releases and four-note voicings that ceiling is
  // reachable, and a dropped note is heard as a beat that didn't happen.
  // maxPolyphony is a PolySynth property, not a voice option: passing it in
  // the constructor's options object silently does nothing
  const poly = (p, n) => { try { p.maxPolyphony = n; } catch (err) { void err; } return p; };

  let master, comp, limiter, makeup, tensionLp, masterHp, panner, duck, dry;
  let carLow, carPres;
  let depthLp, depthGain;
  let busDrums, busBass, busHarm, busLead, busFx;
  let revSend, reverb, delaySend, delayRet, chorus;

  // Scheduler slack. 250 ms is the base; a device that has proven it can fall
  // behind that once gets 500 ms for the rest of the session — the evidence
  // does not expire when the watchdog rebuilds the graph
  const LOOK_BASE = 0.25, LOOK_RAISED = 0.5;
  let lookRaised = false;

  // Latency is the one resource this app has to spare: nothing is played
  // live, every event is scheduled a quarter second ahead, and the drive's
  // input is a second old before it arrives. Tone's default context asks the
  // browser for "interactive" — its SMALLEST render quantum, headroom traded
  // for a reflex nobody here needs. "playback" reverses the trade: render
  // buffers several times larger, which on a weak device is the difference
  // between a load spike being absorbed and being heard as a crack. Created
  // once, BEFORE any node exists — a node built earlier would land on the
  // default context and stay there
  let ctxConfigured = false;
  function configureContext() {
    if (ctxConfigured) return;
    ctxConfigured = true;
    try {
      if (typeof Tone.Context === "function" && typeof Tone.setContext === "function") {
        Tone.setContext(new Tone.Context({ latencyHint: "playback", lookAhead: LOOK_BASE }));
      }
    } catch (err) { void err; }
  }
  // Spatial behaviour is a QUESTION, not a setting: whether the inertial
  // direction feels right can only be answered in a moving car, and an answer
  // needs an A and a B. Both default to the congruent reading
  // A phone or a car head unit is not a laptop. "lite" trades the expensive
  // parts of the graph — a long convolution reverb, three-oscillator supersaws,
  // a chorus — for the same arrangement at a fraction of the cost. It is
  // detected rather than asked about, and takes effect on the next start
  // because it is built into the graph
  const lowPower = (() => {
    try {
      if (typeof navigator === "undefined") return false;
      if (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 6) return true;
      return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    } catch (err) { void err; return false; }
  })();
  const opts = { curveOutward: true, inertiaDepth: true, lite: lowPower, carMix: true };

  // Control-rate writes. Setting an AudioParam's .value schedules a STEP, and
  // fifteen of them sixty times a second is nine hundred discontinuities per
  // second in the signal — which is heard as crackle, most obviously on gains.
  // Every continuous control now moves as a short ramp, and only when it has
  // actually changed enough to matter
  const ctlLast = new Map();
  function ctl(param, key, value, tol, ramp = 0.04) {
    if (!param) return;
    // ONE non-finite value is "a crack, then silence": the step is heard as a
    // click and from then on the node feeds NaN to everything downstream, which
    // renders as permanent quiet. Nothing that cannot be reasoned about gets
    // past here, and the fact that it happened is worth more than the value
    if (!Number.isFinite(value)) { note("param", key + " = " + value); return; }
    const prev = ctlLast.get(key);
    if (prev != null && Math.abs(value - prev) < tol) return;
    ctlLast.set(key, value);
    param.rampTo(value, ramp);
  }
  let kickS, heartS, tomS, hatC, hatO, shakerS, percS;
  let bassS, bassLp, growlS, growlLp, thrustSub, thrustSubGain;
  // the calibrated base volumes of the four voices the world trims may move —
  // captured at build time so a rebuild always re-anchors on the fresh park
  let worldBaseVol = null;
  let brakeNoise, brakeLp, brakeGain, brakeOsc, brakeOscGain;
  let stretchNoise, stretchBp, stretchGain;
  let padS, padTri, padHp, padLp, arpS, arpLp, stabS, stabLp;
  // staging: depth sends, static stage placement, and the air bed
  let padRevG, gateRevG, snareSendG;
  // the warp: the music band's own filter + gain, and the drive voices' own
  // dry lane past it — auditory exclusion needs a near/far split by ROLE
  let warpLp, warpGain, busDrive;
  let snareSnap, snareBp; // snare v2: the crack, and the wandering band-pass
  let hatPan, shakerPan, percPan, tomPan, blipPan, arpPan, rhodesPan;
  let atmoNoise, atmoLp, atmoGain;
  let blipS, brassS, brassLp, bassSubS, snareS, snareBody, hookS, leadTri, gateS, gateAmp, gateLp;
  let hookThrowG; // the delay throw's dedicated send — a gesture, not a level
  let leadFuzz;   // colossus: the hook in the hands of a fuzz bass
  // the rise figure: its own pool of mono voices — overlapping entries on one
  // synth would collide on the per-voice timeline (see the stub's rule)
  let riseS = [], riseLp = [], riseHp;
  let riseVoices = [], riseLog = [], riseNextAt = 0;
  let risePeak = 0, riseArrivalAt = -1;
  let riseHot = 0, riseFull = false, riseLastFullAt = -Infinity;
  // sampled instruments persist across play cycles — buffers load once
  let rhodes = null, hookGit = null;
  function ensureSamplers() {
    if (rhodes) return;
    hookGit = new Tone.Sampler({
      urls: { A3: "A3.mp3", C4: "C4.mp3", Eb4: "Eb4.mp3", Gb4: "Gb4.mp3", A4: "A4.mp3", C5: "C5.mp3" },
      baseUrl: "samples/guitar/",
    });
    rhodes = new Tone.Sampler({
      urls: { A2: "A2.mp3", C3: "C3.mp3", Eb3: "Eb3.mp3", Gb3: "Gb3.mp3", A3: "A3.mp3",
        C4: "C4.mp3", Eb4: "Eb4.mp3", Gb4: "Gb4.mp3", A4: "A4.mp3", C5: "C5.mp3" },
      baseUrl: "samples/rhodes/",
    });
  }
  // How much of each sixteenth's budget the scheduler spends. It measures the
  // MAIN thread, not the audio renderer — no browser exposes an underrun
  // counter — but a step callback that eats its own budget is the shape of a
  // device that cannot keep up, and it is the only number a field test can
  // bring home
  let stepCost = 0, peakCost = 0;
  // Graceful degradation. At 87 % of a step's budget the scheduler is one
  // spike away from falling behind, and falling behind is heard as the music
  // stopping. Rather than die, the arrangement thins itself: the ornaments go
  // first, then the chord figures collapse to a plain pad. Simpler music beats
  // no music, and it recovers on its own when the device catches up
  let strain = 0, strainSteps = 0, totalSteps = 0;
  let lateSteps = 0, worstLate = 0;
  // "it stopped" and "I cannot hear it" are different faults. If notes are
  // still being triggered while nothing is audible, the sequencer is fine and
  // the problem is downstream — no report could tell those apart before
  let notes = 0, idleCut = 0, dropCount = 0;
  // A ring of what actually went wrong, on the device it went wrong on. There
  // is no console to read in a car, so the engine keeps its own short record
  const events = [];
  let errCount = 0, resumes = 0, lastResumeAt = 0;
  function note(kind, text) {
    events.push({ at: Math.round(clock), kind, text: String(text).slice(0, 160) });
    if (events.length > 40) events.shift();
  }
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ---- render-thread probe -------------------------------------------------
  // stepCost measures the MAIN thread; a crackle is made on the RENDER thread,
  // where a missed deadline drops audio frames — an underrun. Newer Chromium
  // exposes that as RenderCapacity, and where it exists it is not a proxy for
  // the fault, it IS the fault: underrunRatio > 0 means the output glitched.
  // So an underrun feeds the same strain machine that main-thread overload
  // feeds, and the arrangement thins in answer to the actual mechanism
  let renderCap = null, renderLoad = -1, renderPeak = -1, underrunWins = 0;
  function startRenderProbe() {
    renderLoad = -1; renderPeak = -1; underrunWins = 0;
    try {
      const c = Tone.getContext();
      const cap = c && c.rawContext && c.rawContext.renderCapacity;
      if (!cap || typeof cap.start !== "function") return;
      renderCap = cap;
      cap.onupdate = (e) => {
        try {
          const avg = Number(e && e.averageLoad);
          const peak = Number(e && e.peakLoad);
          const ur = Number(e && e.underrunRatio);
          if (Number.isFinite(avg)) renderLoad = avg;
          if (Number.isFinite(peak)) renderPeak = Math.max(renderPeak, peak);
          if (Number.isFinite(ur) && ur > 0) {
            underrunWins++;
            strain = 1;
            if (underrunWins <= 3 || underrunWins % 20 === 0) {
              note("render", "underrun ratio " + ur.toFixed(3) + " at " +
                Math.round((Number.isFinite(avg) ? avg : 0) * 100) + "% render load");
            }
          } else if (Number.isFinite(peak) && peak > 0.85) {
            // no glitch yet, but one spike away from one — lean in early
            strain = Math.min(1, strain + 0.3);
          }
        } catch (err) { void err; }
      };
      cap.start({ updateInterval: 1 });
    } catch (err) { void err; }
  }
  function stopRenderProbe() {
    try {
      if (renderCap) {
        if (typeof renderCap.stop === "function") renderCap.stop();
        renderCap.onupdate = null;
      }
    } catch (err) { void err; }
    renderCap = null;
  }

  // ---- lean sheds the render-thread costs ----------------------------------
  // Thinning drops NOTES — main-thread work and voices — but the two
  // per-sample costs, the chorus (a modulated delay) and the convolution
  // reverb, kept running at full price for an arrangement that had already
  // gone simple. A disconnected subtree is not pulled by Web Audio at all, so
  // the shed is topological: cut the convolver's input, unhook the chorus and
  // wire the pad straight to its bus. State-machine guarded, so connect and
  // disconnect always come in pairs — and reversed the moment the device
  // catches up, at a barline like every other lean decision
  let fxShed = false;
  function setFxShed(on) {
    if (on === fxShed || !revSend) return;
    fxShed = on;
    note("fx", on ? "shedding chorus and room" : "chorus and room restored");
    try {
      if (on) {
        if (chorus) {
          padLp.disconnect(chorus);
          padLp.connect(busHarm);
          gateLp.disconnect(chorus);
          chorus.disconnect();
        }
        revSend.disconnect(reverb);
      } else {
        if (chorus) {
          padLp.disconnect(busHarm);
          padLp.connect(chorus);
          chorus.connect(busHarm);
          gateLp.connect(chorus);
        }
        revSend.connect(reverb);
      }
    } catch (err) { note("fx", (err && err.message) || err); }
  }

  let transport = null, repeatId = null;
  let stepIdx = 0;
  let pendingLaunchAt = -1;

  async function buildGraph() {
    const ctx = Tone.getContext();
    // A car browser is not a laptop: it shares one modest CPU with the
    // instrument cluster and repaints a large screen. Tone's default 0.1 s
    // look-ahead leaves the scheduler no slack there, and a late callback is
    // exactly the "one beat dropped out" artefact. Latency costs us nothing —
    // our input already arrives about a second late
    try { ctx.lookAhead = lookRaised ? LOOK_RAISED : LOOK_BASE; } catch (err) { void err; }
    raw = ctx.rawContext;
    if (!noiseBuf) {
      noiseBuf = raw.createBuffer(1, raw.sampleRate * 2, raw.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }

    master = reg(new Tone.Gain(0.0001));
    // Glue, not squash: the old -16 dB at 4:1 was doing mix-balance work that
    // belongs to the bus structure below. A limiter behind it is the safety
    // net — a generative arrangement has no fixed voice count, so peaks are a
    // matter of which layers happen to coincide
    comp = reg(new Tone.Compressor({ threshold: -14, ratio: 2.5, attack: 0.02, release: 0.25 }));
    limiter = reg(new Tone.Limiter(-1));
    // separate from master.gain, which the drop gap automates: two gestures
    // fighting over one parameter is how one of them gets cancelled
    makeup = reg(new Tone.Gain(1));
    tensionLp = reg(new Tone.Filter(18000, "lowpass"));
    masterHp = reg(new Tone.Filter(25, "highpass"));
    // The car voicing. Every room this product plays in is a car cabin —
    // the in-dash browser or a phone over Bluetooth into the same speakers —
    // and a cabin adds up to ~12 dB/octave below 70–90 Hz (cabin gain) while
    // road noise eats the quiet detail. So the master chain pre-answers the
    // room: the shelf hands the sub region back before the cabin doubles it,
    // the peak lifts the band the details live in. ON by default everywhere;
    // the bench keeps an A/B because the final decibel belongs to ears in
    // the actual car. Gains start flat — the ctl in update() breathes them
    // in, and the same ctl is what the A/B switch flattens them with.
    carLow = reg(new Tone.Filter({ frequency: 100, type: "lowshelf", gain: 0 }));
    carPres = reg(new Tone.Filter({ frequency: 3200, type: "peaking", Q: 0.8, gain: 0 }));
    panner = reg(new Tone.Panner(0));
    duck = reg(new Tone.Gain(1));
    dry = reg(new Tone.Gain(1));
    dry.connect(panner); duck.connect(panner);
    // Inertial DEPTH. The car browser gives us stereo and no access to the
    // fader, so a literal rearward shift is impossible — but distance is not
    // primarily a direction, it is a set of cues: more room relative to direct
    // sound, air absorption taking the top off, and a little less level. Under
    // acceleration the band recedes; under braking it comes forward, expressed
    // as DRYNESS alone, because the brake filter already owns brightness and two
    // gestures pulling the same parameter opposite ways cancel out
    depthLp = reg(new Tone.Filter(18000, "lowpass"));
    depthGain = reg(new Tone.Gain(1));
    panner.chain(depthLp, depthGain, tensionLp, masterHp, carLow, carPres,
      makeup, comp, master, limiter, Tone.getDestination());
    master.gain.rampTo(0.9, 0.1);

    // ---- submix buses ------------------------------------------------------
    // Vertical layering means the number of simultaneous voices is never the
    // same twice, and a static per-voice balance cannot be right for all of
    // them. Buses are how that stays predictable: each family keeps its own
    // internal balance, and the family level is what gets adjusted when the
    // arrangement thickens or the scene changes.
    // The high-passes are the other half. Pads, Rhodes, gate, arp, stabs and
    // brass all carry low-mid energy they do not need; six of them summing
    // under the bass is the muddiness that reads as "not well mixed". Below
    // ~120 Hz the bass and the kick own the mix alone
    busDrums = reg(new Tone.Gain(1));         // never ducked: the kick IS the duck
    busBass = reg(new Tone.Gain(1));
    busHarm = reg(new Tone.Gain(1));
    busLead = reg(new Tone.Gain(1));
    busFx = reg(new Tone.Gain(1));
    const harmHp = reg(new Tone.Filter(120, "highpass"));
    const leadHp = reg(new Tone.Filter(190, "highpass"));
    // a slow, shallow compressor on the harmony family smooths the difference
    // between a bare pad and a pad plus gate plus brass plus blips
    const harmComp = reg(new Tone.Compressor({ threshold: -22, ratio: 2,
      attack: 0.05, release: 0.35 }));
    busDrums.connect(dry);
    busFx.connect(dry);
    busBass.connect(duck);
    // the warp band: harmony and lead run through one shared lowpass+gain
    // that a hard push closes (the music recedes); the drive voices get
    // their own lane (busDrive) past it, so the force stays NEAR while the
    // world blurs — the acoustic version of stars becoming streaks
    warpLp = reg(new Tone.Filter(16000, "lowpass"));
    warpGain = reg(new Tone.Gain(1)); warpGain.gain.value = 1;
    busHarm.chain(harmHp, harmComp, warpLp);
    busLead.chain(leadHp, warpLp);
    warpLp.connect(warpGain); warpGain.connect(duck);
    busDrive = reg(new Tone.Gain(1)); busDrive.connect(duck);

    // space: real convolution reverb, returned through the duck so it pumps
    reverb = reg(new Tone.Reverb({ decay: opts.lite ? 1.2 : 2.6, preDelay: 0.02, wet: 1 }));
    await reverb.ready;
    revSend = reg(new Tone.Gain(0.4));
    const revRet = reg(new Tone.Gain(0.5));
    revSend.connect(reverb); reverb.connect(revRet); revRet.connect(duck);

    delaySend = reg(new Tone.Gain(0.2));
    const delay = reg(new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.35, wet: 1 }));
    delayRet = reg(new Tone.Gain(0.6));
    delaySend.connect(delay); delay.connect(delayRet); delayRet.connect(duck);

    // the chorus is a per-sample modulated delay on the widest bus; on a
    // modest CPU it is pure cost for a thickening nobody would miss
    chorus = opts.lite ? null
      : reg(new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.5, wet: 0.5 }).start());

    kickS = reg(new Tone.MembraneSynth({
      pitchDecay: 0.08, octaves: 1.9,
      envelope: { attack: 0.001, decay: 0.26, sustain: 0, release: 0.02 },
    }));
    kickS.volume.value = db(0.95); kickS.connect(busDrums);
    heartS = reg(new Tone.MembraneSynth({
      pitchDecay: 0.2, octaves: 1.4,
      envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.05 },
    }));
    heartS.volume.value = db(0.6); heartS.connect(busDrums);
    tomS = reg(new Tone.MembraneSynth({
      pitchDecay: 0.1, octaves: 1.2,
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.03 },
    }));
    tomS.volume.value = db(0.35);
    tomPan = reg(new Tone.Panner(0)); tomPan.pan.value = -0.22;
    tomS.connect(tomPan); tomPan.connect(busDrums);

    // Width is PLACEMENT: small static pans, the way a kit stands on a
    // stage — the anchors (kick, snare, bass) stay dead center so the car
    // mix keeps its spine, and the global curve panner still moves the whole
    // stage as one body
    const hatHp = reg(new Tone.Filter(8500, "highpass"));
    hatPan = reg(new Tone.Panner(0)); hatPan.pan.value = -0.12;
    hatHp.connect(hatPan); hatPan.connect(busDrums);
    hatC = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }));
    hatC.volume.value = db(0.2); hatC.connect(hatHp);
    hatO = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.26, sustain: 0 } }));
    hatO.volume.value = db(0.2); hatO.connect(hatHp);
    const shakerHp = reg(new Tone.Filter(6200, "highpass"));
    shakerPan = reg(new Tone.Panner(0)); shakerPan.pan.value = 0.18;
    shakerHp.connect(shakerPan); shakerPan.connect(busDrums);
    shakerS = reg(new Tone.NoiseSynth({ envelope: { attack: 0.015, decay: 0.055, sustain: 0 } }));
    shakerS.volume.value = db(0.16); shakerS.connect(shakerHp);
    const percBp = reg(new Tone.Filter({ frequency: 2600, type: "bandpass", Q: 5 }));
    percPan = reg(new Tone.Panner(0)); percPan.pan.value = -0.3;
    percBp.connect(percPan); percPan.connect(busDrums);
    percS = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }));
    percS.volume.value = db(0.25); percS.connect(percBp);

    // snare: noise crack + a short 185 Hz body; ghosts use the noise alone.
    // A whisper of the shared room glues it in — a bone-dry snare next to
    // wet pads reads as a preset, not a band
    snareBp = reg(new Tone.Filter({ frequency: 1800, type: "bandpass", Q: 0.9 }));
    snareBp.connect(busDrums);
    snareSendG = reg(new Tone.Gain(0.12)); snareSendG.gain.value = 0.12;
    snareBp.connect(snareSendG); snareSendG.connect(revSend);
    snareS = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }));
    snareS.volume.value = db(0.3); snareS.connect(snareBp);
    // snare v2 ("thin and mechanical, worst in the build"): a real snare is
    // noise + shell body + a bright CRACK. The snap layer is that crack —
    // highpassed noise, full backbeats only, so ghosts and rolls stay soft
    const snapHp = reg(new Tone.Filter(3800, "highpass")); snapHp.connect(busDrums);
    snapHp.connect(snareSendG);
    snareSnap = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.07, sustain: 0 } }));
    snareSnap.volume.value = db(0.22); snareSnap.connect(snapHp);
    snareBody = reg(new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 0.5,
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
    }));
    snareBody.volume.value = db(0.25); snareBody.connect(busDrums);

    // warm bass: triangle core (round, never rasping) — but triangles carry
    // ~6 dB less energy than saws, so the level and filter make up for it
    bassLp = reg(new Tone.Filter({ frequency: 480, type: "lowpass", Q: 0.8 }));
    bassS = reg(new Tone.Synth({
      oscillator: opts.lite ? { type: "triangle" } : { type: "fattriangle", count: 2, spread: 8 },
      envelope: { attack: 0.008, decay: 0.06, sustain: 0.85, release: 0.12 },
    }));
    bassS.volume.value = db(1.05); bassS.connect(bassLp); bassLp.connect(busBass);
    const bassSubLp = reg(new Tone.Filter({ frequency: 320, type: "lowpass", Q: 0.7 }));
    bassSubS = reg(new Tone.Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.3, decay: 0.2, sustain: 0.9, release: 0.5 },
    }));
    bassSubS.volume.value = db(0.3); bassSubS.connect(bassSubLp); bassSubLp.connect(busBass);

    // Daði charm: a cheeky square-wave blip voice answering the arp
    const blipLp = reg(new Tone.Filter({ frequency: 2200, type: "lowpass", Q: 1 }));
    blipS = reg(new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.06 },
    }));
    blipS.volume.value = db(0.09); blipS.connect(blipLp);
    blipPan = reg(new Tone.Panner(0)); blipPan.pan.value = 0.32;
    blipLp.connect(blipPan); blipPan.connect(busHarm);
    blipLp.connect(delaySend); blipLp.connect(revSend);

    // sampled color: Rhodes chords, mostly dry with a touch of the shared room
    ensureSamplers();
    rhodes.disconnect(); rhodes.volume.value = db(0.5);
    rhodesPan = reg(new Tone.Panner(0)); rhodesPan.pan.value = -0.18;
    rhodes.connect(rhodesPan); rhodesPan.connect(busHarm);
    rhodes.connect(revSend);

    // the gate voice: a chord pulsed by a rhythm mask. The hard trance gate —
    // saw, instant attack, instant release — is a chop, and a chop next to
    // this record's Rhodes and washes reads as brutal. Four standard softeners,
    // all of them here: SLEW the envelope (a 30 ms attack and a long release
    // make it pulse instead of cut), a WARM source (detuned triangles, no saw
    // buzz), a DARK filter, and a wet tail — chorus plus reverb keep sounding
    // through the closed steps, which is what makes a gate wash rather than
    // stutter. The fifth softener is elsewhere: a quiet sustained pad stays
    // underneath (see chordVoice), so the gate modulates a bed instead of
    // being the only thing there
    // A gate is a tremolo on a HELD chord — not the chord being replayed on
    // every sixteenth. Retriggering was both the harsh sound (forty fresh note
    // attacks a bar, each with its own transient) and a real load: around
    // thirty overlapping voices at all times, on a CPU that also drives the
    // car's screen. One sustained chord through an automated gain is what the
    // effect actually is, costs four voices instead of forty, and lets the
    // gate close to a floor instead of to nothing
    const gateHp = reg(new Tone.Filter({ frequency: 180, type: "highpass" }));
    gateLp = reg(new Tone.Filter({ frequency: 1050, type: "lowpass", Q: 0.5 }));
    gateAmp = reg(new Tone.Gain(0));
    gateS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: opts.lite ? { type: "triangle" } : { type: "fattriangle", count: 2, spread: 12 },
      envelope: { attack: 0.35, decay: 0.2, sustain: 1, release: 0.8 },
    }));
    gateS.volume.value = db(0.3);
    poly(gateS, 12);
    gateS.connect(gateAmp); gateAmp.connect(gateHp); gateHp.connect(gateLp);
    if (chorus) gateLp.connect(chorus);
    gateLp.connect(busHarm);
    gateRevG = reg(new Tone.Gain(1.35)); gateRevG.gain.value = 1.35;
    gateLp.connect(delaySend); gateLp.connect(gateRevG); gateRevG.connect(revSend);

    // The hook lead has to be AUDIBLE without being a guest. Two rounds went
    // past the target in opposite directions: first thinned until it vanished,
    // then given a 5 dB presence peak, an open lowpass and less reverb than
    // everything else — which is precisely the recipe for a sound that stands
    // in FRONT of a mix rather than inside it. What makes a lead belong is
    // shared space and shared brightness, not level: a modest clarity lift
    // rather than a bite, a top end no brighter than the pad it sits over,
    // and the same room as the rest of the band
    const hookPres = reg(new Tone.Filter({ type: "peaking", frequency: 1800, Q: 0.9, gain: 2 }));
    const hookAir = reg(new Tone.Filter({ type: "highshelf", frequency: 4800, gain: -5 }));
    const hookLp = reg(new Tone.Filter({ frequency: 2300, type: "lowpass", Q: 0.9 }));
    hookS = reg(new Tone.Synth({
      oscillator: opts.lite ? { type: "square" } : { type: "fatsquare", count: 2, spread: 12 },
      envelope: { attack: 0.004, decay: 0.18, sustain: 0.15, release: 0.08 },
    }));
    hookS.volume.value = db(0.42);
    hookS.connect(hookPres);
    // the third hand for the hook: a warm detuned-triangle pluck — the
    // counterpart to the square, through the same chain so it stays a lead
    // and never a new mix problem
    leadTri = reg(new Tone.Synth({
      oscillator: opts.lite ? { type: "triangle" } : { type: "fattriangle", count: 2, spread: 14 },
      envelope: { attack: 0.006, decay: 0.2, sustain: 0.18, release: 0.1 },
    }));
    leadTri.volume.value = db(0.5);
    leadTri.connect(hookPres);
    // the fuzz bass lead: a hollow square through a waveshaper, an octave
    // below the other leads. It lives on the hook chain ON PURPOSE — the
    // lead highpass eats fundamentals below ~190 Hz, and that is authentic:
    // a fuzz bass reads through its harmonics, not its fundamental
    const fuzzDist = reg(new Tone.Distortion(0.4));
    leadFuzz = reg(new Tone.Synth({
      oscillator: opts.lite ? { type: "square" } : { type: "fatsquare", count: 2, spread: 8 },
      envelope: { attack: 0.004, decay: 0.14, sustain: 0.4, release: 0.08 },
    }));
    // a waveshaper compresses and therefore LOUDENS — the level makes
    // room for that, or the fuzz reads as a penetrating bass, not a lead
    leadFuzz.volume.value = db(0.3);
    leadFuzz.chain(fuzzDist, hookPres);
    // the sampled muted guitar shares the hook chain — square is the fallback
    hookGit.disconnect(); hookGit.volume.value = db(0.72);
    hookGit.connect(hookPres);
    hookPres.connect(hookAir); hookAir.connect(hookLp);
    // the same room as the pads: a dry lead over a wet arrangement reads as
    // overdubbed onto it. The delay keeps carrying the phrase's rhythm
    const hookRev = reg(new Tone.Gain(0.8));
    hookLp.connect(busLead); hookLp.connect(delaySend);
    // the delay throw: a second, normally-closed path into the shared delay.
    // It opens for ONE note (the hook's tail before its rest window) and the
    // next barline closes it — the feedback carries the answer on
    hookThrowG = reg(new Tone.Gain(0)); hookThrowG.gain.value = 0;
    hookLp.connect(hookThrowG); hookThrowG.connect(delaySend);
    hookLp.connect(hookRev); hookRev.connect(revSend);

    // Parov seasoning: brass-like stab — filter snaps open and shuts
    brassLp = reg(new Tone.Filter({ frequency: 900, type: "lowpass", Q: 1.2 }));
    brassS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: opts.lite ? { type: "sawtooth" } : { type: "fatsawtooth", count: 3, spread: 18 },
      envelope: { attack: 0.02, decay: 0.18, sustain: 0.3, release: 0.12 },
    }));
    brassS.volume.value = db(0.16);
    poly(brassS, opts.lite ? 10 : 24);
    brassS.connect(brassLp); brassLp.connect(busHarm); brassLp.connect(revSend);

    growlLp = reg(new Tone.Filter({ frequency: 160, type: "lowpass", Q: 1 }));
    const growlDist = reg(new Tone.Distortion(0.7));
    growlS = reg(new Tone.Synth({
      oscillator: opts.lite ? { type: "sawtooth" } : { type: "fatsawtooth", count: 3, spread: 24 },
      envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.08 },
    }));
    growlS.volume.value = db(0.6); growlS.chain(growlDist, growlLp, busBass);

    thrustSubGain = reg(new Tone.Gain(0));
    thrustSub = reg(new Tone.Oscillator(55, "sine").start());
    thrustSub.connect(thrustSubGain); thrustSubGain.connect(busBass);

    // rise figure: warm detuned triangles (the gate voice's recipe) behind a
    // per-voice lowpass that opens with the climb. A naked sine was tried and
    // read as a foreign body next to the saws and squares — the figure has to
    // be built from the band's own timbre, and it needs what every other
    // voice here has: overtones plus filter movement. Deliberately NOT a saw
    // and NOT in the bass family — it climbs through the mix, it doesn't
    // drone under it. The shared dotted-8th delay carries the connection
    // between the plucks, exactly as it does for the hook and the arp
    riseHp = reg(new Tone.Filter(400, "highpass"));
    // the rise is a FORCE voice: it lives on the drive lane, so the warp
    // that pulls the music back never muffles the acceleration's own figure
    riseHp.connect(busDrive); riseHp.connect(revSend); riseHp.connect(delaySend);
    riseS = []; riseLp = [];
    for (let i = 0; i < (opts.lite ? 2 : 3); i++) {
      const lp = reg(new Tone.Filter({ frequency: 1200, type: "lowpass", Q: 0.7 }));
      lp.connect(riseHp);
      const rs = reg(new Tone.Synth({
        oscillator: opts.lite ? { type: "triangle" } : { type: "fattriangle", count: 2, spread: 10 },
        envelope: { attack: 0.006, decay: 0.14, sustain: 0.35, release: 0.3 },
      }));
      rs.volume.value = db(0.3);
      rs.connect(lp);
      riseS.push(rs); riseLp.push(lp);
    }

    // brake: brown noise is a naturally dark rumble — pressure, not vacuum
    brakeLp = reg(new Tone.Filter({ frequency: 300, type: "lowpass", Q: 2 }));
    brakeGain = reg(new Tone.Gain(0));
    brakeNoise = reg(new Tone.Noise("brown").start());
    // past the tension lowpass on purpose: under braking the MUSIC muffles
    // (tensionLp) while the brake's own pressure stays crisp and near —
    // same near/far split as the warp, on the braking side
    brakeNoise.chain(brakeLp, brakeGain, masterHp);
    brakeOscGain = reg(new Tone.Gain(0));
    brakeOsc = reg(new Tone.Oscillator(88, "sine").start());
    brakeOsc.connect(brakeOscGain); brakeOscGain.connect(masterHp);

    // the air bed: a very quiet, dark noise floor that breathes with the
    // drive — atmosphere in the literal sense. It ducks under braking so it
    // never stacks with the brake's own pressure noise
    atmoLp = reg(new Tone.Filter({ frequency: 420, type: "lowpass", Q: 0.5 }));
    atmoGain = reg(new Tone.Gain(0)); atmoGain.gain.value = 0;
    atmoNoise = reg(new Tone.Noise("brown").start());
    atmoNoise.chain(atmoLp, atmoGain, busFx);
    atmoGain.connect(revSend);

    stretchBp = reg(new Tone.Filter({ frequency: 2100, type: "bandpass", Q: 14 }));
    stretchGain = reg(new Tone.Gain(0));
    stretchNoise = reg(new Tone.Noise("white").start());
    stretchNoise.chain(stretchBp, stretchGain, busFx);

    // pad: fat saws + triangle octave, breathing filter, chorus, reverb
    padHp = reg(new Tone.Filter(160, "highpass"));
    padLp = reg(new Tone.Filter({ frequency: 900, type: "lowpass", Q: 0.4 }));
    padS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: opts.lite ? { type: "sawtooth" } : { type: "fatsawtooth", count: 3, spread: 14 },
      envelope: { attack: 1.1, decay: 0.3, sustain: 0.8, release: 1.6 },
    }));
    padS.volume.value = db(0.16);
    poly(padS, opts.lite ? 24 : 64);
    // the sound-world anchor: trims move these four voices relative to the
    // calibrated base captured HERE, so a rebuilt park re-anchors cleanly and
    // no world ever compounds on another world's trim
    worldBaseVol = { bass: bassS.volume.value, pad: padS.volume.value,
      gate: gateS.volume.value, blip: blipS.volume.value };
    engine.worldApplied = null;
    engine.worldCutScale = 1;
    engine.worldRoom = 1;
    padTri = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 1.3, decay: 0.3, sustain: 0.7, release: 1.8 },
    }));
    padTri.volume.value = db(0.09);
    poly(padTri, opts.lite ? 24 : 64);
    padS.connect(padHp); padTri.connect(padHp);
    padHp.connect(padLp);
    if (chorus) { padLp.connect(chorus); chorus.connect(busHarm); }
    else padLp.connect(busHarm);
    // depth: the chord carpet stands at the back of the stage — a clearly
    // larger share of the ONE shared room is the front/back cue (drums and
    // bass stay dry at the front, the hook keeps its middle distance)
    padRevG = reg(new Tone.Gain(1.6)); padRevG.gain.value = 1.6;
    padLp.connect(padRevG); padRevG.connect(revSend);

    arpLp = reg(new Tone.Filter({ frequency: 800, type: "lowpass", Q: 4 }));
    arpS = reg(new Tone.Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.08 },
    }));
    arpS.volume.value = db(0.14); arpS.connect(arpLp);
    arpPan = reg(new Tone.Panner(0)); arpPan.pan.value = 0.12;
    arpLp.connect(arpPan); arpPan.connect(busHarm);
    arpLp.connect(delaySend); arpLp.connect(revSend);

    stabLp = reg(new Tone.Filter({ frequency: 1400, type: "lowpass", Q: 1 }));
    stabS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: opts.lite ? { type: "sawtooth" } : { type: "fatsawtooth", count: 2, spread: 14 },
      envelope: { attack: 0.003, decay: 0.16, sustain: 0, release: 0.05 },
    }));
    stabS.volume.value = db(0.14);
    poly(stabS, opts.lite ? 12 : 24);
    stabS.connect(stabLp); stabLp.connect(busHarm); stabLp.connect(delaySend); stabLp.connect(revSend);

    // the SOUNDWORLDS table is the single source of truth for the world-
    // managed voices: apply the reference world to the fresh park, so a
    // constructor value that drifts from the table can never survive to be
    // heard — the table wins from the first note
    applySoundWorld("analog");
  }

  // native one-shots on the shared context (clicks, impacts, swells)
  function noiseSrc(t, dur) {
    const s = raw.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.start(t); s.stop(t + dur + 0.1);
    return s;
  }
  function kickClick(t, amount) {
    const n = noiseSrc(t, 0.02);
    const hp = raw.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 1400;
    const g = raw.createGain();
    g.gain.setValueAtTime(amount, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    n.connect(hp).connect(g);
    Tone.connect(g, busDrums);
  }
  function impact(t) {
    const o = raw.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(33, t + 0.4);
    const g = raw.createGain();
    // the body under the drop's kick, no longer the whole hit — a naked
    // sine sweep at 0.85 read as "cheap" the moment it stood alone
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g);
    Tone.connect(g, busDrums);
    o.start(t); o.stop(t + 0.6);
    const n = noiseSrc(t, 0.25);
    const lp = raw.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 600;
    const ng = raw.createGain();
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(lp).connect(ng);
    Tone.connect(ng, busDrums);
  }
  function fillSwell(t, dur) {
    const n = noiseSrc(t, dur);
    const bp = raw.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + dur);
    const g = raw.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    n.connect(bp).connect(g);
    Tone.connect(g, busFx);
  }

  // the drop's top layer: a crash-style splash — high noise with a real
  // decay, sent into the fx bus so the room answers the hit. A payoff reads
  // as expensive when the whole spectrum returns at once; the crash is the
  // marker every produced drop carries and ours lacked
  function crash(t) {
    const n = noiseSrc(t, 1.4);
    const hp = raw.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 5200;
    const g = raw.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(hp).connect(g);
    Tone.connect(g, busFx);
  }

  // the drop's release half: the riser's mirror — a falling sweep after
  // the impact, so the arrival also EXHALES instead of only hitting
  function fallSweep(t, dur) {
    const n = noiseSrc(t, dur);
    const bp = raw.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = raw.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g);
    Tone.connect(g, busFx);
  }

  // ---- voices --------------------------------------------------------------

  const vv = (vol, ref) => { notes++; return clamp(vol / ref, 0, 1); };

  // Tone REFUSES a voice triggered at or before its own previous start time,
  // and the refusal is thrown inside the transport callback — so every voice
  // scheduled later in that step never plays, the arrangement audibly loses
  // parts, and a step that throws every bar stops the music altogether.
  // Two things here trigger the same voice twice in one step by design (the
  // shaker runs a backbeat AND the urban groove; the arp runs its figure AND
  // a phrase-end fill), and the fallbacks add more (a Rhodes dab becomes a
  // stab when the sample is missing). Rather than hunt every pair, each voice
  // gets a slot: a second trigger at the same instant is nudged a hair later,
  // which is what the ear would call a flam anyway.
  const sched = new Map();
  function at(key, t) {
    const prev = sched.get(key);
    const tt = prev != null && t <= prev ? prev + 0.002 : t;
    sched.set(key, tt);
    return tt;
  }

  function kick(t, vol, click = 0) {
    kickS.triggerAttackRelease(46, "8n", at("kick", t), vv(vol, 0.95));
    // the click is a thrust ornament, not part of the kick. The old threshold
    // was below the resting value, so every kick built and threw away three
    // audio nodes — four times a bar, forever, for nothing audible
    if (click > 0.12 && !opts.lite) kickClick(t, click * vol);
  }
  function duckAt(t, depth) {
    const g = duck.gain;
    g.cancelScheduledValues(t);
    // Anchor at 1, dip over 4 ms, recover over 0.28 s — three explicit points,
    // all of them ramps. Stepping straight down (the original) clicks on every
    // kick; reaching for setTargetAtTime instead (the first attempt at that
    // click) is worse, because setTarget has no end time, so the next kick's
    // cancelScheduledValues can leave the whole melodic bus parked at the
    // ducked level with nothing scheduled to bring it back — everything
    // through this gain quietly dies while the drums keep playing.
    // An anchored ramp cannot get stuck: every kick re-states where it starts
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.004);
    g.linearRampToValueAtTime(1, t + 0.28);
  }
  function heartbeat(t, vol, f0) {
    heartS.triggerAttackRelease(f0 * 0.35, 0.3, at("heart", t), vv(vol, 0.6));
  }
  // one fill hit, routed to its voice — velocities scale with the arc's
  // stage, so a sparse opening never gets a drummer showing off
  function playFill(t, hits, pos, scale) {
    const h = hits.find((x) => x[0] === pos);
    if (!h) return;
    const v = h[3] * scale;
    if (h[1] === "t") tom(t, h[2], 0.11 * v);
    else if (h[1] === "s") snare(hum(t, pos), vel(0.14 * v));
    else if (h[1] === "g") snare(hum(t, pos), vel(0.05 * v), true);
    else if (h[1] === "k") kick(t, 0.6 * v, 0);
  }
  function tom(t, f0, vol) {
    tomS.triggerAttackRelease(f0 * 0.45, 0.18, at("tom", t), vv(vol, 0.35));
  }
  function hat(t, open, vol) {
    (open ? hatO : hatC).triggerAttackRelease(open ? 0.26 : 0.04,
      at(open ? "hatO" : "hatC", t), vv(vol, 0.2));
  }
  function shaker(t, vol) { shakerS.triggerAttackRelease(0.055, at("shaker", t), vv(vol, 0.16)); }
  function snare(t, vol, ghost = false) {
    const tt = at("snare", t);
    // per-hit color: the band-pass wanders a little on every hit, so a
    // sixteen-hit roll reads as a drummer working the head, not a machine
    // gun repeating one sample. The write follows the slot's own time
    snareBp.frequency.setValueAtTime(1500 + 500 * Math.random(), tt);
    snareS.triggerAttackRelease(ghost ? 0.045 : 0.13, tt, vv(vol, 0.3));
    if (!ghost) {
      snareBody.triggerAttackRelease(185, 0.09, at("snareBody", t), vv(vol * 0.7, 0.25));
      snareSnap.triggerAttackRelease(0.07, at("snareSnap", t), vv(vol * 0.8, 0.3));
    }
  }
  function perc(t, vol) { percS.triggerAttackRelease(0.03, at("perc", t), vv(vol, 0.25)); }
  function bassNote(t, freq, cut, vol, dur = SPB) {
    const tt = at("bass", t);
    // the sound world scales the drive-dependent cut: darker worlds keep the
    // movement, in a lower window
    bassLp.frequency.setValueAtTime(cut * (engine.worldCutScale || 1), tt);
    bassS.triggerAttackRelease(freq, dur * 0.85, tt, vv(vol, 0.5));
  }
  function bassSubNote(t, freq, vol, dur) {
    bassSubS.triggerAttackRelease(freq, dur, at("bassSub", t), vv(vol, 0.4));
  }
  function growlNote(t, vol, dur, rootMidi) {
    // the growl rides the CURRENT chord root. It droned the tonic before,
    // and a fixed pitch under a walking bass lands both in one critical
    // band below ~100 Hz — heard as two basses fighting, chord by chord
    growlS.triggerAttackRelease(F(rootMidi != null ? rootMidi : 33),
      dur * 0.85, at("growl", t), vv(vol, 0.6));
  }
  function riseNote(slot, t, midi, vol, dur = SPB * 1.5, tight = false) {
    // a pluck, not a wash — the delay carries the connection between notes.
    // The cutoff opens with the voice's height and the push, so the ascent is
    // told in brightness as well as pitch. Micro-jitter like the rest of the
    // band, except where the figure lands together (tight): a smeared unison
    // is a flam, not an arrival
    const tt = at("rise" + slot, tight ? t : hum(t, 0));
    const cut = 550 + 2800 * clamp((midi - 64) / 24, 0, 1) + 900 * engine.thrust;
    riseLp[slot].frequency.setValueAtTime(cut, tt);
    riseS[slot].triggerAttackRelease(F(midi), dur, tt, vv(vol, 0.25));
    return Math.round(cut);
  }
  function riseRecord(s, slot, midi, kind, cut, rootPc) {
    const e = { s, slot, midi, kind, cut };
    if (rootPc !== undefined) e.rootPc = rootPc;
    riseLog.push(e);
    if (riseLog.length > 600) riseLog.splice(0, riseLog.length - 600);
  }
  function riseEntryIndex(rootPc) {
    // begin near the bottom, on the chord if it lives there: the Shepard
    // illusion needs fresh entries low while the older voices are already high
    const top = RISE_LADDER.length - RISE_LEN;
    for (let i = 0; i <= top; i++) {
      const pc = RISE_LADDER[i] % 12;
      if (pc === rootPc || pc === (rootPc + 7) % 12) return i;
    }
    return 0;
  }
  function riseLanding(from, rootPc) {
    // the nearest root or fifth to where the voice got to — a landing is an
    // arrival, not a jump home. No seeded fallback: an incumbent that is not
    // itself a chord tone once let a G-chord landing come out as an A
    let best = null;
    for (let m = 60; m <= 92; m++) {
      const pc = m % 12;
      if (pc !== rootPc && pc !== (rootPc + 7) % 12) continue;
      if (best === null || Math.abs(m - from) < Math.abs(best - from)) best = m;
    }
    return best === null ? from : best;
  }
  // where a build-up RESOLVES: about an octave under where the voice climbed
  // to. Energy resolves downward — the field report against the first version
  // was "lands on a high note, quite often, sometimes off", and the high
  // register is what turned every harmless color tone into a wrong note
  function riseResolve(last, rootPc) {
    return riseLanding(Math.max(60, last - 12), rootPc);
  }
  // The rise figure's clock, once per 8th. Two rates carry the rev counter:
  // how often a new voice ENTERS (10 → 4 steps as the push grows) and how
  // fast each voice CLIMBS (quarters on a gentle pull, 8ths in a sprint).
  function riseStep(t, s, push, lean, rootMidi, chordMidis) {
    if (s % 2 !== 0) return;
    const rootPc = ((rootMidi % 12) + 12) % 12;
    if (!engine.riseOn && push > RISE_ON) {
      // (re-)engage — a pending arrival is cancelled: the driver is back on
      // the pedal, so the build simply continues
      engine.riseOn = true; riseNextAt = s; risePeak = push; riseArrivalAt = -1;
      riseHot = 0;
    } else if (engine.riseOn) {
      if (push > risePeak) risePeak = push;
      if (push > 0.5) riseHot++; // 8th-steps spent genuinely sprinting
      if (push < RISE_OFF) {
        engine.riseOn = false;
        // A real sprint has EARNED an ending that keeps time: the build-up
        // resolves on the next downbeat, together — a riser that merely
        // fades is a broken promise. But the ending comes in TWO sizes,
        // because the first version threw the full parade (hat, stab, held
        // chord) at every green light and a drop that always comes is not a
        // drop: only a SUSTAINED sprint (RISE_FULL_HOT of hot 8ths), outside
        // the cooldown, gets the full arrival; every other sprint gets the
        // quiet landing. A gentle pull made no promise, and an end under
        // braking is energy being DRAINED, not arrived at; both take the
        // staggered cadence instead.
        if (risePeak > 0.5 && engine.brake < 0.3 && riseVoices.some((v) => v)) {
          const rem = (16 - (s % 16)) % 16;
          riseArrivalAt = s + (rem < 4 ? rem + 16 : rem);
          riseFull = riseHot >= RISE_FULL_HOT && s - riseLastFullAt >= RISE_COOLDOWN
            && paradeAllowed();
        } else {
          for (const v of riseVoices) if (v) v.cadence = true;
        }
      }
    }
    // the ending: everyone lands the chord on the one — root and fifth about
    // an octave below where the voices climbed to — and rings out. The full
    // arrival adds the open hat and the stab body; the quiet landing is the
    // same resolution without the parade.
    if (s === riseArrivalAt) {
      riseArrivalAt = -1;
      for (let i = 0; i < riseVoices.length; i++) {
        const v = riseVoices[i];
        if (!v) continue;
        const land = riseResolve(v.last, rootPc);
        // SPB*8 on purpose: the ring ends before a "push"/"sync" section
        // anticipates the NEXT chord at position 10+, so the landing never
        // sustains against a harmony that has already moved on
        const cut = riseFull
          ? riseNote(i, t, land, v.vol * 1.2, SPB * 8, true)
          : riseNote(i, t, land, v.vol * 0.9, SPB * 5, true);
        riseRecord(s, i, land, riseFull ? "arrival" : "landing", cut, rootPc);
        riseVoices[i] = null;
      }
      if (riseFull) {
        riseLastFullAt = s;
        hat(t, true, 0.13); // the breath that opens the moment
        // and a body under the landing: the stab doubles the chord on the
        // one, so the payoff has more than the climb voices themselves
        if (chordMidis) stabChord(t, chordMidis, 0.09);
      }
      return;
    }
    for (let i = 0; i < riseVoices.length; i++) {
      const v = riseVoices[i];
      if (!v || s < v.nextAt) continue;
      if (v.cadence) {
        const land = riseLanding(v.last, rootPc);
        const cut = riseNote(i, t, land, v.vol * 0.6, SPB * 2.6);
        riseRecord(s, i, land, "cadence", cut, rootPc);
        riseVoices[i] = null;
        continue;
      }
      if (riseArrivalAt >= 0) {
        // run-in: keep climbing toward the landing — but a voice that has
        // reached the ladder's top HOLDS ITS BREATH instead of pulsing the
        // same high note over changing chords (that pulse was the "sounds
        // off, as if not tuned" of the field report). The silence up there
        // is the gap before the drop, which is a feature of drops.
        if (v.start + v.n >= RISE_LADDER.length) { v.nextAt = s + v.adv; continue; }
        const midi = RISE_LADDER[v.start + v.n];
        const cut = riseNote(i, t, midi, v.vol * 0.8);
        riseRecord(s, i, midi, "climb", cut);
        v.last = midi; v.n++; v.nextAt = s + v.adv;
        continue;
      }
      if (v.n >= RISE_LEN) { riseVoices[i] = null; continue; }
      const midi = RISE_LADDER[v.start + v.n];
      const cut = riseNote(i, t, midi, v.vol * RISE_ENV[v.n]);
      riseRecord(s, i, midi, "climb", cut);
      v.last = midi; v.n++; v.nextAt = s + v.adv;
    }
    // a new entry: only while engaged, never in lean (ornaments go first), and
    // only into a free slot — a full pool converts push into saturation, and a
    // due entry simply retries every 8th until a voice ends
    if (!engine.riseOn || lean || s < riseNextAt) return;
    let slot = riseVoices.findIndex((v) => !v);
    if (slot < 0 && riseVoices.length < riseS.length) slot = riseVoices.length;
    if (slot < 0) return;
    const start = riseEntryIndex(rootPc);
    const midi = RISE_LADDER[start];
    const v = {
      start, n: 1, last: midi, vol: 0.05 + 0.09 * push,
      adv: push > 0.5 ? 2 : 4, cadence: false,
    };
    v.nextAt = s + v.adv;
    riseVoices[slot] = v;
    const cut = riseNote(slot, t, midi, v.vol * RISE_ENV[0]);
    riseRecord(s, slot, midi, "entry", cut);
    riseNextAt = s + 10 - 2 * Math.round(3 * clamp((push - RISE_ON) / 0.55, 0, 1));
  }
  function stabChord(t, midis, vol) {
    stabS.triggerAttackRelease(midis.map(F), 0.16, at("stab", t), vv(vol, 0.14));
  }
  function blip(t, freq, vol) {
    blipS.triggerAttackRelease(freq, 0.1, at("blip", t), vv(vol, 0.09));
  }
  function hookNote(t, freq, dur, vol) {
    // the hook changes hands per piece — the recipe's lead voice carries it.
    // Same phrase machinery, different instrument: the strongest cheap signal
    // that a new piece is a new SONG and not a re-roll of the last one
    const tt = at("hook", t);
    if (engine.lead === "square") hookS.triggerAttackRelease(freq, dur, tt, vv(vol, 0.2));
    else if (engine.lead === "warm") leadTri.triggerAttackRelease(freq, dur, tt, vv(vol, 0.18));
    else if (engine.lead === "fuzz") leadFuzz.triggerAttackRelease(freq / 2, dur, tt, vv(vol, 0.18));
    else if (hookGit && hookGit.loaded) hookGit.triggerAttackRelease(freq, dur, tt, vv(vol, 0.16));
    else hookS.triggerAttackRelease(freq, dur, tt, vv(vol, 0.2));
  }
  // the gate's amplitude, one automation point per sixteenth. No
  // cancelScheduledValues: steps are scheduled in increasing time order, so
  // the ramps chain by themselves — and a cancel is exactly how an automated
  // gain gets left parked somewhere it can't come back from
  function gateLevel(t, target, up) {
    // "steps arrive in increasing time order" is true until the scheduler falls
    // behind ONCE and fires a backlog. Tone refuses an automation point behind
    // the last one, and this runs on every single step — so one late burst
    // would throw for the rest of the drive. The slot makes it unfalsifiable
    const tt = at("gateAmp", t);
    gateAmp.gain.linearRampToValueAtTime(target, tt + (up ? 0.014 : 0.032));
  }
  function gateHold(t, midis) {
    // one bar plus a tail; the tail is what sounds through a closed step
    gateS.triggerAttackRelease(midis.map(F), SPB * 18, at("gate", t), 0.55);
  }
  function rhodesChord(t, midis, vol) {
    if (!rhodes || !rhodes.loaded) { stabChord(t, midis, vol); return; }
    rhodes.triggerAttackRelease(midis.map(F), SPB * 6, at("rhodes", t), vv(vol, 0.25));
  }
  function chordVoice(t, midis, dur, vol, cut) {
    // breath: a red light holds its breath. The pad voices a SUSPENDED
    // chord — root, fourth, fifth, no third — and deliberately never
    // resolves it here: the departure is the resolution, because the next
    // moving part voices real harmony again. Film craft: tension by
    // withholding, paid off by the road
    if (engine.scene === "breath") {
      const r = midis[0];
      midis = [r, r + 5, r + 7, r + 12];
      engine.susVoiced++;
    }
    // the coda's final chord rings alone: once resolved, no new voicings
    if (engine.scene === "coda" && engine.codaResolved) return;
    // the highway carries, and so does a device at its limit: the wash is a
    // single trigger per chord where the figures are eight or more
    const style = engine.flowOn || engine.lean ? "wash" : engine.padStyle;
    if (style === "broken") return; // that one lives per step
    // the gate keeps a quiet bed underneath — a pulse ON something, never a
    // hole between hits. This is the single biggest reason a gated section
    // stops sounding brutal
    if (style === "gate") { pad(t, midis, dur, vol * 0.45, cut * 0.8); return; }
    if (style === "keys" && rhodes && rhodes.loaded) {
      // rolled Rhodes chord, pad reduced to glue underneath
      midis.forEach((m, i) =>
        rhodes.triggerAttackRelease(F(m), Math.min(dur, SPB * 12),
          at("rhodes", t + i * 0.014), 0.55));
      pad(t, midis, dur, vol * 0.35, cut);
      return;
    }
    pad(t, midis, dur, vol, cut);
  }
  function brassHit(t, midis, vol) {
    const f = brassLp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(700, t);
    f.linearRampToValueAtTime(2400, t + 0.04);
    f.linearRampToValueAtTime(800, t + 0.28);
    brassS.triggerAttackRelease(midis.map(F), 0.22, at("brass", t), vv(vol, 0.16));
  }
  function arpNote(t, freq, cut, vol, dur = SPB) {
    // the filter has to follow the note's OWN (possibly nudged) time, or a
    // collision leaves an automation point behind the last one
    arpLp.frequency.cancelScheduledValues(t);
    arpLp.frequency.setValueAtTime(cut, t);

    arpS.triggerAttackRelease(freq, Math.max(dur * 0.7, 0.08), at("arp", t), vv(vol, 0.14));
  }
  function pad(t, midis, dur, vol, cut = 1100) {
    const f = padLp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(cut * 0.45, t);
    f.linearRampToValueAtTime(cut * 1.25, t + dur * 0.45);
    f.linearRampToValueAtTime(cut * 0.6, t + dur);
    padS.triggerAttackRelease(midis.map(F), dur * 0.85, at("pad", t), vv(vol, 0.4));
    padTri.triggerAttackRelease(midis.map((m) => F(m + 12)), dur * 0.85,
      at("padTri", t), vv(vol * 0.55, 0.4));
  }

  // ---- sequencer -----------------------------------------------------------

  function onStep(s, t) {
    const pos = s % 16, bar = Math.floor(s / 16);
    // Thinning LATCHES at a bar line, with hysteresis. Deciding it per step
    // means layers appear and vanish mid-bar and the arp changes rate under a
    // held note — heard not as "simpler" but as a band falling out of sync
    // with itself. Whatever the load does, the arrangement changes on the one
    // or not at all
    if (pos === 0) {
      if (!engine.lean && strain > 0.6) engine.lean = true;
      else if (engine.lean && strain < 0.3) engine.lean = false;
      setFxShed(engine.lean);
    }
    const lean = engine.lean; // the device is at its limit — shed ornaments
    const wake = clamp(engine.wake, 0, 1); // the rhythm section fading in
    const ff = clamp(engine.flowFade, 0, 1); // the motorway layer fading in
    const e = clamp(engine.energy + engine.launchBoost * 0.3, 0, 1);
    const still = e < 0.06;
    const push = engine.thrust;
    const u = engine.urban;
    const flowHigh = clamp((e - 0.5) / 0.35, 0, 1); // highway = flow, not max energy
    // song form: a PIECE is a fixed script of named parts (Strophe/Refrain/
    // Bridge) whose materials are rolled once and RETURN — repetition builds
    // familiarity, small per-occurrence variation keeps attention
    if (pos === 0 && bar % 16 === 0) {
      if (!engine.piece || engine.piece.idx >= engine.piece.form.length) newPiece();
      // the drive steers the FORM, not only the layers: a launch brings the
      // next chorus forward. It SWAPS with the part that was due, so nothing
      // is lost — advancing the index instead deleted every part in between,
      // and in town, where a launch happens at every light, that collapsed the
      // song into nothing but choruses and the bridge never played at all.
      // Once per piece: a form that reorders itself endlessly is not a form
      if (engine.pullChorus) {
        engine.pullChorus = false;
        const f = engine.piece.form, i = engine.piece.idx;
        const j = f.indexOf("B", i + 1);
        if (!engine.piece.pulled && f[i] !== "B" && j > i) {
          f[i] = "B"; f[j] = "A"; // the displaced verse takes the chorus's slot
          engine.piece.pulled = true;
        }
      }
      loadPart(t);
      engine.piece.idx++;
    }
    // the scene re-gates the stage on barlines: a cap that moved mid-part
    // must reach the flags, and patience/coda enter on the hard cut (hush)
    // that IS the calming signal — not a failure of smoothness
    if (pos === 0) {
      if (engine.scene === "coda") engine.gatesDirty = true; // the cap keeps falling
      if (engine.gatesDirty && engine.piece) {
        engine.gatesDirty = false;
        applyStageGates();
        rebalance();
      }
      if (engine.sceneHushPending) { engine.sceneHushPending = false; hush(t); }
    }
    if (pos === 0) engine.barInPart = bar % 16;
    if (pos === 0 && bar % 8 === 7) engine.fill = FILLS[Math.floor(Math.random() * FILLS.length)];
    // the highway latch and the EARNED lift. The old lift ran on a 24-bar
    // clock — "it always comes at the expected moment" — so now the pedal
    // phase carries a HAZARD: the longer it carries, the likelier the lift,
    // and every lift is preceded by the same four build bars the final
    // chorus earns, entered through the same drop
    if (pos === 0) {
      const eL = clamp(engine.energy + engine.launchBoost * 0.3, 0, 1);
      const fH = clamp((eL - 0.5) / 0.35, 0, 1);
      const wasFlow = engine.flowOn;
      if (!engine.flowOn && fH > 0.65) { engine.flowOn = true; engine.flowStartBar = bar; }
      else if (engine.flowOn && fH < 0.5) engine.flowOn = false;
      if (wasFlow !== engine.flowOn) {
        hush(t);
        if (!engine.flowOn) { engine.liftStart = -1; engine.liftArm = -1; }
      }
      if (engine.flowOn) {
        if (engine.liftStart >= 0 && bar - engine.liftStart >= 8) {
          engine.lastLiftEnd = bar; engine.liftStart = -1; hush(t); // the lift exhales
        }
        if (engine.liftStart < 0) {
          if (engine.liftArm >= 0 && bar >= engine.liftArm) {
            engine.liftStart = bar; engine.liftArm = -1; hush(t); // the drop owns this one
          } else if (engine.liftArm < 0) {
            const since = bar - Math.max(engine.lastLiftEnd, engine.flowStartBar);
            if (since >= 8 && dicer("lift")() < clamp((since - 8) / 30, 0, 0.4)) {
              engine.liftArm = bar + 4;
            }
          }
        }
      }
    }
    // what comes after this section? (idx already points at the next part)
    const pieceEnd = engine.piece && engine.piece.idx >= engine.piece.form.length;
    const nextIsB = engine.piece && !pieceEnd && engine.piece.form[engine.piece.idx] === "B";
    // DJ turnover: pulls the lows out of the whole mix so the new downbeat can
    // drop them back in. Only where it EARNS something — into a chorus or a
    // new piece. Every 16 bars it stops being a gesture and becomes a tic.
    // The FINAL chorus earns more: a four-bar ride instead of the one-bar
    // turnover — the highpass climbs bar by bar (anchored per bar, so a late
    // scheduler can never wedge it) and releases on the one. A build-up is a
    // promise with a known payoff instant, which is why these devices ride
    // the FORM — the drive keeps its own continuous tension tools
    const finalRun = !still && nextIsB && engine.piece &&
      engine.piece.idx === engine.piece.form.lastIndexOf("B");
    // the unified build window — three roads lead into it: the form's
    // final-chorus run-up (bars 12-15), the bridge rebuild's tail (14-15,
    // which therefore also gets a two-bar mini-ride now), and the flow
    // lift's four armed bars. Ride, roll, growing room and tremolo all
    // read the same segment
    const formSeg = finalRun && bar % 16 >= 12 ? bar % 16 - 12
      : engine.partLabel === "C" && nextIsB && bar % 16 >= 14 ? bar % 16 - 12 : -1;
    const liftK = engine.flowOn && engine.liftArm >= 0 ? bar - (engine.liftArm - 4) : -1;
    const rideSeg = Math.max(formSeg, liftK >= 0 && liftK <= 3 ? liftK : -1);
    const buildSeg = Math.max(rideSeg, 0);
    const buildOn = !lean && rideSeg >= 1;
    if (pos === 0) {
      masterHp.frequency.cancelScheduledValues(t);
      if (rideSeg >= 0) {
        masterHp.frequency.setValueAtTime([25, 60, 110, 170][rideSeg], t);
        masterHp.frequency.exponentialRampToValueAtTime([60, 110, 170, 240][rideSeg],
          t + SPB * 15);
      } else {
        masterHp.frequency.setValueAtTime(25, t);
        if (bar % 16 === 15 && !still && (nextIsB || pieceEnd)) {
          masterHp.frequency.setValueAtTime(30, t);
          masterHp.frequency.exponentialRampToValueAtTime(240, t + SPB * 15);
          // a piece ends here: a long swell carries into the next piece's one
          if (pieceEnd) fillSwell(t, SPB * 14);
        }
      }
      // the roll swims in GROWING room: the snare's reverb share swells
      // with the build and the gap then cuts the dry signal while the hall
      // tail rings into the breath — crescendo into silence
      if (snareSendG) {
        ctl(snareSendG.gain, "snareRoom",
          buildOn ? [0, 0.2, 0.35, 0.55][buildSeg] : 0.12, 0.004, 0.3);
      }
      // whatever opened the throw, the barline closes it
      if (hookThrowG) {
        hookThrowG.gain.cancelScheduledValues(t);
        hookThrowG.gain.setValueAtTime(0, t);
      }
    }
    // the GAP: a breath of near-silence, then the impact on the one. It only
    // earns that after the bridge's breakdown — before EVERY chorus it stops
    // reading as a drop and starts reading as the music cutting out, which is
    // indistinguishable from a fault. And it holds back a little rather than
    // going fully silent, for the same reason
    // the payoff rule (field report: "after the build-up, one kick as the
    // reward"): the breath-then-impact drop is earned by BOTH exits that
    // build — the bridge's rebuild and the final chorus's ride+roll
    if (pos === 14 && !still &&
        ((bar % 16 === 15 && nextIsB && (engine.partLabel === "C" || finalRun)) ||
         liftK === 3)) {
      const g = master.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.9, t);
      g.linearRampToValueAtTime(0.12, t + SPB * 1.6);
      engine.dropAt = s + 2;
    }
    // breather: every 48 bars the kick and bass step aside for 4 bars —
    // only while cruising, so it never fights a driving event
    const breather = bar % 48 >= 44 && push < 0.15 && engine.brake < 0.2;
    const turnaround = bar % 8 === 7; // phrase ends earn a variation
    // the bridge is a real BREAKDOWN: rhythm section out for its first half,
    // the harmonic bed carries, then the rebuild rises into the final chorus.
    // A launch overrides it — the drive always outranks the form
    const bridgeDown = engine.partLabel === "C" && bar % 16 < 8 && engine.launchBoost < 0.3;
    // on the highway the harmony carries instead of changing.
    // The switch latches with hysteresis and only flips on a barline —
    // a threshold hovering mid-bar must never flap the harmony source
    const flowMode = engine.flowOn;
    const liftPhase = flowMode && engine.liftStart >= 0;
    engine.liftActive = liftPhase;
    const progEff = !flowMode ? engine.prog : liftPhase ? LIFTPROG : PEDALPROG;
    const rootsEff = !flowMode ? engine.roots : liftPhase ? LIFTROOTS : PEDALROOTS;
    const hrEff = flowMode ? "twobar" : engine.hr;

    // engine feedback: the rise figure reads the push and the current chord.
    // Deliberately outside the still/cruise split — a launch from standstill
    // is exactly the moment the figure exists for
    const ci = chordIdx(bar, hrEff);
    const ciNext = chordIdx(bar + 1, hrEff);
    // the thrust sub follows the bar's root — the other half of the
    // one-bass rule (see growlNote). A short glide, never a step; roots[0]
    // is always 33 (the pivot rule), so loadPart's anchor stays true
    if (thrustSub && pos === 0) {
      ctl(thrustSub.frequency, "thrustSubF", F(rootsEff[ci]), 0.3, 0.08);
    }
    riseStep(t, s, push, lean, rootsEff[ci], progEff[ci]);

    if (s === engine.dropAt) {
      engine.dropAt = -1;
      master.gain.cancelScheduledValues(t);
      // ramp back over ~8 ms, never step: a gain jump from 0.03 to 0.9 between
      // two samples is a discontinuity in the waveform, and a discontinuity is
      // a click. Too short to hear as a fade, long enough to not snap
      master.gain.setValueAtTime(0.12, t);
      master.gain.linearRampToValueAtTime(0.9, t + 0.008);
      // the reward is a WALL, not a kick — and a wall is the whole spectrum
      // landing at once: the real kick for the attack, the sub impact for
      // the body, a crash for the top (with the room answering), the bass
      // root back on the ground, chord stab and downlifter. The naked sine
      // sweep alone was the "cheap" hit of the field report
      if (!still) {
        kick(t, 1, 0.5);
        impact(t); crash(t); fallSweep(t, SPB * 6);
        bassNote(bassT(t), F(rootsEff[ci]), 900, 0.4, SPB * 4);
        stabChord(t, progEff[ci], 0.16);
        hat(t, true, 0.14);
      }
      dropCount++;
    }

    // the coda's last word: everything hushes and one long chord rings out
    // alone — a drive that ends now ends on a resolution instead of
    // mid-phrase (peak-end: the ending owns the memory of the whole ride).
    // pad() directly, because chordVoice refuses new voicings once resolved
    if (pos === 0 && engine.scene === "coda" && engine.codaProgress >= 1 &&
        !engine.codaResolved) {
      engine.codaResolved = true;
      hush(t);
      pad(t, progEff[ci], SPB * 32, 0.2, 900);
    }

    if (still) {
      // the beat pulls back — a heartbeat keeps subtle tension alive
      const hb = engine.armed ? 0.62 : 0.42;
      if (pos % 8 === 0) heartbeat(t, hb, 110);
      if (pos % 8 === 2) heartbeat(t, hb * 0.6, 132);
    } else {
      // pump stays gentle at cruise, deepens only under force. The kick grid
      // is the recipe's groove template — four-on-floor is one frame among
      // several now, and halftime's fewer kicks carry more weight each
      if (engine.groove.kick.includes(pos) && !breather && !bridgeDown) {
        // patience softens the kick; the coda fades it out with the farewell
        const sceneKick = engine.scene === "patience" ? 0.75
          : engine.scene === "coda" ? 1 - 0.7 * engine.codaProgress : 1;
        kick(t, (0.85 + 0.1 * e) * (1 - 0.18 * flowHigh * (liftPhase ? 0.2 : 1)) * wake
          * engine.groove.kickW * sceneKick,
          0.05 + 0.3 * push);
        duckAt(t, 0.3 * (1 - 0.3 * flowHigh) + 0.28 * push);
      }
      // bass follows the chord roots and a groove pattern with holes in it;
      // it reaches full weight at city speeds already, not only on the highway
      const fat = clamp(e / 0.5, 0, 1);
      const drain = 1 - 0.5 * engine.brake; // braking audibly drains the drive
      // the bass root moves ONLY on the one — it is the meter's anchor
      const rootF = F(rootsEff[ci]);
      // once per 8-bar phrase a lick takes over the bar's second half
      const lickBar = engine.lick && bar % 8 === 3 && !breather && !bridgeDown && !lean;
      if (!breather && !bridgeDown && engine.bassPat.includes(pos) && !(lickBar && pos >= 10)) {
        // melodic sections walk root/fifth/octave/seventh instead of pedaling
        const mi = engine.bassMel && !flowMode
          ? engine.bassMel[engine.bassPat.indexOf(pos) % engine.bassMel.length] : 0;
        // Daði pop: one hit per bar jumps up an octave when the section is playful
        const oct = !engine.bassMel && engine.bassFill && pos === 10 ? 2 : 1;
        // natural correlation: louder notes ring brighter, lengths breathe.
        // A DENSE pattern (the straight-8ths drive) plays DETACHED instead:
        // the mono bass would otherwise ring into the next hit and get cut
        // mid-wave — audible as a chop at every barline, worst on a square
        const dense = engine.bassPat.length >= 6;
        const v = vel((0.16 + 0.3 * fat) *
          (1 - 0.4 * flowHigh * (liftPhase ? 0.25 : 1)) * drain * wake);
        // rootsEff, not engine.roots: during the highway lift the bass must
        // walk the LIFT roots, not the retired section progression's
        bassNote(bassT(t), F(rootsEff[ci] + mi) * oct, 500 + 700 * fat + v * 350, v,
          SPB * (dense ? 0.95 : 1.5 + Math.random() * 0.4));
      }
      if (lickBar) {
        if (pos === 10) engine.lickFlashUntil = Date.now() + 2200;
        const hit = engine.lick.find((x) => x[0] === pos);
        if (hit) {
          // the lick sits back a little, but rides the same fat as the notes
          // it replaces — a flat 0.18 against a cruising 0.46 was heard as
          // the bass dropping out for the bar, loudest on a bright world
          bassNote(bassT(t), F(rootsEff[ci] + hit[1]), 800 + 400 * fat,
            vel((0.16 + 0.18 * fat) * drain * wake), SPB * 0.85);
        }
      }
      // funk vocabulary: quiet ghost notes between the hits — felt, not heard
      if (engine.ghosts && pos % 8 === 5 && !breather && !bridgeDown && !lean) {
        bassNote(hum(t, pos), rootF, 420, vel(0.05 * drain), SPB * 0.5);
      }
      // approach note: walk into the next chord instead of just switching
      if (engine.bassFill && pos === 15 && bar % 2 === 1 && bar % 16 !== 15 && !breather && !lickBar &&
          !bridgeDown && rootsEff[ciNext] !== rootsEff[ci]) {
        bassNote(bassT(t), F(rootsEff[ciNext] - 2), 380,
          vel(0.09 * drain), SPB * 0.8);
      }
      // sustained highway root lives on its own synth — the mono bass would
      // otherwise retrigger and choke it on every offbeat hit
      if (pos === 0 && ff > 0.02 && !breather && !bridgeDown) {
        bassSubNote(t, rootF, 0.26 * flowHigh * drain * ff, SPB * 15);
      }
      // the deep palette: film craft's cheapest tension device — the tonic
      // stays put while the harmony walks above it. Deep pieces only, city
      // and cruise only: the highway already has its own sustained root
      if (engine.piece && engine.piece.mood === "deep" && !flowMode &&
          ff < 0.02 && pos === 0 && bar % 2 === 0 && !breather && !bridgeDown) {
        bassSubNote(t, F(33), 0.12 * wake * drain, SPB * 30);
      }
      // thrust: growl-bass eases in and out with force — no hard gate
      if (push > 0.04 && pos % 4 === 2) growlNote(t, 0.62 * Math.pow(push, 1.3), SPB * 1.6, rootsEff[ci]);
      if (push > 0.55 && (pos % 4 === 1 || pos % 4 === 3)) growlNote(t, 0.3 * push, SPB * 0.8, rootsEff[ci]);
      // the stab rides the CURRENT chord — a hard-wired Am rubbed against Gadd9
      if (push > 0.06 && pos % 4 === 2) stabChord(t, progEff[ci], 0.12 * Math.pow(push, 1.3));
      if (engine.groove.hat.includes(pos)) hat(hum(t, pos), false,
        vel((0.03 + 0.05 * u) * (1 - 0.55 * flowHigh * (liftPhase ? 0.3 : 1)) * wake));
      // snare: the groove decides WHERE, the trait decides WHETHER — except a
      // groove whose backbone is the snare (halftime's three), which speaks
      // regardless. Ghost chatter stays a trait, on the groove's ghost spots.
      if ((engine.snare || engine.groove.coreSnare) && !breather && !bridgeDown) {
        if (engine.groove.snareAt.includes(pos)) snare(hum(t, pos), vel((0.12 + 0.05 * e) * wake));
        // chatter is an ornament: the trait says whether this part rolled it,
        // the arc's stage says whether the part has earned it yet
        if (engine.snare && engine.snareGhosts && engine.groove.ghostAt.includes(pos)) snare(hum(t, pos), vel((0.035 + 0.025 * u) * wake), true);
      }
      // the drums steer toward the peak: on the run-up to the final chorus
      // and out of the bridge rebuild the snare tightens — 8ths, then a 16th
      // roll with rising velocity. Density is the oldest "we are going
      // somewhere" signal there is; deep pieces roll it softer. It plays
      // THROUGH the breather on purpose: the 48-bar breather always lands on
      // exactly these bars (48 = three 16-bar parts), and kick and bass
      // stepping aside under a tightening roll IS the classic pre-drop
      // strip-back — the collision is the arrangement
      if (buildOn) {
        const stride = buildSeg >= 3 ? 1 : 2;
        if (pos % stride === 0) {
          const v = (0.04 + 0.02 * buildSeg + 0.006 * pos) *
            (engine.piece.mood === "deep" ? 0.7 : 1);
          snare(hum(t, pos), vel(v * wake), pos % 4 !== 0);
        }
        // the opera tremolo: a quiet string-style crescendo on the current
        // chord through the last build bars — rapid soft restrikes, the
        // romantic orchestra's oldest way of leaning into a climax
        if (buildSeg >= 2 && pos % 2 === 0) {
          stabChord(hum(t, pos), progEff[ci],
            vel(0.025 + 0.012 * buildSeg + 0.003 * pos));
        }
      }
      // the fill hierarchy: a full-bar statement into a new part, the
      // phrase-end answer (when the phrase rolled the drum flavor), and an
      // occasional small shrug at half-phrase tails. Never during a build
      // (the roll owns those bars), never in the breather or breakdown
      if (pos === 0) {
        engine.drumFill = null;
        if (!buildOn && !breather && !bridgeDown && !lean &&
            engine.piece && engine.stage >= 0.35) {
          const fr = dicer("fill:" + engine.piece.num + ":" + bar);
          if (bar % 16 === 15 && engine.stage >= 0.5) {
            engine.drumFill = pick(DRUMFILLS.large, null, fr);
          } else if (bar % 8 === 7 && engine.fill === "toms") {
            engine.drumFill = pick(DRUMFILLS.medium, null, fr);
          } else if (bar % 4 === 3 && fr() < 0.3) {
            engine.drumFill = pick(DRUMFILLS.small, null, fr);
          }
        }
      }
      if (engine.drumFill) {
        playFill(t, engine.drumFill, pos,
          (0.5 + 0.5 * engine.stage) * wake *
          (engine.piece && engine.piece.mood === "deep" ? 0.8 : 1));
      }
      // accel percussion: shaker/toms in the background, swelling with force
      if (pos % 2 === 1 && (!lean || pos % 4 === 1)) shaker(hum(t, pos), vel((0.015 + 0.1 * push) * wake));
      if ((pos === 5 || pos === 13) && push > 0.05) tom(t, pos === 5 ? 150 : 120, 0.03 + 0.15 * push);
      // Daði charm: the blip voice answers the arp — one bar in four, quiet
      if (engine.blips && bar % 4 === 2 && !lean) {
        const bmap = { 6: 0, 10: 1, 13: 2 };
        if (pos in bmap) blip(hum(t, pos), F(engine.blipSeq[bmap[pos]]), vel(0.07));
      }
      // Parov seasoning: brass stab anticipates the one — every 4th bar, a spice
      if (engine.brassy && pos === 14 && bar % 4 === 1 && !breather && !flowMode && !lean) {
        brassHit(t, progEff[ciNext], vel(0.09 + 0.07 * e));
      }
      // bridge rebuild: after the breakdown the drums return, and a long riser
      // carries the last bars into the chorus drop
      if (engine.partLabel === "C" && bar % 16 === 13 && pos === 0) fillSwell(t, SPB * 40);
      // lift drama: a riser announces it, open hats carry the hymn, Rhodes doubles
      if (liftK === 2 && pos === 8) fillSwell(t, SPB * 24);
      if (liftPhase && pos % 8 === 4) hat(t, true, 0.11);
      // between lifts the pedal must not fall asleep: every other 8-bar
      // phrase the Rhodes answers on the and-of-two — the carrier rotates
      if (flowMode && !liftPhase && pos === 6 && bar % 2 === 0 &&
          Math.floor(bar / 8) % 2 === 1 && !lean) {
        rhodesChord(hum(t, pos), progEff[ci], 0.07);
      }
      if (liftPhase && pos === 0 && bar % 2 === 0) {
        rhodesChord(t, progEff[ci], 0.11);
      }
      // Rhodes comping: a soft chord dab answers on the and-of-two in town —
      // but not when the Rhodes already IS the chord voice (keys/broken):
      // one instrument must not collide with itself in two roles
      if (u > 0.15 && pos === 6 && bar % 2 === 0 && !breather &&
          engine.padStyle !== "keys" && engine.padStyle !== "broken") {
        rhodesChord(hum(t, pos), progEff[ci], vel(0.05 + 0.08 * u));
      }
      // urban detail: a real syncopated groove, gone on the open road
      if (u > 0.05 && !bridgeDown && !lean) {
        const uw = u * wake;
        if (pos === 3) perc(hum(t, pos), vel(0.16 * uw));
        if (pos === 6) perc(hum(t, pos), vel(0.1 * uw));
        if (pos === 10) perc(hum(t, pos), vel(0.13 * uw));
        if (pos === 14) perc(hum(t, pos), vel(0.08 * uw));
        if (pos % 4 === 3) shaker(hum(t, pos), vel(0.05 * uw));
      }
      // phrase-end fill, drawn from the pool once per phrase
      if (turnaround) {
        if (engine.fill === "sweep" && pos >= 12) {
          arpNote(t, F(engine.arpSeq[(pos - 12) * 2 % 8] + 12), 2400, vel(0.055), SPB * 0.9);
        }
        if (engine.fill === "swell" && pos === 8) fillSwell(t, SPB * 8);
        if (pos === 14) hat(t, true, 0.09); // open hat breathes the phrase out
      }
    }
    // launch fill: a quick descending tom run introduces the beat
    if (engine.fillAt >= 0) {
      const k = s - engine.fillAt;
      if (k >= 0 && k < 8) tom(t, 230 - k * 16, 0.09 + 0.025 * k);
      if (k >= 8) engine.fillAt = -1;
    }
    // arp: relaxed 8ths in town, hypnotic long notes on the highway;
    // phrase ends run the figure backwards, sections shift its octave
    const onBeat = pos % 4 === 0;
    // the motorway thins the arp by letting its offbeats recede, not by
    // switching rate: a rate change under a held note is heard as a stumble
    const offbeatLevel = lean ? 0 : 1 - ff * (liftPhase ? 0.3 : 1);
    const arpHit = pos % 2 === 0 && (onBeat || offbeatLevel > 0.02);
    if (arpHit) {
      const seq = turnaround ? engine.arpSeq.slice().reverse() : engine.arpSeq;
      // At rest the cutoff used to fall to 340 Hz — on a car stereo that is
      // indistinguishable from silence, and a standstill that sounds like a
      // crash is a crash as far as the listener is concerned. The idle floor
      // is now high enough to be clearly present, just soft
      idleCut = 900 + 1600 * clamp(e, 0, 0.8);
      // accent contour: downbeats lean forward, offbeats sit back — not uniform
      const accent = (onBeat ? 1.15 : 0.9) * (onBeat ? 1 : offbeatLevel);
      // note lengths breathe too: downbeats ring longer than offbeats —
      // a line of uniform lengths is the "stur" the field report named
      arpNote(t, F(seq[Math.floor(s / 2) % 8] + (liftPhase ? 12 : engine.arpOct)),
        idleCut * (0.8 + 0.2 * Math.sin(t * 0.3)) + 700 * push,
        vel(0.07 * accent), flowHigh > 0.6 ? SPB * 3.6 : SPB * (onBeat ? 2.2 : 1.6));
    }
    // harmonic rhythm: per bar, held two bars, or pushed in ahead of the one.
    // During the lift the pad grows brighter and half again as large
    const moodF = engine.piece
      ? (engine.piece.mood === "deep" ? 0.88 : engine.piece.mood === "anthem" ? 1.12 : 1) : 1;
    const padVol = (0.16 + 0.2 * flowHigh) * (breather ? 1.5 : 1) * (liftPhase ? 1.5 : 1)
      * moodF * (bridgeDown ? 1.35 : 1);
    const padCut = 950 + 350 * Math.sin(bar * 0.37) + (liftPhase ? 350 : 0);
    if (hrEff === "twobar") {
      if (pos === 0 && bar % 2 === 0) chordVoice(t, progEff[ci], SPB * 40, padVol, padCut);
    } else if (hrEff === "push") {
      // anticipation is a PHRASE gesture, not a constant: pushing EVERY bar
      // re-normalizes the ear until the anticipation reads as the downbeat
      // and the one dissolves (field report). Only the change INTO each
      // 4-bar phrase leans in early; every other chord lands on its one
      // every bar re-voices on its one, and the chord RINGS PAST the next
      // barline (pad() shaves durations by 0.85, so SPB*22 is ~1.17 bars):
      // the crossfade is the transition — a wash that dies before the one
      // reads as a hole, and the field report heard exactly that. The
      // anticipation became a short lead-in the one then confirms
      if (pos === 0) chordVoice(t, progEff[ci], SPB * 22, padVol, padCut);
      if (pos === 14 && bar % 4 === 3 && bar % 16 !== 15) {
        chordVoice(t, progEff[ciNext], SPB * 6, padVol * 0.8, padCut);
        // the pad's slow attack smears the anticipation — Rhodes announces it.
        // Only for the wash: the keys style already rolls its own Rhodes
        if (engine.padStyle === "wash") rhodesChord(t, progEff[ciNext], 0.08 + 0.05 * e);
        // and the BAND plays the push: a quiet bass pickup on the new root,
        // an octave up — the one keeps the low register and stays the anchor
        if (!still && !breather && !bridgeDown && !lean) {
          bassNote(bassT(t), F(rootsEff[ciNext] + 12), 700, vel(0.09 * wake), SPB * 0.9);
        }
      }
    } else if (hrEff === "sync") {
      // the next phrase's chord arrives at an odd spot — same sparseness rule
      if (pos === 0) chordVoice(t, progEff[ci], SPB * 22, padVol, padCut);
      if (pos === engine.syncPos && bar % 4 === 3 && bar % 16 !== 15) {
        chordVoice(t, progEff[ciNext], SPB * (18 - engine.syncPos), padVol * 0.8, padCut);
        if (engine.padStyle === "wash") rhodesChord(t, progEff[ciNext], 0.08 + 0.05 * e);
        if (!still && !breather && !bridgeDown && !lean) {
          bassNote(bassT(t), F(rootsEff[ciNext] + 12), 700, vel(0.09 * wake), SPB * 0.9);
        }
      }
    } else {
      if (pos === 0) chordVoice(t, progEff[ci], SPB * 20, padVol, padCut);
    }
    // broken/gate styles: the chords live as figures, not as a carpet
    if (!engine.flowOn && !still && !lean) {
      const chordNow = progEff[ci];
      if (engine.padStyle === "broken" && pos % 2 === 0) {
        // the chord flows: Rhodes single notes walking the voicing in 8ths
        const bi = engine.brokenPat[Math.floor(s / 2) % 8];
        const m = chordNow[Math.min(bi, chordNow.length - 1)];
        if (rhodes && rhodes.loaded) {
          rhodes.triggerAttackRelease(F(m), SPB * 3, at("rhodes", hum(t, pos)),
            pos === 0 ? 0.5 : 0.32);
        } else {
          blip(hum(t, pos), F(m), vel(0.05));
        }
      }
    }
    // the gate: a held chord, tremolo'd. Its level is scheduled on EVERY step,
    // gated section or not, so the automation can never be left half-open when
    // a section changes underneath it
    if (gateAmp) {
      const gateOn = engine.padStyle === "gate" && !engine.flowOn && !still && !bridgeDown && !lean;
      if (gateOn) {
        // re-voice only when the harmony actually moves — the gate's whole
        // point is that the chord is continuous underneath the rhythm
        const barChanges = hrEff === "twobar" ? bar % 2 === 0 : true;
        if (pos === 0 && barChanges) gateHold(t, progEff[ci]);
        // a gated section must not arrive at full force on its downbeat: it
        // swells in over three bars, so the ear meets a change, not a switch.
        // And it closes to a FLOOR, never to silence — that floor is the
        // difference between a pulse and a chop
        const ramp = clamp((engine.barInPart + 1) / 3, 0.35, 1);
        const on = engine.gatePat[pos];
        gateLevel(t, (on ? (pos % 4 === 0 ? 1 : 0.84) : 0.3) * ramp, !!on);
      } else {
        if (pos === 0) gateS.releaseAll(t);
        gateLevel(t, 0, false);
      }
    }
    // the hook riff: the piece's identity — chorus only. Same-same-DIFFERENT:
    // exact repeats teach it first, then it earns play — an octave pop the
    // second time around, a tail flourish into turnarounds, one dropout bar
    // (the listener sings it), and sometimes an octave lift for the return.
    // Bars 8–11 REST: a hook that never leaves has nothing to return to,
    // and the arrangement (brass, fills) gets a window to answer in
    // dub presents the motif as a FRAGMENT: the horn states the call and the
    // response bars stay empty — the room answers. Same DNA, other hand
    if (engine.partLabel === "B" && !still && !breather && engine.piece &&
        (bar % 16 < 8 || bar % 16 >= 12) && bar % 16 !== 13 &&
        !(engine.lead === "warm" && bar % 2 === 1)) {
      const hb = bar % 16;
      const answering = bar % 2 === 1;
      const full = answering ? engine.piece.hook.resp : engine.piece.hook.call;
      // An answer that is as insistent as its call is not an answer, it is the
      // riff played twice — and twice as much of anything is how a hook turns
      // into a foreign body. The response keeps only its opening and its
      // ending, so the shape survives while the density halves
      const line = answering && full.length > 2
        ? [full[0], full[full.length - 1]] : full;
      const lift = engine.hookLift && hb >= 12 ? 12 : 0;
      const n = line.find((x) => x.p === pos);
      if (n) {
        const isLast = n === line[line.length - 1];
        let sN = n.s + lift;
        if (isLast && hb === 5) sN += 12; // octave pop, second time around
        const fr = 57 + sN;
        // Dynamics are what let a repeated figure breathe: the answer sits
        // back, the return from the rest window leans in a little, and the
        // ornaments are played SOFTER than the plain statement rather than
        // louder — an ornament earns attention by being different, and one
        // that also shouts is the thing you end up wanting to turn down
        const gain = (answering ? 0.82 : 1) * (hb === 12 ? 1.12 : 1);
        if (!flowMode || PENTA.includes(fr % 12)) {
          if (isLast && hb === 7 && hookThrowG) {
            // the throw: this tail note answers from the empty rest bars —
            // the send opens for it alone, the next barline closes it
            hookThrowG.gain.setValueAtTime(1.4, t);
          }
          if (isLast && (hb === 7 || hb === 15)) {
            // tail flourish: the ending splits and falls into the turnaround
            hookNote(hum(t, pos), F(Math.min(fr + 12, 81)), SPB * 0.9, vel(0.11 * n.a * gain));
            hookNote(hum(t, pos) + SPB, F(fr), SPB * Math.max(n.d - 1, 1) * 0.9,
              vel(0.15 * n.a * gain));
          } else {
            hookNote(hum(t, pos), F(fr), SPB * n.d * 0.9,
              vel(0.17 * n.a * gain * (isLast && hb === 5 ? 0.8 : 1)));
          }
        }
      }
    }
    if (s === pendingLaunchAt) {
      impact(t);
      pendingLaunchAt = -1;
    }
  }

  // ---- public API ----------------------------------------------------------

  // the engine keeps its own monotonic clock so it never depends on the page's
  // frame timestamps — a test can drive it with synthetic dt values
  let clock = 0;

  // continuous mappings: called once per frame with the drive's current force
  // picture. speed in km/h, lateralG in -1..1. Everything here is smoothed and
  // therefore latency-immune — the ear has no reference for "what 120 km/h
  // should sound like right now"
  function update(dtRaw, input) {
    if (!engine.running) return;
    // a frame delta that is negative, zero-length or absurd turns every
    // exponential smoother into a divergence, and a diverging gain is the
    // crack this whole guard exists to prevent
    const dt = Number.isFinite(dtRaw) ? clamp(dtRaw, 0, 0.25) : 0.016;
    clock += dt * 1000;
    watchdog();

    const speed = clamp(Number(input && input.speed) || 0, 0, 300);
    const lat = clamp(Number(input && input.lateralG) || 0, -1, 1);

    // Energy rises SLOWLY and falls at the old rate. Pulling away gently still
    // reaches 30 km/h within a few seconds, and at the old 1.4 s the whole
    // arrangement arrived in one lump — which is heard as the music being
    // switched on rather than starting. A traffic-light sprint is unaffected:
    // launchBoost bypasses this and lands on the beat
    const target = clamp(speed / 110, 0, 1);
    const rising = target > engine.energy;
    engine.energy += (target - engine.energy) *
      (1 - Math.exp(-dt / (rising ? 3.2 : 1.2)));
    // the rhythm section fades in rather than appearing: "standstill" was a
    // hard switch, and a hard switch is exactly what an abrupt swell is
    // A gentle pull-away blooms over seconds. A traffic-light sprint must NOT:
    // it is the one moment the whole design exists for, and making it wait for
    // the same fade turns the launch into a slow swell — the exact fault the
    // fade was added to remove, moved to the other end
    // Scene layers must GROW, not switch on. The motorway used to arrive as a
    // threshold: cross it and a sustained bass appears, the arp changes rate and
    // the harmony changes source, all at once and at full strength. A layer that
    // switches on is heard as a mistake; a layer that grows is the scene opening
    const flowTarget = engine.flowOn ? 1 : 0;
    engine.flowFade += (flowTarget - engine.flowFade) * (1 - Math.exp(-dt / 2.6));

    const launching = engine.launchBoost > 0.2;
    const awake = engine.energy > 0.055 || launching ? 1 : 0;
    const wakeTau = awake > engine.wake ? (launching ? 0.12 : 2.2) : 0.9;
    engine.wake += (awake - engine.wake) * (1 - Math.exp(-dt / wakeTau));
    engine.launchBoost = Math.max(0, engine.launchBoost - dt / (SPB * 64));

    // launch detection: standstill -> first movement the engine can see.
    // Standstill is a musical STATE that arms the launch, so the first
    // detected movement releases it instantly despite GPS lag
    if (speed < 2.5) {
      if (engine.standstillSince == null) engine.standstillSince = clock;
      if (clock - engine.standstillSince > 1500) engine.armed = true;
    } else {
      engine.standstillSince = null;
    }
    // A launch is a SPRINT, not merely leaving a standstill. Rolling away
    // gently crosses the same threshold, and treating that as a launch is what
    // made every departure arrive in one lump. The threshold is read at the
    // MOMENT of crossing, where the half-second smoother has only seen a third
    // of the acceleration — so 7 here separates a real sprint (about 10 by
    // then) from an ordinary pull-away (about 5), not 28 from 6
    // which scene is the film in? Needs the fresh standstill clock above
    classifyScene(dt, speed, !!(input && input.reversal));
    if (engine.armed && speed > 6 && engine.prevEst <= 6 && engine.accelEst > 7) {
      engine.armed = false;
      engine.launchBoost = 1;
      engine.pullChorus = true; // the sprint deserves the payoff part
      // fire on next 8th note; a tom fill introduces the beat
      const stepsAhead = 2 - (stepIdx % 2);
      pendingLaunchAt = stepIdx + stepsAhead;
      engine.fillAt = pendingLaunchAt;
    }
    // thrust follows ACCELERATION, not speed — asymmetric: swells in, ebbs out
    const accelRaw = dt > 0 ? (speed - engine.prevEst) / dt : 0; // km/h per s
    engine.prevEst = speed;
    engine.accelEst += (accelRaw - engine.accelEst) * (1 - Math.exp(-dt / 0.5));
    const thrustTarget = clamp(engine.accelEst / 20, 0, 1);
    engine.thrust += (thrustTarget - engine.thrust) *
      (1 - Math.exp(-dt / (thrustTarget > engine.thrust ? 0.7 : 1.6)));
    const thrust = engine.thrust;
    ctl(thrustSubGain.gain, "thrustSub", thrust * 0.3, 0.008);
    ctl(growlLp.frequency, "growlLp", 160 + 1000 * thrust, 15);
    // braking = force too: pressure plus the master filter closing over the mix
    const brakeTarget = clamp(-engine.accelEst / 16, 0, 1);
    engine.brake += (brakeTarget - engine.brake) *
      (1 - Math.exp(-dt / (brakeTarget > engine.brake ? 0.4 : 1.1)));
    const brake = engine.brake;
    ctl(brakeGain.gain, "brakeGain", brake * 0.5, 0.008);
    ctl(brakeOscGain.gain, "brakeOsc", brake * 0.32, 0.008);
    ctl(brakeOsc.frequency, "brakeOscF", 88 - 46 * brake, 0.8);
    ctl(tensionLp.frequency, "tensionLp", 1200 + 16800 * Math.pow(1 - brake, 2), 120);
    // Curve: the mix slides OUTWARD, the way you are pushed. Leaning into the
    // turn was the intuitive reading and the wrong one — the pseudo-force in a
    // right-hand bend points left, so audio that moves right contradicts what
    // the body feels, and sensory conflict is the motion-sickness mechanism
    ctl(panner.pan, "pan", (opts.curveOutward ? -lat : lat) * 0.45, 0.008);
    ctl(delayRet.gain, "delayRet", 0.6 + Math.abs(lat) * 0.9, 0.01);
    const gAbs = Math.abs(lat);
    ctl(stretchGain.gain, "stretch", gAbs * 0.16 * clamp(speed / 50, 0, 1), 0.004);
    ctl(stretchBp.frequency, "stretchBp", 2100 + 1900 * gAbs, 25);
    // urban weight: city speed band, fades out toward the highway
    // 12 -> 24 km/h took the city groove from nothing to everything, and that
    // is a band a car crosses in about two seconds. Spread over 10 -> 45 it
    // arrives with the driving rather than on top of it
    engine.urban = clamp((speed - 10) / 35, 0, 1) * (1 - clamp((speed - 70) / 30, 0, 1));

    // Scene loudness. The highway arrangement thins ON PURPOSE — the bass pulls
    // back 40 %, the kick 18 %, the hats more than half — and without
    // compensation the music simply gets quieter the faster you go, which is
    // heard as a mix that stops working rather than as a scene that opens up.
    // The city is the opposite case: its percussion groove adds a whole layer,
    // so the drum family steps back a touch to make room for it
    // depth: positive = receding under thrust, negative = coming forward
    const depth = opts.inertiaDepth ? clamp(thrust - brake, -1, 1) : 0;
    // Hearing is not linear, and a car spends its life in the lower half of
    // this range: an ordinary pull-away reads about 0.3, and the old linear
    // mapping answered that with a 14 kHz lowpass — a band with barely any
    // music in it — and three tenths of a decibel. A fractional-power curve
    // gives the common case something to say, and the filter moves in octaves
    // rather than in hertz, which is how the ear measures it
    const dEff = Math.sign(depth) * Math.pow(Math.abs(depth), 0.55);
    ctl(revSend.gain, "revSend",
      (0.4 + (dEff > 0 ? 0.42 * dEff : 0.15 * dEff)) * (engine.worldRoom || 1), 0.008);
    ctl(depthLp.frequency, "depthLp",
      18000 * Math.pow(0.22, Math.max(dEff, 0)), 100);
    ctl(depthGain.gain, "depthGain",
      1 - 0.2 * Math.max(dEff, 0) + 0.08 * Math.max(-dEff, 0), 0.006);

    // the air bed breathes with the drive: present at cruise, more in a
    // deep piece, less in an anthem, ducked under braking, gone at rest
    const moodAtmo = engine.piece
      ? (engine.piece.mood === "deep" ? 1.3 : engine.piece.mood === "anthem" ? 0.7 : 1) : 1;
    ctl(atmoGain.gain, "atmo",
      0.022 * engine.wake * moodAtmo * (1 - 0.6 * engine.brake), 0.002);

    // the warp — auditory exclusion, simulated: under high sympathetic
    // arousal hearing narrows (sounds report muffled and distant, the
    // middle-ear reflex damps transmission), and film sound has codified
    // exactly that: the score ducks and lowpasses, the mechanical roar
    // stays near. Engages above a hard push, releases on a steady cruise
    const warpT = clamp((thrust - 0.4) / 0.4, 0, 1);
    engine.warp += (warpT - engine.warp) *
      (1 - Math.exp(-dt / (warpT > engine.warp ? 0.5 : 1.4)));
    const wp = engine.warp;
    ctl(warpLp.frequency, "warpLp", 16000 * Math.pow(0.08, wp), 120);
    ctl(warpGain.gain, "warpGain", 1 - 0.5 * wp, 0.006);

    const eNow = clamp(engine.energy + engine.launchBoost * 0.3, 0, 1);
    const flowHigh = clamp((eNow - 0.5) / 0.35, 0, 1);
    ctl(makeup.gain, "makeup", 1 + 0.16 * flowHigh, 0.006, 0.2);
    ctl(busDrums.gain, "busDrums",
      (1 - 0.08 * engine.urban) * (1 - 0.3 * wp), 0.006, 0.2);
    // the car voicing (see the node comments): dB gains, flat when A/B'd off
    ctl(carLow.gain, "carLow", opts.carMix ? -4.5 : 0, 0.05, 0.2);
    ctl(carPres.gain, "carPres", opts.carMix ? 2.5 : 0, 0.05, 0.2);
  }

  // Silence has exactly two shapes and they need different answers: the clock
  // stopped ticking (no more steps at all), or it ticks while the mix is turned
  // down. Telling them apart is the difference between guessing and knowing,
  // and each one gets one attempt at recovery before it is merely reported
  let lastStepSeen = -1, lastStepAt = 0, stalls = 0;
  function watchdog() {
    if (clock - lastResumeAt < 1000) return;
    lastResumeAt = clock;
    try {
      const c = Tone.getContext();
      const state = c.state || (c.rawContext && c.rawContext.state);
      if (state && state !== "running") {
        resumes++;
        note("audio", "context " + state + " — resuming");
        resume();
      }
    } catch (err) { void err; }

    // The transport callback has stopped firing. A field report showed the whole
    // main thread frozen for fourteen seconds; the page came back and the music
    // did not. The freeze is the browser's business — coming back from it is
    // ours. Nudge once, then rebuild the entire graph, then stop pretending
    if (stepIdx === lastStepSeen && clock - lastStepAt > 1500) {
      stalls++;
      lastStepAt = clock;
      if (stalls === 1) {
        note("stall", "no step for 1500ms at step " + stepIdx + " — restarting transport");
        try { transport.start(); } catch (err) { note("stall", "restart failed: " + err); }
      } else if (stalls === 2) {
        note("stall", "still no step at " + stepIdx + " — rebuild from scratch");
        rebuild();
      }
    } else if (stepIdx !== lastStepSeen) {
      lastStepSeen = stepIdx;
      lastStepAt = clock;
    }

    // it ticks, but the mix is down and no drop gap is running
    if (master && engine.dropAt < 0 && master.gain.value < 0.5) {
      note("mute", "master at " + master.gain.value.toFixed(3) + " — restoring");
      try { master.gain.rampTo(0.9, 0.05); } catch (err) { void err; }
    }
    if (duck && duck.gain.value < 0.5) {
      note("mute", "duck at " + duck.gain.value.toFixed(3) + " — restoring");
      try { duck.gain.rampTo(1, 0.05); } catch (err) { void err; }
    }
  }

  // The last resort: tear the graph down and build it again. Everything musical
  // restarts — a new piece, from the top — which is a real cost, and still far
  // better than a drive that has gone quiet for good
  let rebuilding = false;
  function rebuild() {
    if (rebuilding) return;
    rebuilding = true;
    Promise.resolve()
      .then(() => { stop(); })
      .then(() => start())
      .then((okStart) => { note("stall", okStart ? "rebuilt" : "rebuild refused"); })
      .catch((err) => note("stall", "rebuild failed: " + ((err && err.message) || err)))
      .finally(() => { rebuilding = false; });
  }

  // what the drive is doing, in one word — the only readout the driver page shows
  function status() {
    const e = clamp(engine.energy + engine.launchBoost * 0.3, 0, 1);
    if (engine.launchBoost > 0.5) return { text: "LAUNCH", kind: "launch" };
    if (engine.thrust > 0.4) return { text: "Schub", kind: "launch" };
    if (engine.brake > 0.45) return { text: "Bremsen", kind: "launch" };
    // the farewell outranks the stillness readouts: it IS one, with a story
    if (engine.scene === "coda") return { text: "Ausklang", kind: "" };
    if (e < 0.06) {
      // an armed launch is the one thing worth saying at any standstill
      if (engine.armed) return { text: "Stand — geladen", kind: "" };
      if (engine.scene === "ouverture") return { text: "Aufwärmen", kind: "" };
      if (engine.scene === "patience") return { text: "Geduld", kind: "" };
      if (engine.scene === "breath") return { text: "Atempause", kind: "" };
      return { text: "Stand", kind: "" };
    }
    if (engine.scene === "patience") return { text: "Geduld", kind: "cruise" };
    if (e > 0.75) return { text: "Autobahn-Flow", kind: "high" };
    if (engine.urban > 0.6) return { text: "Stadt", kind: "cruise" };
    return { text: "Cruise", kind: "cruise" };
  }

  // the full arrangement picture, as DATA — the test bench renders it as a
  // dashboard, the driver page ignores it. Returns null before the first piece
  function describe() {
    if (!engine.piece || !engine.partLabel) return null;
    const p = engine.piece;
    const chips = [
      ["Key", KEYNAMES[String(p.tp)] || "Am"],
      ["Rezept", engine.recipe],
      ["Bogen", p.arcName],
      ["Harmonik", p.paletteName],
      ["Klang", p.world],
      ["Motiv", p.hook.call.map((n) => n.s).join("·")],
      p.mood !== "neutral" ? ["Mood", p.mood === "deep" ? "Deep" : "Anthem"] : null,
      ["Akkorde", engine.hr === "sync" ? "sync·" + (engine.syncPos === 12 ? "4" : "3+") : engine.hr],
      ["Chords", engine.padStyle],
      ["Bass", "P" + (BASSPATS.indexOf(engine.bassPat) + 1)
        + (engine.bassMel ? "·Mel" : "") + (engine.bassFill ? "·Pops" : "")
        + (engine.ghosts ? "·Ghosts" : "")],
      engine.snare ? ["Drums", "Snare"] : null,
      engine.partLabel === "B" ? ["Hook", engine.hookLift ? "an·8va" : "an"] : null,
      engine.lick ? ["Lick", String(LICKS.indexOf(engine.lick) + 1)] : null,
      engine.blips ? ["Blips", "an"] : null,
      engine.brassy ? ["Brass", "an"] : null,
      engine.arpOct ? ["Arp", "+8va"] : null,
    ].filter(Boolean);
    if (Date.now() < engine.lickFlashUntil) chips.push(["hot", "▶ LICK"]);
    if (engine.liftActive) chips.push(["hot", "▲ LIFT"]);
    if (engine.partLabel === "C" && engine.barInPart < 8) chips.push(["hot", "▼ BREAK"]);
    return {
      form: p.form, idx: p.idx, num: p.num,
      partLabel: engine.partLabel, partName: PART_NAMES[engine.partLabel],
      bar: engine.barInPart + 1, chips,
    };
  }

  let building = false;

  async function start() {
    if (building || engine.running) return false;
    building = true;
    // clear the record FIRST: anything that happens during start-up (a sample
    // load that times out, a context that refuses to resume) is exactly what a
    // slow start needs explained, and clearing afterwards erased it
    events.length = 0; errCount = 0; resumes = 0; lastResumeAt = 0;
    stalls = 0; lateSteps = 0; worstLate = 0; dropCount = 0;
    try {
      configureContext();
      await Tone.start();
      await buildGraph();
      // Sample buffers (Rhodes, muted guitar). A failed load must never block
      // play — but neither must a SLOW one: on a weak connection Tone.loaded()
      // simply never settles, and the start button sits on "preparing audio"
      // forever. The synth fallbacks are already in the graph, so after a few
      // seconds we start without the samples and let them arrive late
      try {
        await Promise.race([
          Tone.loaded(),
          new Promise((r) => setTimeout(() => { note("samples", "load timed out"); r(); }, 6000)),
        ]);
      } catch (err) { note("samples", (err && err.message) || err); }
    } finally {
      building = false;
    }
    engine.energy = 0; engine.launchBoost = 0;
    engine.armed = false; engine.standstillSince = null; engine.prevEst = 0;
    engine.accelEst = 0; engine.thrust = 0;
    engine.brake = 0; engine.urban = 0; engine.wake = 0; engine.flowFade = 0;
    engine.fillAt = -1;
    engine.prog = PROGS[0]; engine.roots = ROOTS[0]; engine.bassPat = BASSPATS[0];
    engine.arpSeq = ARPS[0]; engine.arpOct = 0;
    engine.hr = "bar"; engine.fill = "toms"; engine.ghosts = false;
    engine.drumFill = null;
    engine.bassFill = false; engine.blips = false; engine.blipSeq = BLIPS[0]; engine.brassy = false;
    engine.lick = null; engine.bassMel = null;
    engine.syncPos = 12; engine.snare = false; engine.padStyle = "wash";
    engine.liftActive = false; engine.pullChorus = false; engine.dropAt = -1;
    engine.lean = false;
    engine.recipe = "club"; engine.grooveName = "four";
    engine.groove = GROOVES.four; engine.lead = "guitar";
    engine.stage = 1; engine.snareGhosts = false;
    engine.stageBase = 1; engine.rolledFlags = null; engine.gatesDirty = false;
    engine.scene = "ouverture"; engine.sceneCap = SCENE_CAP.ouverture;
    engine.sceneHushPending = false; engine.everCruised = false;
    engine.cruiseHold = 0; engine.stopLog = []; engine.wasMoving = false;
    engine.revArmedUntil = -1; engine.codaAt = null; engine.codaProgress = 0;
    engine.codaResolved = false; engine.susVoiced = 0;
    engine.warp = 0;
    engine.riseOn = false; riseVoices = []; riseLog = []; riseNextAt = 0;
    risePeak = 0; riseArrivalAt = -1;
    riseHot = 0; riseFull = false; riseLastFullAt = -Infinity;
    engine.flowOn = false; engine.piece = null; engine.partLabel = "";
    engine.flowStartBar = 0; engine.liftStart = -1; engine.liftArm = -1;
    engine.lastLiftEnd = -1e9;
    // resume the residency: the saved set decides where the walk starts and
    // which episode plays next. This also runs on a mid-drive rebuild(), so
    // even the last-resort graph teardown no longer resets the set
    engine.setPrev = loadSet();
    engine.progIdx = engine.setPrev ? engine.setPrev.progIdx : 0;
    engine.setMotif = engine.setPrev ? engine.setPrev.motif : null;
    stepIdx = 0; pendingLaunchAt = -1; tp = 0; clock = 0;
    // the composition dice reseed per session: one draw from the global
    // stream anchors every keyed stream, so a test that seeds Math.random
    // still owns every composed outcome deterministically
    diceSeed = String(Math.random()); diceStreams.clear();
    sched.clear(); ctlLast.clear(); stepCost = 0; peakCost = 0;
    strain = 0; strainSteps = 0; totalSteps = 0;
    lastStepSeen = -1; lastStepAt = 0;
    fxShed = false; // a fresh graph is always the full graph
    startRenderProbe();
    transport = Tone.getTransport();
    transport.bpm.value = BPM;
    transport.swing = 0.22; // light 16th shuffle — the pulse stays straight
    transport.swingSubdivision = "16n";
    repeatId = transport.scheduleRepeat((time) => {
      const t0 = nowMs();
      // Is the scheduler still ahead of the clock? A step whose events are
      // already in the past does not get played later — Web Audio fires it
      // IMMEDIATELY, so a backlog arrives as one burst. That burst is what a
      // listener calls a crack, and it is the single most likely explanation
      // for "a crack, then silence" on a device at its limit
      let lateBy = 0;
      try {
        // Measure against the RAW context clock. Tone.now() already includes
        // the 250 ms look-ahead, so measuring against it counts a step with
        // "only" 130 ms of lead as late — which it is not: its events are still
        // comfortably in the future. That mistake reported 95 late steps at 2 %
        // load and thinned the arrangement out for nothing
        const c = Tone.getContext();
        const audioNow = c.rawContext ? c.rawContext.currentTime : c.currentTime;
        lateBy = audioNow - time;
        if (lateBy > 0.005) {
          lateSteps++;
          worstLate = Math.max(worstLate, lateBy);
          if (lateSteps === 1 || lateSteps % 50 === 0) {
            note("late", "scheduler " + Math.round(lateBy * 1000) + "ms behind (" +
              lateSteps + " steps)");
          }
          // the obvious response, not just a note: a device that fell behind
          // 250 ms of slack once gets 500 ms for the rest of the session.
          // The main thread would now have to block half a second at a stretch
          // before the next burst. Cost: musical gestures land a beat later —
          // only on devices that have proven they need the slack
          if (!lookRaised && stepIdx > 32) {
            lookRaised = true;
            try { c.lookAhead = LOOK_RAISED; } catch (err) { void err; }
            note("late", "lookahead raised to " + Math.round(LOOK_RAISED * 1000) + "ms");
          }
        }
      } catch (err) { void err; }
      // An exception thrown here used to end the music: the callback dies and
      // every later step goes with it. Nothing the sequencer can get wrong is
      // worth silence — a swallowed step is a missing note, and the record of
      // it is what a field test brings home
      try {
        onStep(stepIdx++, time);
      } catch (err) {
        errCount++;
        if (errCount <= 5) note("step", (err && err.message) || err);
      }
      const cost = (nowMs() - t0) / (SPB * 1000);
      stepCost += (cost - stepCost) * 0.05;
      // the first steps carry graph warm-up and first-piece setup; counting
      // them as the peak would make every device look overloaded
      if (stepIdx > 32) peakCost = Math.max(peakCost, cost);
      const was = strain > 0.5;
      // genuinely late — the events are in the PAST, so they fire as a
      // burst. That is the failure itself, not a warning
      if (lateBy > 0.005 && stepIdx > 32) strain = 1;
      else if (cost > 0.45) strain = Math.min(1, strain + 0.15);
      else if (cost < 0.3) strain = Math.max(0, strain - 0.02);
      totalSteps++;
      if (strain > 0.5) strainSteps++;
      if (was !== strain > 0.5) {
        note("strain", (was ? "recovered at " : "thinning out at ") +
          Math.round(stepCost * 100) + "% load");
      }
    }, "16n");
    transport.start("+0.05");
    engine.running = true;
    return true;
  }

  function stop() {
    if (!engine.running) return;
    engine.running = false;
    stopRenderProbe();
    transport.stop();
    if (repeatId !== null) transport.clear(repeatId);
    transport.cancel(0);
    master.gain.rampTo(0.0001, 0.1);
    const old = nodes; nodes = [];
    setTimeout(() => { for (const n of old) { try { n.dispose(); } catch (err) { void err; } } }, 700);
  }

  // how hard the drive is pushing right now, 0..1 — thrust or braking,
  // whichever dominates. The one number both pages put on a meter
  function force() { return Math.max(engine.thrust, engine.brake); }

  // A test seam, and the only way an automated check can tell "playing" from
  // "silent": both of these gains are automated by the music itself (the
  // sidechain, the drop gap), so a bug that parks one of them low is heard as
  // the music dying and is visible nowhere else
  const load = () => stepCost;
  const peakLoad = () => peakCost;
  // everything a stuck engine can say about itself
  function health() {
    let state = "?";
    try {
      const c = Tone.getContext();
      state = c.state || (c.rawContext && c.rawContext.state) || "?";
    } catch (err) { void err; }
    return {
      running: engine.running, step: stepIdx, audio: state,
      errors: errCount, resumes, stalls, lateSteps, worstLate, notes, idleCut,
      load: stepCost, peakLoad: peakCost,
      // the render thread's own account, where the browser gives one:
      // -1 means "no probe here", which is a different fact from "idle"
      renderLoad, renderPeak, underruns: underrunWins,
      strain, strainPct: totalSteps ? (strainSteps / totalSteps) * 100 : 0,
      lean: engine.lean,
      rise: riseVoices.filter(Boolean).length,
      flowFade: engine.flowFade,
      wake: engine.wake,
      events: events.slice(),
    };
  }
  const log = (kind, text) => note(kind, text);

  function levels() {
    return {
      master: master ? master.gain.value : 0,
      duck: duck ? duck.gain.value : 0,
      harm: busHarm ? busHarm.gain.value : 0,
      pan: panner ? panner.pan.value : 0,
      room: revSend ? revSend.gain.value : 0,
      air: depthLp ? depthLp.frequency.value : 0,
      drums: busDrums ? busDrums.gain.value : 0,
      makeup: makeup ? makeup.gain.value : 0,
    };
  }

  // A car browser may suspend audio when the page goes to the background or the
  // screen sleeps, and it does not always come back on its own
  async function resume() {
    try { await Tone.getContext().resume(); } catch (err) { void err; }
  }

  function setOption(key, value) {
    if (Object.prototype.hasOwnProperty.call(opts, key)) opts[key] = !!value;
    return { ...opts };
  }
  const options = () => ({ ...opts });

  window.Frunky = {
    start, stop, update, status, describe, force, levels, setOption, options, resume,
    load, peakLoad, health, log,
    isRunning: () => engine.running,
    isBuilding: () => building,
    // test seam: the parties of the fx shed, so a test can assert the
    // topology rather than trust the gesture (see performance.test.mjs)
    __graph: () => (revSend
      ? { chorus: chorus || null, revSend, reverb, padLp, gateLp, busHarm, shed: fxShed,
          masterHp, carLow, carPres, makeup }
      : null),
    // test seam: the album layer — which recipe frames the current piece and
    // which nodes its groove and lead actually strike, so a test can measure
    // the kick thinning and the hook changing hands rather than trust labels
    __album: () => ({
      recipe: engine.recipe, groove: engine.grooveName, lead: engine.lead,
      swing: transport ? transport.swing : 0,
      bassPatIdx: BASSPATS.indexOf(engine.bassPat),
      recipes: Object.fromEntries(RECIPES.map((r) =>
        [r.name, { groove: r.groove, lead: r.lead, bass: r.bass.slice() }])),
      nodes: kickS
        ? { kick: kickS, snare: snareS, guitar: hookGit, square: hookS,
            warm: leadTri, fuzz: leadFuzz, rhodes }
        : null,
    }),
    // test seam: the leitmotif — the set's melodic DNA and how the current
    // piece derives its hook from it, so a test can prove the recognition
    __motif: () => ({
      cells: JSON.parse(JSON.stringify(HOOKCELLS)),
      motif: engine.setMotif
        ? engine.setMotif.map((n) => [n.p, n.d, n.a, n.s]) : null,
      call: engine.piece ? engine.piece.hook.call.map((n) => n.s) : null,
      resp: engine.piece ? engine.piece.hook.resp.map((n) => n.s) : null,
    }),
    // test seam: the scene machine — which scene the score believes it is
    // in, what that costs the stage, and the coda's whole life cycle
    __scene: () => ({
      scene: engine.scene,
      cap: engine.sceneCap,
      codaProgress: engine.codaProgress,
      stops: engine.stopLog.length,
      revArmed: clock < engine.revArmedUntil,
      everCruised: engine.everCruised,
      paradeAllowed: paradeAllowed(),
      susVoiced: engine.susVoiced,
      nodes: bassSubS ? { bassSub: bassSubS, kick: kickS } : null,
    }),
    // test seam: the story arc — the piece's character, the current stage,
    // the gated flags AND the bundle's raw rolls, so a test can prove the
    // gate did real work (a gate nothing ever rolled against proves nothing)
    __arc: () => {
      const label = engine.partLabel;
      const b = engine.piece && label ? engine.piece.parts[label] : null;
      return {
        arcs: JSON.parse(JSON.stringify(ARCS)),
        pool: JSON.parse(JSON.stringify(ARC_POOL)),
        name: engine.piece ? engine.piece.arcName : null,
        stage: engine.stage,
        flags: { brassy: engine.brassy, blips: engine.blips, ghosts: engine.ghosts,
          bassFill: engine.bassFill, lick: !!engine.lick,
          snareGhosts: engine.snareGhosts, hookLift: engine.hookLift },
        rolled: b ? { brassy: b.brassy, blips: b.blips } : null,
        nodes: blipS ? { blip: blipS, brass: brassS } : null,
      };
    },
    // test seam: the sound world — the tables, the mood pools, the piece's
    // roll and what the voices are ACTUALLY set to, so a test can prove the
    // reorchestration reached the oscillators rather than trust the label
    __world: () => ({
      name: engine.piece ? engine.piece.world : null,
      applied: engine.worldApplied,
      cutScale: engine.worldCutScale,
      tables: JSON.parse(JSON.stringify(SOUNDWORLDS)),
      pool: JSON.parse(JSON.stringify(WORLD_POOL)),
      nodes: kickS ? { kick: kickS, hatC, hatO, snare: snareS, bass: bassS,
        bassLp, pad: padS, gate: gateS, blip: blipS } : null,
    }),
    // test seam: the harmonic palette — the tables with their smoothness
    // rules, the mood pools, and where the current piece stands, so a test
    // can prove the pivot/consonance/voice-leading rules and the walk-reset
    // rather than trust the gesture
    __palette: () => ({
      name: engine.piece ? engine.piece.paletteName : null,
      tables: JSON.parse(JSON.stringify(PALETTES)),
      pool: JSON.parse(JSON.stringify(PALETTE_POOL)),
      pieceProgs: engine.piece ? [engine.piece.parts.A.progIdx,
        engine.piece.parts.B.progIdx, engine.piece.parts.C.progIdx] : null,
    }),
    // test seam: the fill crate and the bar's chosen phrase, so a test can
    // prove the hierarchy plays rather than trust the tables
    __fills: () => ({
      crate: JSON.parse(JSON.stringify(DRUMFILLS)),
      current: engine.drumFill ? JSON.parse(JSON.stringify(engine.drumFill)) : null,
      nodes: tomS ? { tom: tomS, snare: snareS, kick: kickS } : null,
    }),
    // test seam: the drive's near/far split — the warp state, the moving
    // thrust sub, and the lanes, so a test can prove the force stays near
    // while the music recedes
    __drive: () => ({
      lift: { active: engine.liftStart >= 0, start: engine.liftStart,
        arm: engine.liftArm, lastEnd: engine.lastLiftEnd },
      warp: engine.warp,
      warpLpFreq: warpLp ? warpLp.frequency.value : null,
      warpGain: warpGain ? warpGain.gain.value : null,
      thrustSubFreq: thrustSub ? thrustSub.frequency.value : null,
      thrust: engine.thrust,
      nodes: warpLp
        ? { warpLp, warpGain, busDrive, busHarm, brakeGain, masterHp, busFx }
        : null,
    }),
    // test seam: the transition craft — the ride's filter, the throw's
    // send and the drop counter, so a test can watch tension build and
    // release rather than trust the gesture
    __transition: () => ({
      masterHpFreq: masterHp ? masterHp.frequency.value : null,
      throwGain: hookThrowG ? hookThrowG.gain.value : null,
      drops: dropCount,
      nodes: masterHp
        ? { masterHp, snare: snareS, snap: snareSnap, stab: stabS,
            hookThrow: hookThrowG }
        : null,
    }),
    // test seam: the stage — depth sends, static placement, the world's
    // room factor and the air bed, so a test can prove the mix has a stage
    // rather than trust the wiring
    __staging: () => (padRevG ? {
      sends: { pad: padRevG.gain.value, gate: gateRevG.gain.value,
        snare: snareSendG.gain.value },
      pans: { hat: hatPan.pan.value, shaker: shakerPan.pan.value,
        perc: percPan.pan.value, tom: tomPan.pan.value, blip: blipPan.pan.value,
        arp: arpPan.pan.value, rhodes: rhodesPan.pan.value },
      room: { engine: engine.worldRoom, revSend: revSend.gain.value },
      atmo: { gain: atmoGain.gain.value },
    } : null),
    // test seam: the set arc and the running episode, so a test can assert
    // the dramaturgy (wave, numbering, resume) rather than trust the gesture
    // test seam: the combination matrix — who may play with whom, and what
    // the current piece actually rolled, bundle flags included
    __curation: () => ({
      pool: JSON.parse(JSON.stringify(RECIPE_POOL)),
      recipes: Object.fromEntries(RECIPES.map((r) => [r.name, {
        palettes: r.palettes ? r.palettes.slice() : null,
        hrs: r.hrs ? r.hrs.slice() : null,
      }])),
      piece: engine.piece ? {
        num: engine.piece.num, mood: engine.piece.mood,
        recipe: engine.piece.recipe, palette: engine.piece.paletteName,
        parts: Object.fromEntries(Object.entries(engine.piece.parts).map(
          ([k, b]) => [k, { hr: b.hr, padStyle: b.padStyle,
            bassMel: !!b.bassMel, blips: b.blips, brassy: b.brassy }])),
      } : null,
    }),
    __set: () => ({
      wave: SET_WAVE.slice(),
      resumed: engine.setPrev ? { ...engine.setPrev } : null,
      piece: engine.piece ? {
        num: engine.piece.num, tp: engine.piece.tp, mood: engine.piece.mood,
        progA: engine.piece.parts.A.progIdx, progB: engine.piece.parts.B.progIdx,
      } : null,
    }),
    // test seam: the rise figure's ledger, so a test can assert the canon
    // (grid, pentatonic, ascent, cap, cadence) rather than trust the gesture
    __rise: () => ({
      active: riseVoices.filter(Boolean).length, log: riseLog.slice(),
      nodes: riseS.length
        ? { voices: riseS, lps: riseLp, hp: riseHp, delaySend, busHarm }
        : null,
    }),
  };
})();
