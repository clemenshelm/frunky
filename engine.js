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
  const BASSPATS = [
    [2, 6, 10, 14], // straight offbeats
    [2, 6, 11, 14], // funk push on the and-of-three
    [2, 10, 13],    // laid back, with holes
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
  // macro arc: pieces alternate character like a DJ set alternates hours —
  // deep pulls the payoff elements back, anthem leans into them
  const MOODS = ["deep", "neutral", "anthem"];
  function rollBundle(role, progIdx, mood, notLike) {
    // a sibling part must be tellable apart: never the same chord style or
    // bass pattern as the bundle it plays against (contrast is the form)
    const pick = (pool, avoid) => {
      const p = avoid != null && pool.length > 1 ? pool.filter((x) => x !== avoid) : pool;
      return p[Math.floor(Math.random() * p.length)];
    };
    const b = {
      progIdx,
      hr: HRS[Math.floor(Math.random() * HRS.length)],
      bassPat: pick(BASSPATS, notLike && notLike.bassPat),
      bassMel: Math.random() < (role === "chorus" ? 0.5 : 0.3)
        ? BASSMELS[Math.floor(Math.random() * BASSMELS.length)] : null,
      arpSeq: ARPS[Math.floor(Math.random() * ARPS.length)],
      arpOct: role === "bridge" ? 12 : Math.random() < 0.2 ? 12 : 0,
      ghosts: Math.random() < 0.5,
      bassFill: Math.random() < 0.5,
      blips: Math.random() < (role === "verse" ? 0.4 : 0.2) * (mood === "deep" ? 0.5 : 1),
      brassy: role === "chorus" &&
        Math.random() < (mood === "anthem" ? 0.7 : mood === "deep" ? 0.15 : 0.5),
      snare: role === "chorus" ? mood !== "deep"
        : Math.random() < (mood === "anthem" ? 0.6 : 0.35),
      // the verse never gates: a piece must not OPEN on its most aggressive
      // chord voice. The gate is a development, so it belongs to the parts
      // that arrive after the listener has settled in
      padStyle: pick(role === "verse" ? ["wash", "keys", "broken"]
        : role === "chorus" ? ["wash", "keys", "gate"] : PADSTYLES,
        notLike && notLike.padStyle),
    };
    // curation (auditory scene analysis: at most one rhythmic protagonist,
    // and figures must agree on WHEN harmony changes):
    // – broken/gate figures change chords on barlines only, so anticipating
    //   harmonic rhythms would announce a chord the figure keeps contradicting
    if (b.padStyle === "broken" || b.padStyle === "gate")
      b.hr = Math.random() < 0.5 ? "bar" : "twobar";
    // – the gate IS the foreground rhythm: blips and brass would fight it
    if (b.padStyle === "gate") { b.blips = false; b.brassy = false; }
    // – broken Rhodes 8ths share the arp's register: stream segregation by
    //   octave distance (Bregman) instead of two interleaved mid-range lines
    if (b.padStyle === "broken") b.arpOct = 12;
    return b;
  }
  // hook riff: the piece's identity. Earworm research says simple — small
  // range, plain contour, ONE twist; songwriting craft says rhythm-first,
  // 3–5 notes, the rests ARE the hook. This is NOT a melody, on purpose.
  const HOOKCELLS = [
    [[0, 2, 1], [3, 1, 0.7], [6, 2, 0.9], [10, 2, 0.8], [12, 3, 1]],
    [[0, 1, 1], [2, 1, 0.7], [4, 2, 0.9], [10, 2, 1], [14, 2, 0.8]],
    [[0, 3, 1], [4, 1, 0.7], [6, 2, 1], [12, 3, 0.9]],
  ]; // [pos, dur16, accent]
  const RIFFSET = [0, 3, 5, 7, 10, 12]; // A minor pentatonic over the root
  function genHook() {
    const cell = HOOKCELLS[Math.floor(Math.random() * HOOKCELLS.length)];
    let pi = 0;
    const used = new Set([RIFFSET[0]]);
    const call = cell.map(([p, d, a], i) => {
      if (i > 0 && Math.random() >= 0.55) { // 55%: repeat the pitch — economy
        const cand = clamp(pi + (Math.random() < 0.5 ? -1 : 1), 0, RIFFSET.length - 1);
        // a hook owns at most three pitches in its run — more is a scale, not a hook
        if (used.size < 3 || used.has(RIFFSET[cand])) { pi = cand; used.add(RIFFSET[pi]); }
      }
      if (i === cell.length - 1) pi = Math.random() < 0.6 ? 0 : 4; // land home or b7
      return { p, d, a, s: RIFFSET[pi] };
    });
    // response: identical rhythm, but a real answer — the middle of the line
    // sits a pentatonic 4th higher (contour change you can HEAR), then falls
    // to the answering tone. Changing only the last note reads as "same".
    const resp = call.map((n, i) => {
      if (i === 0) return { ...n };
      if (i === call.length - 1) return { ...n, s: RIFFSET[Math.random() < 0.5 ? 3 : 1] };
      return { ...n, s: RIFFSET[Math.min(RIFFSET.indexOf(n.s) + 2, RIFFSET.length - 1)] };
    });
    return { call, resp };
  }
  function newPiece() {
    // harmonic anchors walk the progression graph: verse where we are,
    // chorus and bridge on neighbours
    const prev = engine.piece;
    const pA = engine.progIdx;
    const nA = PROG_NEXT[pA];
    const pB = nA[Math.floor(Math.random() * nA.length)];
    const nB = PROG_NEXT[pB];
    const pC = nB[Math.floor(Math.random() * nB.length)];
    const tpPool = TRANSPOSES.filter((x) => !prev || x !== prev.tp);
    const moodPool = MOODS.filter((x) => !prev || x !== prev.mood);
    const mood = moodPool[Math.floor(Math.random() * moodPool.length)];
    const A = rollBundle("verse", pA, mood);
    const B = rollBundle("chorus", pB, mood, A); // chorus must contrast the verse
    const C = rollBundle("bridge", pC, mood, B); // bridge must contrast the chorus
    engine.piece = {
      num: prev ? prev.num + 1 : 1,
      // a COPY: a launch rewrites this piece's script, and mutating the shared
      // pool entry would corrupt the form for every piece that follows
      form: FORMS[Math.floor(Math.random() * FORMS.length)].slice(),
      idx: 0,
      pulled: false,
      tp: tpPool[Math.floor(Math.random() * tpPool.length)],
      mood,
      parts: { A, B, C },
      hook: genHook(),
    };
  }
  function loadPart(t) {
    const piece = engine.piece;
    const label = piece.form[piece.idx];
    const b = piece.parts[label];
    Object.assign(engine, {
      progIdx: b.progIdx, prog: PROGS[b.progIdx], roots: ROOTS[b.progIdx],
      hr: b.hr, bassPat: b.bassPat, bassMel: b.bassMel,
      arpSeq: b.arpSeq, arpOct: b.arpOct, ghosts: b.ghosts, bassFill: b.bassFill,
      blips: b.blips, brassy: b.brassy, snare: b.snare, padStyle: b.padStyle,
    });
    // the piece's key: F() reads tp, the thrust drone must follow the tonic
    tp = engine.piece.tp;
    if (thrustSub) thrustSub.frequency.value = F(33);
    // per-occurrence freshness: ornaments re-roll, one trait may flip
    engine.lick = Math.random() < 0.4 ? LICKS[Math.floor(Math.random() * LICKS.length)] : null;
    engine.blipSeq = BLIPS[Math.floor(Math.random() * BLIPS.length)];
    engine.syncPos = SYNCPOS[Math.floor(Math.random() * SYNCPOS.length)];
    engine.partLabel = label;
    engine.brokenPat = BROKENPATS[Math.floor(Math.random() * BROKENPATS.length)];
    engine.gatePat = GATEPATS[Math.floor(Math.random() * GATEPATS.length)];
    // an octave up is the most piercing thing the hook can do; keep it rare
    engine.hookLift = Math.random() < 0.2;
    if (Math.random() < 0.3) engine.ghosts = !engine.ghosts;
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

  const engine = {
    running: false,
    energy: 0,
    launchBoost: 0,
    prevEst: 0,
    accelEst: 0,
    thrust: 0,
    brake: 0,
    urban: 0,
    fillAt: -1,
    prog: null,   // the section object: rolled ONCE per boundary, only read in steps
    roots: null,
    bassPat: null,
    arpSeq: null,
    arpOct: 0,
    hr: "bar",
    fill: "toms",
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
    hookLift: false,
    pullChorus: false, // a launch pulls the chorus forward at the next boundary
    dropAt: -1,        // step index of a scheduled drop-gap release
    liftActive: false,
    flowOn: false,    // latched highway-harmony switch (hysteresis, barline only)
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
  let busDrums, busBass, busHarm, busLead, busFx;
  let revSend, delaySend, delayRet, chorus;
  let kickS, heartS, tomS, hatC, hatO, shakerS, percS;
  let bassS, bassLp, growlS, growlLp, thrustSub, thrustSubGain;
  let brakeNoise, brakeLp, brakeGain, brakeOsc, brakeOscGain;
  let stretchNoise, stretchBp, stretchGain;
  let padS, padTri, padHp, padLp, arpS, arpLp, stabS, stabLp;
  let blipS, brassS, brassLp, bassSubS, snareS, snareBody, hookS, gateS, gateAmp;
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
    try { ctx.lookAhead = 0.25; } catch (err) { void err; }
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
    panner = reg(new Tone.Panner(0));
    duck = reg(new Tone.Gain(1));
    dry = reg(new Tone.Gain(1));
    dry.connect(panner); duck.connect(panner);
    panner.chain(tensionLp, masterHp, makeup, comp, master, limiter, Tone.getDestination());
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
    busHarm.chain(harmHp, harmComp, duck);
    busLead.chain(leadHp, duck);

    // space: real convolution reverb, returned through the duck so it pumps
    const reverb = reg(new Tone.Reverb({ decay: 2.6, preDelay: 0.02, wet: 1 }));
    await reverb.ready;
    revSend = reg(new Tone.Gain(0.4));
    const revRet = reg(new Tone.Gain(0.5));
    revSend.connect(reverb); reverb.connect(revRet); revRet.connect(duck);

    delaySend = reg(new Tone.Gain(0.2));
    const delay = reg(new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.35, wet: 1 }));
    delayRet = reg(new Tone.Gain(0.6));
    delaySend.connect(delay); delay.connect(delayRet); delayRet.connect(duck);

    chorus = reg(new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.5, wet: 0.5 }).start());

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
    tomS.volume.value = db(0.35); tomS.connect(busDrums);

    const hatHp = reg(new Tone.Filter(8500, "highpass")); hatHp.connect(busDrums);
    hatC = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }));
    hatC.volume.value = db(0.2); hatC.connect(hatHp);
    hatO = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.26, sustain: 0 } }));
    hatO.volume.value = db(0.2); hatO.connect(hatHp);
    const shakerHp = reg(new Tone.Filter(6200, "highpass")); shakerHp.connect(busDrums);
    shakerS = reg(new Tone.NoiseSynth({ envelope: { attack: 0.015, decay: 0.055, sustain: 0 } }));
    shakerS.volume.value = db(0.16); shakerS.connect(shakerHp);
    const percBp = reg(new Tone.Filter({ frequency: 2600, type: "bandpass", Q: 5 })); percBp.connect(busDrums);
    percS = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }));
    percS.volume.value = db(0.25); percS.connect(percBp);

    // snare: noise crack + a short 185 Hz body; ghosts use the noise alone.
    // A whisper of the shared room glues it in — a bone-dry snare next to
    // wet pads reads as a preset, not a band
    const snareBp = reg(new Tone.Filter({ frequency: 1800, type: "bandpass", Q: 0.9 }));
    snareBp.connect(busDrums);
    const snareSend = reg(new Tone.Gain(0.12));
    snareBp.connect(snareSend); snareSend.connect(revSend);
    snareS = reg(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }));
    snareS.volume.value = db(0.3); snareS.connect(snareBp);
    snareBody = reg(new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 0.5,
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
    }));
    snareBody.volume.value = db(0.25); snareBody.connect(busDrums);

    // warm bass: triangle core (round, never rasping) — but triangles carry
    // ~6 dB less energy than saws, so the level and filter make up for it
    bassLp = reg(new Tone.Filter({ frequency: 480, type: "lowpass", Q: 0.8 }));
    bassS = reg(new Tone.Synth({
      oscillator: { type: "fattriangle", count: 2, spread: 8 },
      envelope: { attack: 0.008, decay: 0.06, sustain: 0.85, release: 0.12 },
    }));
    bassS.volume.value = db(1.2); bassS.connect(bassLp); bassLp.connect(busBass);
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
    blipLp.connect(busHarm); blipLp.connect(delaySend); blipLp.connect(revSend);

    // sampled color: Rhodes chords, mostly dry with a touch of the shared room
    ensureSamplers();
    rhodes.disconnect(); rhodes.volume.value = db(0.5);
    rhodes.connect(busHarm); rhodes.connect(revSend);

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
    const gateLp = reg(new Tone.Filter({ frequency: 1050, type: "lowpass", Q: 0.5 }));
    gateAmp = reg(new Tone.Gain(0));
    gateS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fattriangle", count: 2, spread: 12 },
      envelope: { attack: 0.35, decay: 0.2, sustain: 1, release: 0.8 },
    }));
    gateS.volume.value = db(0.3);
    poly(gateS, 12);
    gateS.connect(gateAmp); gateAmp.connect(gateHp); gateHp.connect(gateLp);
    gateLp.connect(chorus); gateLp.connect(busHarm);
    gateLp.connect(delaySend); gateLp.connect(revSend);

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
      oscillator: { type: "fatsquare", count: 2, spread: 12 },
      envelope: { attack: 0.004, decay: 0.18, sustain: 0.15, release: 0.08 },
    }));
    hookS.volume.value = db(0.42);
    hookS.connect(hookPres);
    // the sampled muted guitar shares the hook chain — square is the fallback
    hookGit.disconnect(); hookGit.volume.value = db(0.72);
    hookGit.connect(hookPres);
    hookPres.connect(hookAir); hookAir.connect(hookLp);
    // the same room as the pads: a dry lead over a wet arrangement reads as
    // overdubbed onto it. The delay keeps carrying the phrase's rhythm
    const hookRev = reg(new Tone.Gain(0.8));
    hookLp.connect(busLead); hookLp.connect(delaySend);
    hookLp.connect(hookRev); hookRev.connect(revSend);

    // Parov seasoning: brass-like stab — filter snaps open and shuts
    brassLp = reg(new Tone.Filter({ frequency: 900, type: "lowpass", Q: 1.2 }));
    brassS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 18 },
      envelope: { attack: 0.02, decay: 0.18, sustain: 0.3, release: 0.12 },
    }));
    brassS.volume.value = db(0.16);
    poly(brassS, 24);
    brassS.connect(brassLp); brassLp.connect(busHarm); brassLp.connect(revSend);

    growlLp = reg(new Tone.Filter({ frequency: 160, type: "lowpass", Q: 1 }));
    const growlDist = reg(new Tone.Distortion(0.7));
    growlS = reg(new Tone.Synth({
      oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
      envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.08 },
    }));
    growlS.volume.value = db(0.6); growlS.chain(growlDist, growlLp, busBass);

    thrustSubGain = reg(new Tone.Gain(0));
    thrustSub = reg(new Tone.Oscillator(55, "sine").start());
    thrustSub.connect(thrustSubGain); thrustSubGain.connect(busBass);

    // brake: brown noise is a naturally dark rumble — pressure, not vacuum
    brakeLp = reg(new Tone.Filter({ frequency: 300, type: "lowpass", Q: 2 }));
    brakeGain = reg(new Tone.Gain(0));
    brakeNoise = reg(new Tone.Noise("brown").start());
    brakeNoise.chain(brakeLp, brakeGain, busFx);
    brakeOscGain = reg(new Tone.Gain(0));
    brakeOsc = reg(new Tone.Oscillator(88, "sine").start());
    brakeOsc.connect(brakeOscGain); brakeOscGain.connect(busFx);

    stretchBp = reg(new Tone.Filter({ frequency: 2100, type: "bandpass", Q: 14 }));
    stretchGain = reg(new Tone.Gain(0));
    stretchNoise = reg(new Tone.Noise("white").start());
    stretchNoise.chain(stretchBp, stretchGain, busFx);

    // pad: fat saws + triangle octave, breathing filter, chorus, reverb
    padHp = reg(new Tone.Filter(160, "highpass"));
    padLp = reg(new Tone.Filter({ frequency: 900, type: "lowpass", Q: 0.4 }));
    padS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 14 },
      envelope: { attack: 1.1, decay: 0.3, sustain: 0.8, release: 1.6 },
    }));
    padS.volume.value = db(0.16);
    poly(padS, 64);
    padTri = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 1.3, decay: 0.3, sustain: 0.7, release: 1.8 },
    }));
    padTri.volume.value = db(0.09);
    poly(padTri, 64);
    padS.connect(padHp); padTri.connect(padHp);
    padHp.connect(padLp); padLp.connect(chorus); chorus.connect(busHarm);
    padLp.connect(revSend);

    arpLp = reg(new Tone.Filter({ frequency: 800, type: "lowpass", Q: 4 }));
    arpS = reg(new Tone.Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.08 },
    }));
    arpS.volume.value = db(0.14); arpS.connect(arpLp);
    arpLp.connect(busHarm); arpLp.connect(delaySend); arpLp.connect(revSend);

    stabLp = reg(new Tone.Filter({ frequency: 1400, type: "lowpass", Q: 1 }));
    stabS = reg(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 2, spread: 14 },
      envelope: { attack: 0.003, decay: 0.16, sustain: 0, release: 0.05 },
    }));
    stabS.volume.value = db(0.14);
    poly(stabS, 24);
    stabS.connect(stabLp); stabLp.connect(busHarm); stabLp.connect(delaySend); stabLp.connect(revSend);
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
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(33, t + 0.4);
    const g = raw.createGain();
    g.gain.setValueAtTime(0.85, t);
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

  // ---- voices --------------------------------------------------------------

  const vv = (vol, ref) => clamp(vol / ref, 0, 1);

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
    if (click > 0.12) kickClick(t, click * vol);
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
  function tom(t, f0, vol) {
    tomS.triggerAttackRelease(f0 * 0.45, 0.18, at("tom", t), vv(vol, 0.35));
  }
  function hat(t, open, vol) {
    (open ? hatO : hatC).triggerAttackRelease(open ? 0.26 : 0.04,
      at(open ? "hatO" : "hatC", t), vv(vol, 0.2));
  }
  function shaker(t, vol) { shakerS.triggerAttackRelease(0.055, at("shaker", t), vv(vol, 0.16)); }
  function snare(t, vol, ghost = false) {
    snareS.triggerAttackRelease(ghost ? 0.045 : 0.13, at("snare", t), vv(vol, 0.3));
    if (!ghost) snareBody.triggerAttackRelease(185, 0.09, at("snareBody", t), vv(vol * 0.7, 0.25));
  }
  function perc(t, vol) { percS.triggerAttackRelease(0.03, at("perc", t), vv(vol, 0.25)); }
  function bassNote(t, freq, cut, vol, dur = SPB) {
    const tt = at("bass", t);
    bassLp.frequency.setValueAtTime(cut, tt);
    bassS.triggerAttackRelease(freq, dur * 0.85, tt, vv(vol, 0.5));
  }
  function bassSubNote(t, freq, vol, dur) {
    bassSubS.triggerAttackRelease(freq, dur, at("bassSub", t), vv(vol, 0.4));
  }
  function growlNote(t, vol, dur) {
    growlS.triggerAttackRelease(F(33), dur * 0.85, at("growl", t), vv(vol, 0.6));
  }
  function stabChord(t, midis, vol) {
    stabS.triggerAttackRelease(midis.map(F), 0.16, at("stab", t), vv(vol, 0.14));
  }
  function blip(t, freq, vol) {
    blipS.triggerAttackRelease(freq, 0.1, at("blip", t), vv(vol, 0.09));
  }
  function hookNote(t, freq, dur, vol) {
    const tt = at("hook", t);
    if (hookGit && hookGit.loaded) hookGit.triggerAttackRelease(freq, dur, tt, vv(vol, 0.16));
    else hookS.triggerAttackRelease(freq, dur, tt, vv(vol, 0.2));
  }
  // the gate's amplitude, one automation point per sixteenth. No
  // cancelScheduledValues: steps are scheduled in increasing time order, so
  // the ramps chain by themselves — and a cancel is exactly how an automated
  // gain gets left parked somewhere it can't come back from
  function gateLevel(t, target, up) {
    gateAmp.gain.linearRampToValueAtTime(target, t + (up ? 0.014 : 0.032));
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
    const style = engine.flowOn ? "wash" : engine.padStyle; // the highway carries
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
    if (pos === 0) engine.barInPart = bar % 16;
    if (pos === 0 && bar % 8 === 7) engine.fill = FILLS[Math.floor(Math.random() * FILLS.length)];
    // what comes after this section? (idx already points at the next part)
    const pieceEnd = engine.piece && engine.piece.idx >= engine.piece.form.length;
    const nextIsB = engine.piece && !pieceEnd && engine.piece.form[engine.piece.idx] === "B";
    // DJ turnover: pulls the lows out of the whole mix so the new downbeat can
    // drop them back in. Only where it EARNS something — into a chorus or a
    // new piece. Every 16 bars it stops being a gesture and becomes a tic
    if (pos === 0) {
      masterHp.frequency.cancelScheduledValues(t);
      masterHp.frequency.setValueAtTime(25, t);
      if (bar % 16 === 15 && !still && (nextIsB || pieceEnd)) {
        masterHp.frequency.setValueAtTime(30, t);
        masterHp.frequency.exponentialRampToValueAtTime(240, t + SPB * 15);
        // a piece ends here: a long swell carries into the next piece's one
        if (pieceEnd) fillSwell(t, SPB * 14);
      }
    }
    // the GAP: a breath of near-silence, then the impact on the one. It only
    // earns that after the bridge's breakdown — before EVERY chorus it stops
    // reading as a drop and starts reading as the music cutting out, which is
    // indistinguishable from a fault. And it holds back a little rather than
    // going fully silent, for the same reason
    if (pos === 14 && bar % 16 === 15 && !still && nextIsB && engine.partLabel === "C") {
      const g = master.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.9, t);
      g.linearRampToValueAtTime(0.12, t + SPB * 1.6);
      engine.dropAt = s + 2;
    }
    if (s === engine.dropAt) {
      engine.dropAt = -1;
      master.gain.cancelScheduledValues(t);
      // ramp back over ~8 ms, never step: a gain jump from 0.03 to 0.9 between
      // two samples is a discontinuity in the waveform, and a discontinuity is
      // a click. Too short to hear as a fade, long enough to not snap
      master.gain.setValueAtTime(0.12, t);
      master.gain.linearRampToValueAtTime(0.9, t + 0.008);
      if (!still) impact(t);
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
    if (pos === 0) {
      const was = engine.flowOn;
      if (!engine.flowOn && flowHigh > 0.65) engine.flowOn = true;
      else if (engine.flowOn && flowHigh < 0.5) engine.flowOn = false;
      if (was !== engine.flowOn) hush(t);
    }
    const flowMode = engine.flowOn;
    const liftPhase = flowMode && bar % 24 >= 16;
    if (pos === 0 && flowMode && (bar % 24 === 16 || bar % 24 === 0)) {
      hush(t); // clean lift entry and exit
    }
    engine.liftActive = liftPhase;
    const progEff = !flowMode ? engine.prog : liftPhase ? LIFTPROG : PEDALPROG;
    const rootsEff = !flowMode ? engine.roots : liftPhase ? LIFTROOTS : PEDALROOTS;
    const hrEff = flowMode ? "twobar" : engine.hr;

    if (still) {
      // the beat pulls back — a heartbeat keeps subtle tension alive
      const hb = engine.armed ? 0.62 : 0.42;
      if (pos % 8 === 0) heartbeat(t, hb, 110);
      if (pos % 8 === 2) heartbeat(t, hb * 0.6, 132);
    } else {
      // pump stays gentle at cruise, deepens only under force
      if (pos % 4 === 0 && !breather && !bridgeDown) {
        kick(t, (0.85 + 0.1 * e) * (1 - 0.18 * flowHigh), 0.05 + 0.3 * push);
        duckAt(t, 0.3 * (1 - 0.3 * flowHigh) + 0.28 * push);
      }
      // bass follows the chord roots and a groove pattern with holes in it;
      // it reaches full weight at city speeds already, not only on the highway
      const fat = clamp(e / 0.35, 0, 1);
      const drain = 1 - 0.5 * engine.brake; // braking audibly drains the drive
      // the bass root moves ONLY on the one — it is the meter's anchor
      const ci = hrEff === "twobar" ? Math.floor(bar / 2) % 4 : bar % 4;
      const ciNext = hrEff === "twobar" ? Math.floor((bar + 1) / 2) % 4 : (bar + 1) % 4;
      const rootF = F(rootsEff[ci]);
      // once per 8-bar phrase a lick takes over the bar's second half
      const lickBar = engine.lick && bar % 8 === 3 && !breather && !bridgeDown;
      if (!breather && !bridgeDown && engine.bassPat.includes(pos) && !(lickBar && pos >= 10)) {
        // melodic sections walk root/fifth/octave/seventh instead of pedaling
        const mi = engine.bassMel && !flowMode
          ? engine.bassMel[engine.bassPat.indexOf(pos) % engine.bassMel.length] : 0;
        // Daði pop: one hit per bar jumps up an octave when the section is playful
        const oct = !engine.bassMel && engine.bassFill && pos === 10 ? 2 : 1;
        // natural correlation: louder notes ring brighter, lengths breathe
        const v = vel((0.16 + 0.3 * fat) * (1 - 0.4 * flowHigh) * drain);
        // rootsEff, not engine.roots: during the highway lift the bass must
        // walk the LIFT roots, not the retired section progression's
        bassNote(bassT(t), F(rootsEff[ci] + mi) * oct, 500 + 700 * fat + v * 350, v,
          SPB * (1.5 + Math.random() * 0.4));
      }
      if (lickBar) {
        if (pos === 10) engine.lickFlashUntil = Date.now() + 2200;
        const hit = engine.lick.find((x) => x[0] === pos);
        if (hit) {
          bassNote(bassT(t), F(rootsEff[ci] + hit[1]), 800 + 400 * fat,
            vel(0.18 * drain), SPB * 0.85);
        }
      }
      // funk vocabulary: quiet ghost notes between the hits — felt, not heard
      if (engine.ghosts && pos % 8 === 5 && !breather && !bridgeDown) {
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
      if (pos === 0 && flowHigh > 0.3 && !breather && !bridgeDown) bassSubNote(t, rootF, 0.26 * flowHigh * drain, SPB * 15);
      // thrust: growl-bass eases in and out with force — no hard gate
      if (push > 0.04 && pos % 4 === 2) growlNote(t, 0.62 * Math.pow(push, 1.3), SPB * 1.6);
      if (push > 0.55 && (pos % 4 === 1 || pos % 4 === 3)) growlNote(t, 0.3 * push, SPB * 0.8);
      // the stab rides the CURRENT chord — a hard-wired Am rubbed against Gadd9
      if (push > 0.06 && pos % 4 === 2) stabChord(t, progEff[ci], 0.12 * Math.pow(push, 1.3));
      if (pos % 4 === 2) hat(hum(t, pos), false, vel((0.03 + 0.05 * u) * (1 - 0.55 * flowHigh)));
      // snare sections: soft backbeat on 2 and 4, funk ghost chatter between
      if (engine.snare && !breather && !bridgeDown) {
        if (pos === 4 || pos === 12) snare(hum(t, pos), vel(0.12 + 0.05 * e));
        if (pos === 7 || pos === 10 || pos === 15) snare(hum(t, pos), vel(0.035 + 0.025 * u), true);
      }
      // accel percussion: shaker/toms in the background, swelling with force
      if (pos % 2 === 1) shaker(hum(t, pos), vel(0.015 + 0.1 * push));
      if ((pos === 5 || pos === 13) && push > 0.05) tom(t, pos === 5 ? 150 : 120, 0.03 + 0.15 * push);
      // Daði charm: the blip voice answers the arp — one bar in four, quiet
      if (engine.blips && bar % 4 === 2) {
        const bmap = { 6: 0, 10: 1, 13: 2 };
        if (pos in bmap) blip(hum(t, pos), F(engine.blipSeq[bmap[pos]]), vel(0.07));
      }
      // Parov seasoning: brass stab anticipates the one — every 4th bar, a spice
      if (engine.brassy && pos === 14 && bar % 4 === 1 && !breather && !flowMode) {
        brassHit(t, progEff[ciNext], vel(0.09 + 0.07 * e));
      }
      // bridge rebuild: after the breakdown the drums return, and a long riser
      // carries the last bars into the chorus drop
      if (engine.partLabel === "C" && bar % 16 === 13 && pos === 0) fillSwell(t, SPB * 40);
      // lift drama: a riser announces it, open hats carry the hymn, Rhodes doubles
      if (flowMode && bar % 24 === 15 && pos === 8) fillSwell(t, SPB * 8);
      if (liftPhase && pos % 8 === 4) hat(t, true, 0.11);
      if (liftPhase && pos === 0 && bar % 2 === 0) {
        rhodesChord(t, progEff[Math.floor(bar / 2) % 4], 0.11);
      }
      // Rhodes comping: a soft chord dab answers on the and-of-two in town —
      // but not when the Rhodes already IS the chord voice (keys/broken):
      // one instrument must not collide with itself in two roles
      if (u > 0.15 && pos === 6 && bar % 2 === 0 && !breather &&
          engine.padStyle !== "keys" && engine.padStyle !== "broken") {
        rhodesChord(hum(t, pos), progEff[ci], vel(0.05 + 0.08 * u));
      }
      // urban detail: a real syncopated groove, gone on the open road
      if (u > 0.05 && !bridgeDown) {
        if (pos === 3) perc(hum(t, pos), vel(0.16 * u));
        if (pos === 6) perc(hum(t, pos), vel(0.1 * u));
        if (pos === 10) perc(hum(t, pos), vel(0.13 * u));
        if (pos === 14) perc(hum(t, pos), vel(0.08 * u));
        if (pos % 4 === 3) shaker(hum(t, pos), vel(0.05 * u));
      }
      // phrase-end fill, drawn from the pool once per phrase
      if (turnaround) {
        if (engine.fill === "toms" && (pos === 11 || pos === 14)) tom(t, pos === 11 ? 170 : 135, 0.07);
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
    const arpHit = flowHigh > 0.6 ? pos % 4 === 0 : pos % 2 === 0;
    if (arpHit) {
      const seq = turnaround ? engine.arpSeq.slice().reverse() : engine.arpSeq;
      // accent contour: downbeats lean forward, offbeats sit back — not uniform
      const accent = pos % 4 === 0 ? 1.15 : 0.9;
      arpNote(t, F(seq[Math.floor(s / 2) % 8] + (liftPhase ? 12 : engine.arpOct)),
        340 + 2000 * clamp(e, 0, 0.8) * (0.75 + 0.25 * Math.sin(t * 0.3)) + 700 * push,
        vel(0.07 * accent), flowHigh > 0.6 ? SPB * 3.6 : SPB * 1.8);
    }
    // harmonic rhythm: per bar, held two bars, or pushed in ahead of the one.
    // During the lift the pad grows brighter and half again as large
    const moodF = engine.piece
      ? (engine.piece.mood === "deep" ? 0.88 : engine.piece.mood === "anthem" ? 1.12 : 1) : 1;
    const padVol = (0.16 + 0.2 * flowHigh) * (breather ? 1.5 : 1) * (liftPhase ? 1.5 : 1)
      * moodF * (bridgeDown ? 1.35 : 1);
    const padCut = 950 + 350 * Math.sin(bar * 0.37) + (liftPhase ? 350 : 0);
    if (hrEff === "twobar") {
      if (pos === 0 && bar % 2 === 0) chordVoice(t, progEff[Math.floor(bar / 2) % 4], SPB * 32, padVol, padCut);
    } else if (hrEff === "push") {
      if (pos === 0 && bar % 16 === 0) chordVoice(t, progEff[bar % 4], SPB * 14, padVol, padCut);
      // never anticipate across a section boundary — the next section owns its one
      if (pos === 14 && bar % 16 !== 15) {
        chordVoice(t, progEff[(bar + 1) % 4], SPB * 16, padVol, padCut);
        // the pad's slow attack smears the anticipation — Rhodes announces it.
        // Only for the wash: the keys style already rolls its own Rhodes
        if (engine.padStyle === "wash") rhodesChord(t, progEff[(bar + 1) % 4], 0.08 + 0.05 * e);
      }
    } else if (hrEff === "sync") {
      // the next bar's chord arrives at an odd spot — anticipation, not displacement
      if (pos === 0 && bar % 16 === 0) chordVoice(t, progEff[bar % 4], SPB * engine.syncPos, padVol, padCut);
      if (pos === engine.syncPos && bar % 16 !== 15) {
        chordVoice(t, progEff[(bar + 1) % 4], SPB * (16 + 16 - engine.syncPos), padVol, padCut);
        if (engine.padStyle === "wash") rhodesChord(t, progEff[(bar + 1) % 4], 0.08 + 0.05 * e);
      }
    } else {
      if (pos === 0) chordVoice(t, progEff[bar % 4], SPB * 16, padVol, padCut);
    }
    // broken/gate styles: the chords live as figures, not as a carpet
    if (!engine.flowOn && !still) {
      const ciPad = hrEff === "twobar" ? Math.floor(bar / 2) % 4 : bar % 4;
      const chordNow = progEff[ciPad];
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
      const gateOn = engine.padStyle === "gate" && !engine.flowOn && !still && !bridgeDown;
      if (gateOn) {
        const ciPad = hrEff === "twobar" ? Math.floor(bar / 2) % 4 : bar % 4;
        // re-voice only when the harmony actually moves — the gate's whole
        // point is that the chord is continuous underneath the rhythm
        const barChanges = hrEff === "twobar" ? bar % 2 === 0 : true;
        if (pos === 0 && barChanges) gateHold(t, progEff[ciPad]);
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
    if (engine.partLabel === "B" && !still && !breather && engine.piece &&
        (bar % 16 < 8 || bar % 16 >= 12) && bar % 16 !== 13) {
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
  function update(dt, input) {
    if (!engine.running) return;
    clock += dt * 1000;
    const speed = clamp(Number(input && input.speed) || 0, 0, 300);
    const lat = clamp(Number(input && input.lateralG) || 0, -1, 1);

    // energy follows speed, slowly; launch boost decays over ~4 bars
    const target = clamp(speed / 110, 0, 1);
    engine.energy += (target - engine.energy) * (1 - Math.exp(-dt / 1.4));
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
    if (engine.armed && speed > 6 && engine.prevEst <= 6) {
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
    thrustSubGain.gain.value = thrust * 0.3;
    growlLp.frequency.value = 160 + 1000 * thrust;
    // braking = force too: pressure plus the master filter closing over the mix
    const brakeTarget = clamp(-engine.accelEst / 16, 0, 1);
    engine.brake += (brakeTarget - engine.brake) *
      (1 - Math.exp(-dt / (brakeTarget > engine.brake ? 0.4 : 1.1)));
    const brake = engine.brake;
    brakeGain.gain.value = brake * 0.5;
    brakeOscGain.gain.value = brake * 0.32;
    brakeOsc.frequency.value = 88 - 46 * brake;
    tensionLp.frequency.value = 1200 + 16800 * Math.pow(1 - brake, 2);
    // curve lean: whole mix pans, delay shimmer opens, stretch tone bends up
    panner.pan.value = lat * 0.45;
    delayRet.gain.value = 0.6 + Math.abs(lat) * 0.9;
    const gAbs = Math.abs(lat);
    stretchGain.gain.value = gAbs * 0.16 * clamp(speed / 50, 0, 1);
    stretchBp.frequency.value = 2100 + 1900 * gAbs;
    // urban weight: city speed band, fades out toward the highway
    engine.urban = clamp((speed - 12) / 12, 0, 1) * (1 - clamp((speed - 65) / 30, 0, 1));

    // Scene loudness. The highway arrangement thins ON PURPOSE — the bass pulls
    // back 40 %, the kick 18 %, the hats more than half — and without
    // compensation the music simply gets quieter the faster you go, which is
    // heard as a mix that stops working rather than as a scene that opens up.
    // The city is the opposite case: its percussion groove adds a whole layer,
    // so the drum family steps back a touch to make room for it
    const eNow = clamp(engine.energy + engine.launchBoost * 0.3, 0, 1);
    const flowHigh = clamp((eNow - 0.5) / 0.35, 0, 1);
    makeup.gain.value = 1 + 0.16 * flowHigh;
    busDrums.gain.value = 1 - 0.08 * engine.urban;
  }

  // what the drive is doing, in one word — the only readout the driver page shows
  function status() {
    const e = clamp(engine.energy + engine.launchBoost * 0.3, 0, 1);
    if (engine.launchBoost > 0.5) return { text: "LAUNCH", kind: "launch" };
    if (engine.thrust > 0.4) return { text: "Schub", kind: "launch" };
    if (engine.brake > 0.45) return { text: "Bremsen", kind: "launch" };
    if (e < 0.06) return { text: engine.armed ? "Stand — geladen" : "Stand", kind: "" };
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
    try {
      await Tone.start();
      await buildGraph();
      // sample buffers (Rhodes, muted guitar) — a failed load must never
      // block play, the synth fallbacks cover it
      try { await Tone.loaded(); } catch (err) { console.warn("samples missing:", err); }
    } finally {
      building = false;
    }
    engine.energy = 0; engine.launchBoost = 0;
    engine.armed = false; engine.standstillSince = null; engine.prevEst = 0;
    engine.accelEst = 0; engine.thrust = 0;
    engine.brake = 0; engine.urban = 0; engine.fillAt = -1;
    engine.prog = PROGS[0]; engine.roots = ROOTS[0]; engine.bassPat = BASSPATS[0];
    engine.arpSeq = ARPS[0]; engine.arpOct = 0;
    engine.hr = "bar"; engine.fill = "toms"; engine.ghosts = false;
    engine.bassFill = false; engine.blips = false; engine.blipSeq = BLIPS[0]; engine.brassy = false;
    engine.lick = null; engine.bassMel = null;
    engine.syncPos = 12; engine.snare = false; engine.padStyle = "wash";
    engine.liftActive = false; engine.pullChorus = false; engine.dropAt = -1;
    engine.flowOn = false; engine.progIdx = 0; engine.piece = null; engine.partLabel = "";
    stepIdx = 0; pendingLaunchAt = -1; tp = 0; clock = 0;
    sched.clear();
    transport = Tone.getTransport();
    transport.bpm.value = BPM;
    transport.swing = 0.22; // light 16th shuffle — the pulse stays straight
    transport.swingSubdivision = "16n";
    repeatId = transport.scheduleRepeat((time) => onStep(stepIdx++, time), "16n");
    transport.start("+0.05");
    engine.running = true;
    return true;
  }

  function stop() {
    if (!engine.running) return;
    engine.running = false;
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
  function levels() {
    return {
      master: master ? master.gain.value : 0,
      duck: duck ? duck.gain.value : 0,
      harm: busHarm ? busHarm.gain.value : 0,
      drums: busDrums ? busDrums.gain.value : 0,
      makeup: makeup ? makeup.gain.value : 0,
    };
  }

  window.Frunky = {
    start, stop, update, status, describe, force, levels,
    isRunning: () => engine.running,
    isBuilding: () => building,
  };
})();
