# Frunky 🚦

**Funky, adaptive, generative driving music for the car browser. The drive composes — you just listen.**

*Frunk + funky: music from the car whose engine bay is a trunk.*

Open the page in your car's browser (built with the Tesla browser in mind), tap play, and the music follows your drive: fat basses that lean into acceleration, a heartbeat while you wait at the red light, urban percussion in the city, hypnotic flow on the highway, and a stereo lean through the curves. Everything runs live in the browser with the Web Audio API — no backend, no account.

## Two pages, one engine

| | what it is | who it is for |
| --- | --- | --- |
| [`index.html`](index.html) | **the driver page** — real GPS, one giant start button, then a speed, a state word and nothing to read | the car |
| [`bench.html`](bench.html) | **the test bench** — gas-pedal slider, scenario buttons, the arrangement dashboard, and a switch between simulated GPS reality and ideal measurement | designing the music |

Both load the same [`engine.js`](engine.js), which owns everything musical and nothing else: it takes `update(dt, { speed, lateralG })` once per frame and does not care whether those numbers came from a satellite or a slider. [`geo.js`](geo.js) is the driver page's GPS reader — it turns browser fixes into that same pair, dead-reckoning and smoothing them exactly the way the bench simulates, so the bench is a real rehearsal for the car rather than a different instrument.

The driver page gets the short URL on purpose: it is the one you type on a touchscreen while parked.

## Try it

The canonical deployment is **https://frunky.clemenshelm.com** — our own Caddy server, which serves the HTML with `Cache-Control: no-store` and the versioned scripts as immutable (`deploy/frunky-app.Caddyfile`, shipped by `deploy/deploy-app.sh`). That split exists because a car browser caches HTML indefinitely: the Tesla once drove a build five deploys old while every `?v=` bump sat unseen on the server, so the page itself must never be cacheable and `fresh.js` additionally reloads a long-lived tab when `version.json` announces a newer build (parked only, once per session). The GitHub Pages mirror redirects there.

For local development, serve the repo root with any static server. The driver page needs location permission and HTTPS (or `localhost`) — over plain `http://` elsewhere the browser will refuse to give a position.

```bash
npx serve .
```

`npm test` runs the whole suite: a wiring guard across the pages and the engine's public API, the GPS reader's maths (heading wrap-around, derived speed, standstill noise), the tracing privacy boundary and its collector, and a headless smoke test that drives a full synthetic trip through the real engine.

`npm run collector` starts the trace collector locally on port 8099.

`prototypes/genre-lab.html` is the earlier genre exploration (melodic techno / synthwave / Berlin school / hybrid) that led here — kept for reference.

## How it works

### Force, not speed

The core design decision: **musical energy follows force — acceleration, braking, lateral g — while speed only selects the scene.**

| Driving state | Musical response |
| --- | --- |
| Standstill | The beat pulls back; a heartbeat keeps subtle tension (stronger once "armed") |
| Launch | A tom fill introduces the beat, an impact hits on the next 8th, the mix pumps deeper |
| Acceleration | A distorted growl bass rolls in on the offbeats; background percussion swells — and the **rise figure**: canon voices — warm triangle plucks behind a lowpass that opens as they climb, echoing in the shared dotted-8th delay — enter on the 8th grid and climb the pentatonic, overlapping like a tram inverter stepping through its pulse patterns. Entry rate and climb speed follow the push (the rev counter as event *rate*, never a siren pitch sweep), the window is Shepard-shaped so the ascent never runs out of register, and the ending keeps the build-up's promise: a gentle pull ebbs into quiet staggered cadences, while a sprint runs in toward the next downbeat and lands root-and-fifth together, about an octave below the climb's top — energy resolves downward. The ending comes in two sizes, because a drop that always comes is not a drop: every sprint gets the quiet landing, but the full **arrival** (open hat, stab chord, full strength) is reserved for a *sustained* sprint outside a ~1-minute cooldown. Voices that reach the ladder's top during the run-in hold their breath rather than pulsing over changing chords; an end under braking gets no celebration at all — braking drains |
| Braking | A master lowpass closes over the whole mix — energy is audibly drained |
| City (~15–65 km/h) | Syncopated percussion groove, Rhodes comping dabs, urban detail |
| Highway (>90 km/h) | The harmony retires to an Am pedal with a walking inner voice — and every 24 bars the anthem lift (♭VI–♭VII–i) opens the sky for 8 bars |
| Curves | The whole mix leans into the turn (stereo pan) and an abstract "stretch" tone bends up with lateral g |

### Mixing a piece that never has the same voice count twice

Vertical layering means the arrangement's density is decided at runtime, so **a static per-voice balance cannot be right for all of it** — every combination of layers still has to land on the same loudness. That is a bus problem, not a per-voice one:

- **Four families** — drums, bass, harmony, lead — each keeping its own internal balance, plus a texture bus for the force effects. The drum bus is the only one that isn't sidechained, because the kick *is* the sidechain.
- **The low end belongs to two instruments.** Pads, Rhodes, gate, arp, stabs and brass all carry low-mid energy they don't need; six of them summing under the bass is what reads as "not well mixed". The harmony bus is high-passed at 120 Hz and the lead at 190 Hz, so below that the bass and kick have the mix to themselves.
- **Density levelling.** Uncorrelated sources sum in power, so N similar layers are about √N louder than one. The harmony family tracks √(reference/N) as the arrangement thickens — about ±1 dB, levelling rather than an effect — with a slow shallow compressor behind it for what's left.
- **Scene levelling.** The highway arrangement thins deliberately (bass −40 %, kick −18 %, hats over half), which without compensation just makes the music quieter the faster you go. A makeup stage tracks the flow. The city is the opposite case: its percussion groove is a whole extra layer, so the drum family steps back a touch to make room.
- **Glue, then a limiter.** The master compressor is a 2.5:1 glue, not the 4:1 that was doing balance work the buses now do; the limiter behind it is the safety net, because which layers coincide is a runtime question.

`test/sequencer.test.mjs` reads the family levels back across the fuzz and fails if any of them stops moving (the levelling has been disconnected), leaves its band, or if one layer combination fires far more notes per bar than the rest.

Still open, and deliberately not guessed at from a desk: **road-noise compensation**. At 130 km/h the loudest thing in the car is broadband noise centred where the bass lives, and no amount of studio balance survives that. It needs the field test ([#1](https://github.com/clemenshelm/frunky/issues/1)).

### Spatial inertia

The music behaves like a mass. Two of the three axes are in:

- **Curves**: the mix slides **outward**, the way the passenger is pushed. Leaning *into* the bend was the intuitive reading and the wrong one — the pseudo-force in a right-hander points left, so audio moving right contradicts what the body feels, and sensory conflict is the motion-sickness mechanism.
- **Fore/aft**: the car browser gives us stereo and no access to the fader, so a literal rearward shift is impossible. Distance is not primarily a direction though, it's a set of cues — room relative to direct sound, air absorption, level — so under acceleration the band recedes (more reverb, top end rolled off, slightly quieter) and under braking it comes forward. Braking expresses that as **dryness alone**, because the brake filter already owns brightness and two gestures pulling one parameter opposite ways cancel out.

Both are switchable at runtime (`Frunky.setOption`), on the bench and behind the driver page's diagnostics tap. That isn't a preference — whether the inertial reading feels right is a question about the body, and a question needs an A and a B. `test/spatial.test.mjs` pins the directions and that the switch really switches.

### Latency doctrine

A car browser delivers GPS at ~1 Hz with ~1 s of lag. The engine is designed so that never matters:

- **Continuous mappings** (bass presence, filter, thrust texture, curve lean) are latency-immune — they're smoothed and dead-reckoned, and your ear has no reference point for "what 120 km/h should sound like *right now*".
- **Discrete events** get **anticipation instead of reaction**: standstill is a musical state that *arms* the launch, so the first detected movement releases it instantly. Planned: map lookahead (OpenStreetMap road geometry) to see curves and scene changes seconds before they happen.
- **Bar quantization** hides the rest — events fire on musical boundaries anyway.

### Long-form listenability

Repetition doesn't fatigue; missing change *underneath* the repetition does. The engine follows club-music form rules:

- **Pieces, not just sections**: a piece is a script of named parts (verse / chorus / bridge). Each part's materials are rolled **once** and return recognizably; the chorus carries a generated **hook riff** (rhythm-first, ≤3 pitches, rests included — earworm research says simple) played on a sampled muted guitar, taught by exact repeats and then varied (octave pop, tail flourish, a dropout bar the listener sings, a rest window in bars 8–11 so the arrangement can answer). The **bridge is a real breakdown** — rhythm section out, harmonic bed up, riser into the final chorus — and a **gap of near-silence** stages the drop into every chorus.
- **Every piece rolls its own key (±2/±3 semitones)**: variation pools can't fix a universe where the tonic never moves, and the key never repeats from one piece to the next — not even across drives.
- **The mood is dramaturgy, not a dice roll**: pieces ride a **set wave** (warm-up → build → peak → breathe → rebuild → double peak, ~27 min per lap) the way a DJ set rides its energy curve — the valleys are what make the peaks land. Deep pulls the payoff elements back, anthem leans into them.
- **Drives are episodes of one running set**: the set state (episode number, key, progression-walk position — no identifier, nothing about the drive) persists in localStorage, so a daily 10-minute commute resumes wherever the wave stood instead of resetting to episode one. The payload is versioned and validated field by field; anything unreadable starts a fresh set rather than crashing the music.
- **Sections every 16 bars** roll new traits from data pools: chord progression (walking a graph of proven progressions, never a blind jump), harmonic rhythm (per bar / held / anticipated ahead of the one — anticipation, never displacement: the bass root only moves on the one), chord instrumentation (pad wash / rolled Rhodes / broken 8ths / trance gate), bass groove pattern and melodic bass lines, licks, arp figure and octave, ghost notes, a ghost-note snare, brass stabs, square-wave blips. The live **dashboard** in the UI shows the arrangement and what the current section rolled.
- **Combinations are curated, not free** (auditory scene analysis: at most one rhythmic protagonist, figures must agree on when harmony changes): broken/gate chord figures exclude anticipated harmonic rhythms, the gate silences blips and brass, broken Rhodes pushes the arp up an octave for stream segregation, sibling parts must differ in chord style and bass pattern, and the Rhodes never collides with itself in two roles.
- **The drive steers the form, not only the layers**: a standing launch pulls the next chorus forward to the next section boundary.
- **DJ turnover**: the last bar before a chorus or a new piece high-passes the whole mix, the new downbeat drops the lows back in — rationed, so it stays a gesture instead of a tic.
- **Every 8th bar is a turnaround** (arp runs backwards, a fill from the fill pool, an open hat breathes the phrase out).
- **Every 48 bars** kick and bass step aside for four bars — only while cruising, never during a driving event.
- **Humanization**: swing on the off-16ths, micro-timing jitter, velocity spread — on percussion and arps only; kick, bass and growl stay machine-tight.
- Modal harmony without dominant tension (A aeolian / dorian, add9 and 7th colors, open voicings), pentatonic arps that stay consonant over every pooled chord, and a generated-impulse convolution reverb.
- All variation is rolled **once** per section/phrase boundary into a plain data object; the sequencer only reads it. Pools are data, not code branches.

### Traces without a person in them

The field test outgrew what a photograph of a screen can carry. The log on the
driver page has found real bugs, and it stops working the moment somebody else
drives: a stranger will not photograph a diagnostics screen, and the drive that
ends in a freeze is exactly the one nobody thinks to. So a drive can now send
home a technical picture of itself — under an ask, and under rules that came
first.

**Minimisation happens in the browser, not on the server.** Every value is
bucketed, classified or dropped before it goes on the wire, so the collector
never receives the thing it would then have to promise not to keep. A
server-side filter is a promise; not transmitting is a fact.

What that means concretely, and each of these cost something:

- **No coordinates.** The engine never wanted a position, only a speed. And a
  speed timeline accurate to the metre *is* a route, so speed travels as one of
  fourteen buckets. That answers the only question we ask of it — "was the car
  moving when the sound stopped?" — and does not reconstruct a journey.
- **No wall-clock time.** Samples carry milliseconds since the drive began; the
  collector stamps arrival to the hour. Enough to find a report again, not
  enough to time somebody's commute.
- **No agent string**, only one of five device classes, decided in the browser.
- **No persistent identifier at all.** The trace id is random, lives for one
  drive and is forgotten. Two drives by the same car cannot be joined — which
  also means "does this one Tesla always fail?" is a question the data cannot
  answer. That is the price, and it is paid on purpose.

[`trace-schema.js`](trace-schema.js) is the whole boundary, and it is one file
loaded by the browser as a script *and* by the collector as the same bytes —
because two lists drift, and a drifted server-side filter passes exactly the
fields the client stopped sending. Redaction walks the **spec**, never the
input: a value reaches the output only if a field of that name and type is
declared, so "somebody added a field that forwards its input" has to be written
down in the open.

The tests are built so a green run is evidence rather than a ritual. The privacy
sweep builds its input from the exported spec and poisons every declared leaf,
so a field added next month is covered without anyone remembering to extend a
list — and it is verified by canary, because the first version of that sweep
passed the canary while only poisoning fields written into the sample by hand.
The collector's promises are checked against the bytes on disk rather than the
handler's intent: post a trace carrying coordinates, a stack trace, an agent
string, a cookie and two forwarded addresses, then grep the files for all of
them.

Consent is an act. Both answers are the same size on the start screen, the music
is identical either way, and withdrawal reaches what was already sent — the
device keeps the ids of its last twenty drives, locally and never transmitted as
a set, for the one reason that they are the only handle anyone has on those
records. Without them, "delete my data" is a sentence rather than a button.
Retention is an `unlink` of a day-file after 30 days, not a filter somebody has
to remember to apply.

Details, operations and the deploy in [`collector/README.md`](collector/README.md);
the notice the driver actually reads is [`privacy.html`](privacy.html).

## Roadmap

Sound first, car second — the plan is to iterate on the music until it carries, then integrate the real vehicle:

1. ~~**Tone.js port**~~ — done: transport/swing/effects now run on Tone.js ([#2](https://github.com/clemenshelm/frunky/issues/2))
2. ~~**Sampled instruments**~~ — done: Rhodes chords + muted-guitar hook lead, FluidR3 subsets vendored under `samples/` ([#3](https://github.com/clemenshelm/frunky/issues/3))
3. **Real GPS** via the browser Geolocation API + in-car field test (update rate, accuracy at speed, audio while driving — including speed-dependent loudness compensation against road-noise masking, and rethinking the whole-mix curve pan for an off-center listener) ([#1](https://github.com/clemenshelm/frunky/issues/1))
4. **Scene detection from OpenStreetMap** (road class, curviness, tunnels, speed limits) with lookahead ([#4](https://github.com/clemenshelm/frunky/issues/4))
5. **Context layers**: weather (Open-Meteo), time of day / sun position, location-seeded motifs (your commute gets its own theme) ([#5](https://github.com/clemenshelm/frunky/issues/5))
6. Speed-limit awareness (OSM `maxspeed`) so excess speed is never musically rewarded ([#6](https://github.com/clemenshelm/frunky/issues/6))

## Influences

- **Racing/action game audio** — vertical layering keyed to intensity is the proven backbone (Forza, Mirror's Edge)
- **Solar Fields** (Mirror's Edge) — the airy, hopeful electronic palette this aims for
- Stylistic seasoning, taken with a grain of salt: **Daði Freyr** (playful funk bass melodies, square-wave charm) and **Parov Stelar** (swing feel, stabby brass-like accents)
- [EV_Speed_Sound](https://kubaessapp.github.io/EV_Speed_Sound/) — the synthetic-motor-sound project that proved GPS + Web Audio works in the Tesla browser, and provoked the question: why simulate an engine when the car could play *music*?

## Development

No build step. The audio runs on [Tone.js](https://tonejs.github.io/) v15 (MIT), vendored as `vendor/Tone.js` so the app stays a self-contained static site — Transport with built-in swing, fat-oscillator supersaws, chorus, convolution reverb, and compressor routing.

`engine.js` deliberately touches no DOM, which is what lets the smoke test drive the real thing rather than a copy: it feeds a synthetic trip (standstill → armed → launch → thrust → city → highway flow → curve → braking) through the public API against stubbed Web Audio, with a cycling pseudo-random so every variation pool is exercised. The wiring guard then checks that every `Frunky.*` call in either page actually exists, because a static site has no build step to notice a renamed method.

**A stub is only worth what it refuses.** The Tone stub in `test/tone-stub.mjs` used to accept every call, so a fuzz run could be green while the browser threw on every bar. It now enforces the invariants the real library enforces — a voice may not be triggered at or before its own previous start time — and that one rule immediately reproduced a fault that had been shipping: two code paths trigger the same voice in the same step (the shaker plays a backbeat *and* the urban groove; the arp plays its figure *and* the phrase-end fill), Tone refused the second, and because the refusal is thrown inside the transport callback, **every voice scheduled after it in that step was silently never played**. That is heard as the arrangement losing parts, then stopping. Voices now take their start time through a slot that nudges a collision a hair later, and micro-timing only ever pushes late — a jitter that can move a note earlier can invert the order of two events on one voice.

A car browser is not a laptop — it shares a modest CPU with a large screen. Two things follow, and both are load-bearing rather than tuning: Tone's look-ahead is raised to 0.25 s (a late scheduler callback is heard as a dropped beat, and latency costs nothing when the input is already a second old), and the driver page writes a DOM node only when its value changed.

UI copy is currently German (the prototype's first test driver is German-speaking); i18n is fair game once the engine stabilizes.

## License

[MIT](LICENSE)
