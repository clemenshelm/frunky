// Sample crate calibration — measurement half (Build 63).
//
// Field report: "the instrument volumes don't fit any more, nothing sounds
// harmonious." Sample collections are recorded at whatever level the
// session happened to have — per instrument AND per note — while the synth
// voices were mixed against the FluidR3 Rhodes. Guessed sampler volumes
// cannot fix that; measurement can.
//
//   node tools/measure-samples.mjs            # measure, print, write JSON
//
// For every mp3 in every crate this decodes to mono PCM (ffmpeg, dev-time
// only — nothing here ships to the browser) and measures:
//   – loudness: RMS of the loudest 500 ms window (robust across percussive
//     piano and sustained violin — full-file RMS drowns in decay tails);
//   – peak;
//   – pitch: dominant frequency via autocorrelation of the loudest window,
//     reported as cents offset from the note the FILENAME claims. VSCO
//     community recordings are known to drift; a mistuned note in a
//     Sampler detunes every chord it stretches to.
// Results land in tools/sample-loudness.json; the engine's per-sampler
// trims are derived from the per-set medians against the rhodes reference,
// and samples.test.mjs pins engine constants to this committed evidence.
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(HERE, "..", "samples");
const SR = 44100;

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteFreq(name) {
  const m = /^([A-G])([b#]?)(\d)$/.exec(name);
  if (!m) return null;
  let pc = NOTE_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const midi = (parseInt(m[3], 10) + 1) * 12 + pc;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function decode(path) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1",
    "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

function measure(pcm) {
  const win = Math.floor(SR * 0.5), hop = Math.floor(SR * 0.1);
  let bestRms = 0, bestAt = 0, peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  for (let start = 0; start + win <= pcm.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / win);
    if (rms > bestRms) { bestRms = rms; bestAt = start; }
  }
  return { rms: bestRms, peak, at: bestAt, win };
}

// pitch as cents offset from an expected frequency: Goertzel power sweep in
// 2-cent steps across ±100 cents around the claim. Autocorrelation was the
// first draft and lied above ~1 kHz — an integer lag near 33 samples
// quantizes to ±15-cent steps, which mislabeled E6 by 9 cents
function centsOff(pcm, at, want) {
  const N = Math.min(65536, pcm.length - at);
  const re = new Float64Array(N);
  for (let i = 0; i < N; i++)
    re[i] = pcm[at + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  let bestC = null, bestP = 0;
  for (let c = -100; c <= 100; c += 2) {
    const f = want * Math.pow(2, c / 1200);
    const w = 2 * Math.PI * f / SR, cw = Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const s0 = re[i] + 2 * cw * s1 - s2; s2 = s1; s1 = s0; }
    const p = s1 * s1 + s2 * s2 - 2 * cw * s1 * s2;
    if (p > bestP) { bestP = p; bestC = c; }
  }
  return bestC;
}

const out = { note: "loudest-500ms-window RMS; pitch via autocorrelation; " +
  "cents relative to the filename's pitch (octave errors folded)", sets: {} };
for (const dir of ["rhodes", "guitar", "piano", "violin", "cello"]) {
  const files = readdirSync(join(SAMPLES, dir)).filter((f) => f.endsWith(".mp3")).sort();
  const notes = {};
  for (const f of files) {
    const pcm = decode(join(SAMPLES, dir, f));
    const m = measure(pcm);
    const want = noteFreq(f.replace(".mp3", ""));
    const cents = want ? centsOff(pcm, m.at, want) : null;
    notes[f] = { rmsDb: +(20 * Math.log10(m.rms)).toFixed(1),
      peakDb: +(20 * Math.log10(m.peak)).toFixed(1), cents };
  }
  const rmsList = Object.values(notes).map((n) => n.rmsDb).sort((a, b) => a - b);
  const median = rmsList[Math.floor(rmsList.length / 2)];
  out.sets[dir] = { medianRmsDb: median,
    spreadDb: +(rmsList[rmsList.length - 1] - rmsList[0]).toFixed(1), notes };
}
writeFileSync(join(HERE, "sample-loudness.json"), JSON.stringify(out, null, 1) + "\n");
for (const [dir, s] of Object.entries(out.sets)) {
  console.log(dir.padEnd(7), "median", s.medianRmsDb, "dB  spread", s.spreadDb, "dB");
  for (const [f, n] of Object.entries(s.notes)) {
    const warn = Math.abs(n.cents ?? 0) > 20 ? "  <-- MISTUNED" : "";
    console.log("  ", f.padEnd(8), n.rmsDb, "dB  peak", n.peakDb, "dB  ",
      (n.cents ?? "?") + " cents" + warn);
  }
}
