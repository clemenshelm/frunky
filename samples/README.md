# Samples

Subsets of the FluidR3_GM soundfont (MIT license), rendered to per-note mp3 by
the [MIDI.js soundfonts project](https://github.com/gleitz/midi-js-soundfonts):

- `rhodes/` — `electric_piano_1`, notes A2–C5 every minor third
- `guitar/` — `electric_guitar_muted`, notes A3–C5 every minor third (the hook lead)

Subsets of the [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)
collection by Nicholaus P. Brosowsky (code MIT; samples **CC-BY 3.0**, largely
recordings from the [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/)
by Versilian Studios / Sam Gossner, CC0):

- `piano/` — acoustic piano, A2–C5 on an A/C/E/G grid (alternative keys carrier)
- `violin/` — sustained violin, G4–E6 (the lift's string bed, upper voices)
- `cello/` — sustained cello, G3–A4 (the bed's lower voices and the aria's doubling)

(`oohs/` and `choir/` shipped with the parked voice feature and were removed
with it — git history has them if the voice returns.)

Tone.Sampler pitch-shifts between the sampled notes. The note sets stay small
on purpose: the browser decodes mp3 to raw PCM (~350 KB per second of sound),
so every extra note costs RAM on the Tesla, not just bytes on the wire.
