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
- **The car voicing, always on.** Every room this product plays in is a car — the in-dash browser, or a phone over Bluetooth into the same cabin — and a cabin adds up to ~12 dB/octave of bass below 70–90 Hz (cabin gain) while road noise masks the quiet details. The master chain answers the room in advance: a low shelf (−4.5 dB below ~100 Hz) hands the sub region back before the cabin doubles it, a presence peak (+2.5 dB around 3.2 kHz) lifts the band the details live in. On by default on **every** device; both pages keep a `Car-Mix` A/B switch, because the final decibel is decided by ears in the actual car.
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
- **Every piece rolls a recipe — the album step.** Pieces used to differ in key, mood and hook while sharing the four-on-floor kick, the hat grid, the swing and the hook's instrument — exactly the dimensions listeners use to tell one song from the next, which is why it read as "variations of the same track". A recipe is a curated frame: a **groove template** (four-on-floor / broken funk kick / halftime with the snare owning the three), the groove's own **swing**, a **lead instrument** for the hook (muted guitar / square pluck / warm detuned triangle through the same chain), and a **bass-pattern curation** so the kick and the bass never fight over the rhythmic-protagonist role (Bregman, same doctrine as the chord-style curation). Quality lives in the frame — each recipe is a proven song shape; variety lives in the generative filling — recipe × key × wave position × hook is a large space. Never the same recipe twice in a row.
- **Every piece rolls a story arc — the staging step.** Parts used to return with identical density: verse one and verse three stood on the same stage, so a piece *ran* instead of *telling*. Now each piece rolls an **arc** (classic / slowburn / banger): one stage value per form slot, and the stage decides which of the returning materials speak *this* time — brass, blips, ghost notes, bass pops, licks, snare chatter and the hook's octave lift each need a minimum stage; kick, bass, hats and the chord bed are never gated, so even the barest part grooves. The **mood picks the character** (deep never opens hot, anthem never crawls), which gives the set wave narrative teeth; the drive keeps modulating vertically inside the scene — the same two-axis layering film scores use.
- **The score knows which scene it is in.** The drive is the film and the engine writes the underscore, so the same standstill no longer gets the same music regardless of meaning. Five scenes, classified from what the engine already has — speed history, session age, and the GPS reader's **reversal detector** (movement direction over ≥6 m stretches, so it works below the heading-noise floor): **ouverture** (never yet cruised: ease in, the driver is parking out), **free**, **breath** (a stop inside flowing traffic: the pads hold an *unresolved* sus chord and the departure is the resolution), **patience** (stop-and-go: capped ornaments, softer kick, no arrival parade — entered on a deliberate hard cut, which calms better than a fade in high-demand traffic), and **coda** (reversal + stop = probably parked: a staged farewell that ends on one long resolving chord — and cancels without ceremony if the drive goes on, so a wrong guess costs nothing). The scene caps the story arc's stage: scene outside, arc inside, the drive modulating inside both. A **devicemotion capability probe** reports (as a class, never a reading) whether the browser exposes an IMU, which decides whether parking detection can be gyro-assisted on that device.
- **One leitmotif per set lap — the melodic DNA.** Film scoring's strongest device: one motif, returning transformed. The motif is rolled once per 8-episode wave lap and persisted with the residency; every piece of the lap derives its hook from it (the call *is* the motif, the response is re-answered per piece), and the recipe decides the presentation — dub states the call as a fragment and leaves the response bars to the room. A new lap rolls a new theme: recognition inside the lap, freshness across laps. A pre-motif set payload resumes its episode and simply rolls fresh — old data, new code, never a crash.
- **Every piece rolls a harmonic palette — the chord-world step.** One global pool of four Am-modal progressions meant every piece told its story over the same harmony. Industry practice makes harmonic identity a per-song commitment (the axis loop Am–F–C–G carries hundreds of hits as a song-level choice; a film cue commits to one harmonic world so the leitmotif can return recolored). The mood now draws a **palette** — *modal* (today's pool), *sus* (suspended/quartal, thirdless, floating — deep's home) or *light* (relative-major axis loops — anthem's brightness) — and three executable smoothness rules keep every palette safe by construction, pinned by tests: every progression **opens on the Am9 home voicing** (the pivot chord — any section or palette change passes through home), every chord stays in the white-note world plus dorian F# (so arps, blips, licks and the **leitmotif** stay consonant over everything), and adjacent chords always **share a tone** (chorale voice-leading, hand-voiced, never generated). Palette changes land on piece borders, which the set already dramatizes — the transition is free.
- **Every piece rolls a sound world — the orchestration step.** Pieces rolled key, mood, recipe, arc, palette and motif — and handed it all to one fixed orchestra, which is why "we always use the same instruments" was accurate. Orchestration is the last classical identity axis, and in film scoring *the* cue decision: the same leitmotif recolored by instrument beats any harmonic recoloring. A world is a curated preset bundle over the **existing** voices — *analog* (today's park: punchy club kick, saw washes), *organic* (round, woody, breathy hats, triangle washes) and *neon* (tight, cold, wide saw glass) — **swap, never stack**, so render cost stays flat on the car unit, and the backbone (thrust, car mix, roles, the hook chain the recipe owns) is untouched: five seconds in, it is still Frunky; two pieces from different worlds are never confused. Mood-coupled (deep rounds off, anthem goes cold), never the same world twice in a row (album practice), and physics-compensating volume **trims are test-bounded** so a world can never smuggle in a mix change. *analog* is pinned value-by-value as the regression reference for the whole instrument park.
- **The mix has a stage — depth staging.** "The whole mix is relatively flat" was accurate: every voice sat on the same depth plane and dead center. Now the band stands on a stage: drums and bass dry at the **front**, the hook at its middle distance, the chord carpet (pad + gate) clearly **behind** the band via a larger share of the one shared room — three depth planes, no second reverb. Width is **placement, never a side-show**: small static pans (hats, shaker, percussion, toms, blips, arp, Rhodes — the anchors kick/snare/bass stay center so the car mix keeps its spine), all test-bounded to ±0.35. Each sound world owns a **room size** (organic breathes at 1.35×, neon stands close and dry at 0.7×, analog is the 1× reference) as a factor on the shared send, and a very quiet dark **air bed** breathes underneath with the drive — more in a deep piece, ducked under braking, gone at rest. Atmosphere in the literal sense.
- **Transition craft — the DJ's tension tools, form-anchored.** A build-up is a promise with a known payoff instant, so these devices ride the **form** (the engine knows when the final chorus lands) while the drive keeps its own continuous tension tools (rise canon, brake filter, growl). The **ride**: the last four bars before the final chorus pull the lows out slowly — the highpass climbs bar by bar and releases on the one, the classic multi-bar DJ filter move (every other transition keeps the one-bar turnover). The **build**: snare density doubles toward the final chorus and out of the bridge rebuild — 8ths, then a 16th roll with rising velocity — and it plays *through* the 48-bar breather on purpose, because kick and bass stepping aside under a tightening roll is the classic pre-drop strip-back. The **throw**: the hook's last note before its rest window is thrown into the shared delay (a dedicated send opens for that one note, the next barline closes it) so the tail answers from the empty bars. The **fall**: the drop's release half — a falling sweep after the impact, the mirror of the riser that led in.
- **The warp, one bass, and drops that pay off.** Under a hard push the ordinary music now *recedes* — muffled, quieter, further away — while the force voices (growl, thrust sub, rise figure, brake pressure) stay near: the acoustic version of stars becoming streaks, and a simulation of what stress really does to hearing (auditory exclusion — under high arousal, sound reports as muffled and distant). The growl and the thrust sub are **pitch-bound to the current chord root** (they used to drone the tonic under every chord — below ~100 Hz even consonant intervals share one critical band and read as two basses fighting). Every build-up now lands on a real **drop**: breath, sub impact, falling sweep, a fast chord stab and the open hat together on the one — the final chorus earns it, not only the bridge exit. Chord **anticipations are phrase gestures now** (pushing every bar re-normalizes the ear until the one dissolves): only the change into each 4-bar phrase leans in early, and the bass plays the pickup with it. The **snare grew a crack**: noise + shell body + a highpassed snap layer on full backbeats, and roll hits wander their band-pass color so sixteen of them read as a drummer, not a machine gun. *neon* v2 goes **hollow instead of sharp**: squares for bass and gate, exactly one pane of saw glass (a test-pinned ceiling), a slightly open room.
- **The Muse elements, and an opera borrow.** Two new pool members carry the drama: the **lament palette** — the Andalusian descent (Am G F E, the E as a thirdless E7sus so the romantic-minor gravity stays inside the consonance rule) joins the deep and anthem pools; and the **colossus recipe** — a glam stomp played nearly straight, the bass driving in straight 8ths, and the hook in the hands of a **fuzz bass** an octave down (the bass as the star is the signature move). From opera, the oldest climb-into-a-climax device: a quiet **tremolo crescendo** (rapid soft string-style restrikes on the current chord) through the last build bars, while the snare roll **swims in growing room** — its reverb share swells toward the drop and the gap then cuts the dry signal so the hall tail rings into the breath. The warp got noticeably deeper (down to the low kilohertz, almost half the music band's level), and *neon*'s hollow organ voices stepped back another decibel.
- **The wash overlaps its successor, and note lengths breathe.** The sparse-anticipation change had left wash chords dying before their barline (the one opened on a hole with a 1.1 s attack) — every wash chord now **rings past the next barline**, and a test walks whole pieces asserting exactly that at every wash barline, per harmonic rhythm. Dense bass patterns (the straight-8ths drive) play **detached**, so the mono bass never rings into its own next hit and gets chopped at the barline. Note lengths stopped being uniform: the arp's downbeats ring longer than its offbeats, and the hook-cell pool carries **dotted rhythms**. *neon*'s bass got the physics lesson its square deserved — a square carries its energy in exactly the band a lowpass passes, which is why the saw→square swap got *louder* despite a deeper trim; the window now sits below analog's (430 Hz) with the full trim allowance, and the fuzz lead gives back the loudness its waveshaper adds.
- **The highway earns its drama.** The lift used to run on a 24-bar clock — always at the expected moment, which is what kills tension. Now the pedal phase carries a **hazard**: the longer it carries, the likelier the lift, so it is earned and never metronomic. Every lift is preceded by the **same four build bars the final chorus earns** (ride, roll, growing room, tremolo — one unified build window now serves the form's run-up, the bridge rebuild and the flow lift), its entry **is the drop** (breath, impact, chord wall), and the lift itself is the **dense reward**: the deliberately thinned highway layers — kick, bass, hats, arp offbeats — come back for its eight bars, so the payoff is the whole following section, not one kick. Between lifts the carrier rotates (the Rhodes answers every other phrase) so the pedal never falls asleep.
- **Fill craft — the drummer's hierarchy.** The fill chapter was the thinnest ornament in the engine (a "toms" fill of two hits). Now a curated crate of hand-set one-bar phrases plays in the drummer's three sizes: a **small shrug** at half-phrase tails (occasional, diced), the **phrase-end answer** every eight bars, and a **full-bar statement** into every new part — velocities scaled by the story arc's stage, so a sparse opening never gets a show-off, and fills always live at the bar's *tail* (the boundary predictable, the content not — which is exactly what the ear counts as musical intent). And the **last chorus gets everything**: the final return forces on the ornaments earlier choruses held back (brass, blips, the octave lift), except under the gate, whose curation outranks the payoff.
- **The highway holds its form still, and the lift became deliberate.** Field reports named it precisely: "buildups into nothing", "a puzzling chord change right after the build", "transitions between parts sound unnatural". All three were structural. The song form kept marching on the highway — part changes performed their whole ceremony (hush, statement fill, at piece boundaries a new key and a new orchestra) whose payoff the pedal harmony deliberately never delivers, and the form's build/gap/swell announcements fired for choruses that never audibly arrive. Now **the form holds still while flow is latched** (the lift *is* the highway's form; the piece resumes at the next boundary after the exit), all form announcements, the 48-bar breather and the full-bar statement fills stay off the highway. The chord change at the drop was a real bug twice over: the lift's progression read the *absolute* bar number (entering at a random point of its own cycle) and opened away from the pedal's root. It is **anchored to its own start** now and opens **on** the pedal's root — the drop's one lands on ground the ear already stands on, the journey (down to F, up through G, home brighter) happens inside the lift. And lifts are rarer (hazard from bar 16, capped low) with **diced lengths** (8 or 12 bars), so they read as earned events, not a schedule.
- **The highway works in waves, not drops — with lights against the dusk.** Build-then-drop is EDM grammar: an *event*, with a silence-breath — exactly what a sustained cruise refuses. The lift's entry is now a **crescendo that crests on the one** (no gap, no impact; a crash marks the arrival like an orchestral cymbal) and its exit **tapers** over two bars instead of stopping on a hush. Against "the sustained minor turns depressing": **dawn pedal windows** (thirdless open voicings with one dorian F#, diced in long windows), a **shimmer micro-crest** (four bars, arp an octave up — the small light between the big ones), and the lap's **ghost theme drifting over the pedal**. The build roll stopped being a tin can: it **starts dark and opens with the build**, every roll hit grounded by a whisper of body.
- **Hooks obey the earworm rules, and the theme returns as a ghost.** The motif is an enforced **home-to-home arch** (repeated home notes, exactly one upward leap as the twist, monotone gap-fill descent — Jakubowski's earworm recipe, executable), and the hook finally **asks before it answers**: the call ends off home, the response keeps its lifted middle and lands home. The lap's theme also returns **disguised** — augmented, an octave up, quiet through the pad's room — in verses, breakdowns and over the highway pedal: film scoring's oldest device. The lick and fill crates grew by hand-curated **classics**: blues curl, descending run, octave drop; paired-tom cascade, linear fill, dragged snare.
- **The drop hits with the whole spectrum, and *neon* learned clarity.** The drop's payoff used to be a naked sine sweep — the "cheap kick" of the field report. Now the wall is layered the way produced drops are: the **real kick** for the attack, the **sub impact** for the body, a **crash** with a reverb tail for the top, the **bass root** back on the ground, plus chord stab and downlifter — the whole spectrum returns at once after the breath. And *neon* v3 ends the square-bass saga: a square carries ~4.8 dB more RMS than the fattriangle at equal peak, with its energy exactly in the band a bass lowpass passes, so no trim could win. Cold now means **clarity** — tight kick, crisp hats, small room — with a triangle bass in a window darker than analog's and a hollow gate; only the pad keeps the one pane of glass.
- **Every piece rolls its own key (±2/±3 semitones)**: variation pools can't fix a universe where the tonic never moves, and the key never repeats from one piece to the next — not even across drives.
- **The mood is dramaturgy, not a dice roll**: pieces ride a **set wave** (warm-up → build → peak → breathe → rebuild → double peak, ~27 min per lap) the way a DJ set rides its energy curve — the valleys are what make the peaks land. Deep pulls the payoff elements back, anthem leans into them.
- **Drives are episodes of one running set**: the set state (episode number, key, progression-walk position — no identifier, nothing about the drive) persists in localStorage, so a daily 10-minute commute resumes wherever the wave stood instead of resetting to episode one. The payload is versioned and validated field by field; anything unreadable starts a fresh set rather than crashing the music.
- **Sections every 16 bars** roll new traits from data pools: chord progression (walking a graph of proven progressions, never a blind jump), harmonic rhythm (per bar / held / anticipated ahead of the one — anticipation, never displacement: the bass root only moves on the one), chord instrumentation (pad wash / rolled Rhodes / broken 8ths / trance gate), bass groove pattern and melodic bass lines, licks, arp figure and octave, ghost notes, a ghost-note snare, brass stabs, square-wave blips. The live **dashboard** in the UI shows the arrangement and what the current section rolled.
- **Combinations are curated, not free** (auditory scene analysis: at most one rhythmic protagonist, figures must agree on when harmony changes): broken/gate chord figures exclude anticipated harmonic rhythms, the gate silences blips and brass, broken Rhodes pushes the arp up an octave for stream segregation, sibling parts must differ in chord style and bass pattern, and the Rhodes never collides with itself in two roles.
- **The combination matrix goes all the way up.** "Nothing sounds wrong, but no groove emerges" was the field report, and the gaps were real: the recipe rolled free of the mood (a glam-stomp fuzz *colossus* inside a Deep organic piece), the palette free of the recipe (Andalusian lament under a funk strut). Now the **mood curates the recipes** (deep never stomps or struts, anthem never drops to halftime), the **recipe curates its harmonic language** (colossus speaks lament/modal, dub speaks sus/modal, strut never walks the lament) **and its rhythm** (the stomp holds chords to the barline — Witek's inverted U: stacked syncopation buries the pulse a groove needs), and each part keeps **one hook-answerer** (blips *or* brass, never both — except the sanctioned last-chorus everything-moment) and **one eighth-note figure** (no melodic bass line under broken/gate chord figures). Curation over free combinatorics, pools as data — the album doctrine, one level up.
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
