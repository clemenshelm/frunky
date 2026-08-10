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
| City (~15–65 km/h) | Syncopated percussion groove, urban detail |
| Highway (>90 km/h) | Details recede, a sustained root carries, long hypnotic arp notes: flow, not hammering |
| Curves | The whole mix leans into the turn (stereo pan) and an abstract "stretch" tone bends up with lateral g |

### Latency doctrine

A car browser delivers GPS at ~1 Hz with ~1 s of lag. The engine is designed so that never matters:

- **Continuous mappings** (bass presence, filter, thrust texture, curve lean) are latency-immune — they're smoothed and dead-reckoned, and your ear has no reference point for "what 120 km/h should sound like *right now*".
- **Discrete events** get **anticipation instead of reaction**: standstill is a musical state that *arms* the launch, so the first detected movement releases it instantly. Planned: map lookahead (OpenStreetMap road geometry) to see curves and scene changes seconds before they happen.
- **Bar quantization** hides the rest — events fire on musical boundaries anyway.

### Long-form listenability

Repetition doesn't fatigue; missing change *underneath* the repetition does. The engine follows club-music form rules:

- **Sections every 16 bars** roll new traits from data pools: chord progression (+ matching bass roots), harmonic rhythm (per bar / held / *pushed* ahead of the one), bass groove pattern, arp figure and octave, ghost notes on/off.
- **Every 8th bar is a turnaround** (arp runs backwards, a fill from the fill pool, an open hat breathes the phrase out).
- **Every 48 bars** kick and bass step aside for four bars — only while cruising, never during a driving event.
- **Humanization**: swing on the off-16ths, micro-timing jitter, velocity spread — on percussion and arps only; kick, bass and growl stay machine-tight.
- Modal harmony without dominant tension (A aeolian / dorian, add9 and 7th colors, open voicings), pentatonic arps that stay consonant over every pooled chord, and a generated-impulse convolution reverb.
- All variation is rolled **once** per section/phrase boundary into a plain data object; the sequencer only reads it. Pools are data, not code branches.

## Roadmap

1. **Real GPS** via the browser Geolocation API + in-car field test (update rate, accuracy at speed, audio while driving)
2. **Tone.js port** — battle-tested transport/swing/effects instead of the hand-rolled scheduler
3. **1–2 sampled instruments** (Rhodes-style keys, soft mallets) via [smplr](https://github.com/danigb/smplr) or Tone.js Sampler for the color layers
4. **Scene detection from OpenStreetMap** (road class, curviness, tunnels, speed limits) with lookahead
5. **Context layers**: weather (Open-Meteo), time of day / sun position, location-seeded motifs (your commute gets its own theme)
6. Speed-limit awareness (OSM `maxspeed`) so excess speed is never musically rewarded

## Influences

- **Racing/action game audio** — vertical layering keyed to intensity is the proven backbone (Forza, Mirror's Edge)
- **Solar Fields** (Mirror's Edge) — the airy, hopeful electronic palette this aims for
- Stylistic seasoning, taken with a grain of salt: **Daði Freyr** (playful funk bass melodies, square-wave charm) and **Parov Stelar** (swing feel, stabby brass-like accents)
- [EV_Speed_Sound](https://kubaessapp.github.io/EV_Speed_Sound/) — the synthetic-motor-sound project that proved GPS + Web Audio works in the Tesla browser, and provoked the question: why simulate an engine when the car could play *music*?

## Development

No build step, no dependencies. The engine lives in `index.html`; `npm test` runs a headless smoke test that drives the full scenario (standstill → armed → launch → thrust → city → cruise → highway flow → braking) against stubbed Web Audio and DOM, with a cycling pseudo-random so every variation pool is exercised.

UI copy is currently German (the prototype's first test driver is German-speaking); i18n is fair game once the engine stabilizes.

## License

[MIT](LICENSE)
