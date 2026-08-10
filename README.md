# Frunky 🚦

**Funky, adaptive, generative driving music for the car browser. The drive composes — you just listen.**

*Frunk + funky: music from the car whose engine bay is a trunk.*

Open the page in your car's browser (built with the Tesla browser in mind), tap play, and the music follows your drive: fat basses that lean into acceleration, a heartbeat while you wait at the red light, urban percussion in the city, hypnotic flow on the highway, and a stereo lean through the curves. Everything is synthesized live in the browser with the Web Audio API — no samples, no backend, no account.

## Status: early prototype

What exists today is a **driving simulator**: [`index.html`](index.html) contains the full music engine plus a gas-pedal slider and scenario buttons (launch, city, highway, braking, curves), so the musical behaviour can be designed and tested without a car. Crucially, the simulator feeds the engine the same degraded signal a real car browser would provide — **one GPS sample per second, arriving ~0.8 s late** — and lets you A/B that against an ideal measurement to prove the latency doesn't hurt.

It does not read real GPS yet. That's the next milestone.

## Try it

Serve the repo root with any static server (or open the GitHub Pages deployment) and press **Play**. Best with decent speakers or headphones.

```bash
npx serve .
```

`prototypes/genre-lab.html` is the earlier genre exploration (melodic techno / synthwave / Berlin school / hybrid) that led to the current trance direction — kept for reference.

## How it works

### Force, not speed

The core design decision: **musical energy follows force — acceleration, braking, lateral g — while speed only selects the scene.**

| Driving state | Musical response |
| --- | --- |
| Standstill | The beat pulls back; a heartbeat keeps subtle tension (stronger once "armed") |
| Launch | A tom fill introduces the beat, an impact hits on the next 8th, the mix pumps deeper |
| Acceleration | A distorted growl bass rolls in on the offbeats; background percussion swells |
| Braking | A master lowpass closes over the whole mix — energy is audibly drained |
| City (~15–65 km/h) | Syncopated percussion groove, Rhodes comping dabs, urban detail |
| Highway (>90 km/h) | The harmony retires to an Am pedal with a walking inner voice — and every 24 bars the anthem lift (♭VI–♭VII–i) opens the sky for 8 bars |
| Curves | The whole mix leans into the turn (stereo pan) and an abstract "stretch" tone bends up with lateral g |

### Latency doctrine

A car browser delivers GPS at ~1 Hz with ~1 s of lag. The engine is designed so that never matters:

- **Continuous mappings** (bass presence, filter, thrust texture, curve lean) are latency-immune — they're smoothed and dead-reckoned, and your ear has no reference point for "what 120 km/h should sound like *right now*".
- **Discrete events** get **anticipation instead of reaction**: standstill is a musical state that *arms* the launch, so the first detected movement releases it instantly. Planned: map lookahead (OpenStreetMap road geometry) to see curves and scene changes seconds before they happen.
- **Bar quantization** hides the rest — events fire on musical boundaries anyway.

### Long-form listenability

Repetition doesn't fatigue; missing change *underneath* the repetition does. The engine follows club-music form rules:

- **Sections every 16 bars** roll new traits from data pools: chord progression (walking a graph of proven progressions, never a blind jump), harmonic rhythm (per bar / held / anticipated ahead of the one — anticipation, never displacement: the bass root only moves on the one), bass groove pattern and melodic bass lines, licks, arp figure and octave, ghost notes, a ghost-note snare, brass stabs, square-wave blips — and **a singer**: a rule-based voice (music-cognition rules after Huron/Meyer — stepwise motion, gap-fill, chord-tone anchors) singing classical phrase forms (sentence, period, sparse calls) on a sampled choir "aah", with breaths between phrases. The live **section readout** in the UI shows what the current section rolled.
- **DJ turnover**: the last bar of each section high-passes the whole mix, the new downbeat drops the lows back in.
- **Every 8th bar is a turnaround** (arp runs backwards, a fill from the fill pool, an open hat breathes the phrase out).
- **Every 48 bars** kick and bass step aside for four bars — only while cruising, never during a driving event.
- **Humanization**: swing on the off-16ths, micro-timing jitter, velocity spread — on percussion and arps only; kick, bass and growl stay machine-tight.
- Modal harmony without dominant tension (A aeolian / dorian, add9 and 7th colors, open voicings), pentatonic arps that stay consonant over every pooled chord, and a generated-impulse convolution reverb.
- All variation is rolled **once** per section/phrase boundary into a plain data object; the sequencer only reads it. Pools are data, not code branches.

## Roadmap

Sound first, car second — the plan is to iterate on the music until it carries, then integrate the real vehicle:

1. ~~**Tone.js port**~~ — done: transport/swing/effects now run on Tone.js ([#2](https://github.com/clemenshelm/frunky/issues/2))
2. ~~**Sampled instruments**~~ — done: choir "aah" voice + Rhodes chords, FluidR3 subsets vendored under `samples/` ([#3](https://github.com/clemenshelm/frunky/issues/3))
3. **Real GPS** via the browser Geolocation API + in-car field test (update rate, accuracy at speed, audio while driving) ([#1](https://github.com/clemenshelm/frunky/issues/1))
4. **Scene detection from OpenStreetMap** (road class, curviness, tunnels, speed limits) with lookahead ([#4](https://github.com/clemenshelm/frunky/issues/4))
5. **Context layers**: weather (Open-Meteo), time of day / sun position, location-seeded motifs (your commute gets its own theme) ([#5](https://github.com/clemenshelm/frunky/issues/5))
6. Speed-limit awareness (OSM `maxspeed`) so excess speed is never musically rewarded ([#6](https://github.com/clemenshelm/frunky/issues/6))

## Influences

- **Racing/action game audio** — vertical layering keyed to intensity is the proven backbone (Forza, Mirror's Edge)
- **Solar Fields** (Mirror's Edge) — the airy, hopeful electronic palette this aims for
- Stylistic seasoning, taken with a grain of salt: **Daði Freyr** (playful funk bass melodies, square-wave charm) and **Parov Stelar** (swing feel, stabby brass-like accents)
- [EV_Speed_Sound](https://kubaessapp.github.io/EV_Speed_Sound/) — the synthetic-motor-sound project that proved GPS + Web Audio works in the Tesla browser, and provoked the question: why simulate an engine when the car could play *music*?

## Development

No build step. The audio engine runs on [Tone.js](https://tonejs.github.io/) v15 (MIT), vendored as `vendor/Tone.js` so the app stays a self-contained static site — Transport with built-in swing, fat-oscillator supersaws, chorus, convolution reverb, and compressor routing replace the earlier hand-rolled Web Audio graph. The engine lives in `index.html`; `npm test` runs a headless smoke test that drives the full scenario (standstill → armed → launch → thrust → city → cruise → highway flow → braking) against stubbed Web Audio and DOM, with a cycling pseudo-random so every variation pool is exercised.

UI copy is currently German (the prototype's first test driver is German-speaking); i18n is fair game once the engine stabilizes.

## License

[MIT](LICENSE)
