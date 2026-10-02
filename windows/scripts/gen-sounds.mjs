// Generates the 28 WAVs the island plays.
//
// Every one of them is synthesised here from scratch — no samples, no recordings,
// nothing lifted from the macOS original. Each is a small recipe: a couple of
// oscillators, an envelope, and sometimes a noise sweep. The point is that they
// share a voice. Montes is one character, so the palette is deliberately narrow:
// sine and triangle for anything musical, square only for the two buzzy sounds,
// filtered noise for anything physical (a gulp, a whoosh, a slap).
//
// Run with `node scripts/gen-sounds.mjs`. Output lands in `shared/sounds/`, which
// `vite.config.ts` serves at /sounds/*.wav in dev and copies into dist on build.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "shared", "sounds");

// ── Primitives ───────────────────────────────────────────────────────────────

const clamp = (x, lo = -1, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

/** Deterministic noise: same bytes on every machine, every run. */
function noise(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 2147483648) - 1;
  };
}

const sine = (p) => Math.sin(2 * Math.PI * p);
const tri = (p) => 4 * Math.abs(((p % 1) + 1) % 1 - 0.5) - 1;
const square = (p) => (((p % 1) + 1) % 1) < 0.5 ? 1 : -1;

/** Exponential decay after a short linear attack — the shape most of these want. */
const decay = (t, attack = 0.003, tau = 0.08) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / tau);

/**
 * Percussive envelope for struck sounds: instant rise, long tail, and it reaches
 * exactly zero at `dur` so the file can never end on a click.
 */
function hit(t, dur, attack = 0.002) {
  const a = Math.min(1, t / attack);
  const r = Math.max(0, 1 - t / dur) ** 1.7;
  return a * r;
}

/** One-pole low-pass. `fc` may be a number or a function of time, for sweeps. */
function lowpass(sig, fc) {
  const out = new Float64Array(sig.length);
  let y = 0;
  for (let i = 0; i < sig.length; i++) {
    const hz = typeof fc === "function" ? fc(i / SR, i) : fc;
    const a = Math.exp((-2 * Math.PI * clamp(hz, 20, SR * 0.45)) / SR);
    y = sig[i] * (1 - a) + y * a;
    out[i] = y;
  }
  return out;
}

/**
 * Chamberlin state-variable filter, used where noise needs a colour rather than a
 * dulling. Capped well below the stability limit — these are short files, and a
 * resonant filter that blows up would take the whole sound with it.
 */
function bandpass(sig, fc, q = 2) {
  const out = new Float64Array(sig.length);
  let low = 0;
  let band = 0;
  const damp = 1 / Math.max(0.5, q);
  for (let i = 0; i < sig.length; i++) {
    const hz = typeof fc === "function" ? fc(i / SR, i) : fc;
    const f = 2 * Math.sin((Math.PI * clamp(hz, 20, SR / 6)) / SR);
    const high = sig[i] - low - damp * band;
    band += f * high;
    low += f * band;
    out[i] = band;
  }
  return out;
}

/** Removes the DC a square wave or a constant-amplitude noise burst leaves behind. */
function dcblock(sig) {
  const out = new Float64Array(sig.length);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < sig.length; i++) {
    const y = sig[i] - x1 + 0.995 * y1;
    x1 = sig[i];
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Rounds both ends off. Noise-driven sounds have no natural envelope of their own. */
function taper(sig, ms = 4) {
  const n = Math.max(1, Math.round((ms / 1000) * SR));
  const out = Float64Array.from(sig);
  for (let i = 0; i < n && i < out.length; i++) {
    const k = i / n;
    out[i] *= k;
    out[out.length - 1 - i] *= k;
  }
  return out;
}

/**
 * Renders one sound: shape it, then set its level.
 *
 * The order matters more than it looks. Normalising after the filter means every
 * sound peaks at exactly `0.9 × level`, so the `level` below is the one loudness
 * knob for all twenty-eight — before it, a heavily filtered sound came out quiet
 * for reasons that had nothing to do with the level written next to it.
 */
function render(seconds, recipe, { level = 0.7, cut = 0, q = 0 } = {}) {
  const n = Math.round(seconds * SR);
  const raw = new Float64Array(n);
  recipe(raw, noise(0x9e3779b9));

  let sig = cut || q
    ? q > 0
      ? bandpass(raw, typeof cut === "function" ? cut : () => cut, q)
      : lowpass(raw, cut)
    : raw;

  // Whatever the DC blocker left behind is a fixed offset, and an offset is a
  // click waiting to happen. Subtracting the mean is exact; trusting a one-pole
  // filter to have converged on a 55 ms file is not.
  sig = dcblock(sig);
  let mean = 0;
  for (const v of sig) mean += v;
  mean /= n;
  for (let i = 0; i < n; i++) sig[i] -= mean;

  // Rounded off at both ends, so no sound ever starts or stops on a step.
  sig = taper(sig, 4);

  let peak = 0;
  for (const v of sig) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) sig[i] = (sig[i] / peak) * 0.9 * level;
  return sig;
}

/** 16-bit mono PCM. The WebView decodes this without complaint. */
function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(clamp(samples[i], -1, 1) * 32767), 44 + i * 2);
  }
  return buf;
}

// ── The voices ───────────────────────────────────────────────────────────────
//
// Written as `SOUNDS` rather than a hundred calls so the whole set reads as one
// list: you can hear the shape of the character without listening to it.

// A note repeated at several times, the way a real melody would be played.
// `at` defaults to 0 and is asserted rather than merely defaulted: a missing
// offset would become NaN, and `sig[NaN] += x` writes to a property that is not
// an index — the sound comes out as a file of zeroes, in silence.
const note = (sig, { at = 0, dur, f, amp = 1, wave = sine, tau = 0.12, attack = 0.004 }) => {
  if (!Number.isFinite(at)) throw new Error(`note: at=${at}`);
  const start = Math.round(at * SR);
  const len = Math.round(dur * SR);
  for (let i = 0; i < len; i++) {
    const k = start + i;
    if (k >= sig.length) break;
    sig[k] += wave((f * i) / SR) * decay(i / SR, attack, tau) * amp;
  }
};

/** A glide from one pitch to another — the motion that says "it moved". */
const glide = (sig, { at = 0, dur, from, to, amp = 1, wave = tri, tau = 0.1, attack = 0.004, bend = 2 }) => {
  if (!Number.isFinite(at)) throw new Error(`glide: at=${at}`);
  const start = Math.round(at * SR);
  const len = Math.round(dur * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const k = start + i;
    if (k >= sig.length) break;
    const t = i / len;
    // Exponential interpolation, like a real portamento: even in pitch, not even in time.
    const f = from * (to / from) ** (t ** bend);
    phase += f / SR;
    sig[k] += wave(phase) * decay(i / SR, attack, tau) * amp;
  }
};

/** Noise shaped by an amplitude arc — the shape of a breath or a whoosh. */
const whoosh = (sig, { at = 0, dur, rnd, amp = 1, shape = 1.4 }) => {
  if (!Number.isFinite(at)) throw new Error(`whoosh: at=${at}`);
  const start = Math.round(at * SR);
  const len = Math.round(dur * SR);
  for (let i = 0; i < len; i++) {
    const k = start + i;
    if (k >= sig.length) break;
    const t = i / len;
    const arc = Math.sin(Math.PI * t) ** shape;
    sig[k] += rnd() * arc * amp;
  }
};

const SOUNDS = {
  // ── The island itself ─────────────────────────────────────────────────────
  /** Waking up: a small step up, because it was not there a moment ago. */
  peek: [0.24, (s) => glide(s, { dur: 0.24, from: 520, to: 880, amp: 0.8 }), { level: 0.6, cut: 6000 }],
  /** Unfolding: two notes, ascending. */
  open: [
    0.34, (s) => {
      note(s, { at: 0, dur: 0.2, f: 659, wave: tri, tau: 0.09 });
      note(s, { at: 0.1, dur: 0.24, f: 988, wave: tri, tau: 0.13 });
    }, { level: 0.62, cut: 6500 },
  ],
  /** Folding away: the same shape, backwards. */
  close: [
    0.32, (s) => {
      note(s, { at: 0, dur: 0.2, f: 880, wave: tri, tau: 0.08 });
      note(s, { at: 0.1, dur: 0.22, f: 587, wave: tri, tau: 0.12 });
    }, { level: 0.58, cut: 6000 },
  ],
  /** Barely there. The cursor arrived and nothing important happened. */
  hover: [
    0.09, (s) => {
      note(s, { dur: 0.09, f: 698, amp: 0.8, tau: 0.022 });
      note(s, { dur: 0.07, f: 1046, amp: 0.22, tau: 0.016 });
    }, { level: 0.34, cut: 7000 },
  ],
  /** The workhorse click: short, neutral, easy to recognise in a dozen contexts. */
  blip: [
    0.1, (s) => {
      note(s, { dur: 0.1, f: 880, amp: 0.75, tau: 0.028 });
      note(s, { dur: 0.07, f: 1320, amp: 0.25, tau: 0.02 });
    }, { level: 0.5, cut: 7500 },
  ],
  /** A clock tick, for anything that counts down. */
  tick: [0.055, (s) => note(s, { dur: 0.055, f: 2093, tau: 0.009, attack: 0.001 }), { level: 0.4, cut: 9000 }],
  /** Getting hit, or slapping it: a thud with a body under it. */
  slap: [
    0.16, (s, rnd) => {
      whoosh(s, { dur: 0.05, rnd, amp: 0.9, shape: 1 });
      note(s, { dur: 0.14, f: 92, wave: sine, tau: 0.035, attack: 0.001 });
    }, { level: 0.85, cut: (t) => 4200 - 3000 * (t / 0.16) },
  ],

  // ── States ────────────────────────────────────────────────────────────────
  /** Settling down to work: something mechanical starting up. */
  work: [
    0.34, (s, rnd) => {
      glide(s, { dur: 0.16, from: 176, to: 131, wave: square, tau: 0.07, amp: 0.5 });
      whoosh(s, { dur: 0.2, rnd, amp: 0.35 });
      note(s, { at: 0.02, dur: 0.26, f: 262, wave: tri, tau: 0.1, amp: 0.5 });
    }, { level: 0.6, cut: (t) => 5200 - 3400 * (t / 0.34) },
  ],
  /** Done, and it went well: an open fifth, then a shimmer. */
  finish: [
    0.46, (s) => {
      note(s, { at: 0, dur: 0.24, f: 784, wave: tri, tau: 0.11 });
      note(s, { at: 0.12, dur: 0.34, f: 1175, wave: tri, tau: 0.17 });
      note(s, { at: 0.12, dur: 0.34, f: 2350, amp: 0.12, tau: 0.12 });
    }, { level: 0.66, cut: 8000 },
  ],
  /** Something is wrong. Two low notes a semitone apart beat against each other. */
  error: [
    0.4, (s) => {
      for (const at of [0, 0.19]) {
        note(s, { at, dur: 0.19, f: 155, wave: square, tau: 0.08, amp: 0.6 });
        note(s, { at, dur: 0.19, f: 164, wave: square, tau: 0.08, amp: 0.6 });
      }
    }, { level: 0.7, cut: 1400 },
  ],
  /** Needs you. Neutral on purpose — it says "look", not "worry". */
  approval: [
    0.42, (s) => {
      note(s, { at: 0, dur: 0.26, f: 587, tau: 0.13 });
      note(s, { at: 0.13, dur: 0.29, f: 880, tau: 0.16 });
    }, { level: 0.72, cut: 7000 },
  ],
  /** Waiting for an answer: up, and then up again. */
  question: [
    0.38, (s) => {
      glide(s, { at: 0, dur: 0.17, from: 659, to: 988, wave: tri, tau: 0.09 });
      glide(s, { at: 0.18, dur: 0.2, from: 880, to: 1174, wave: tri, tau: 0.1 });
    }, { level: 0.7, cut: 7500 },
  ],
  /** Permission granted: bright, short, unambiguous. */
  approve: [
    0.46, (s) => {
      for (const [f, a] of [[659, 0.6], [880, 0.5], [1319, 0.3]]) {
        note(s, { dur: 0.42, f, amp: a, tau: 0.19 });
      }
      note(s, { at: 0.02, dur: 0.3, f: 2637, amp: 0.08, tau: 0.12 });
    }, { level: 0.74, cut: 9000 },
  ],
  /** Rate limited, or fed up. A stutter, then a lower note: "no". */
  rate: [
    0.38, (s) => {
      for (const at of [0, 0.075]) {
        note(s, { at, dur: 0.07, f: 330, wave: square, tau: 0.03, amp: 0.7 });
        note(s, { at, dur: 0.07, f: 220, wave: square, tau: 0.03, amp: 0.4 });
      }
      note(s, { at: 0.2, dur: 0.18, f: 233, wave: square, tau: 0.07, amp: 0.6 });
    }, { level: 0.66, cut: 2200 },
  ],
  /** Annoyed: a descending buzz with a wobble in it. */
  annoyed: [
    0.34, (s) => {
      for (let i = 0; i < Math.round(0.34 * SR); i++) {
        const t = i / SR;
        const f = 330 - 110 * (t / 0.34);
        const trem = 0.72 + 0.28 * Math.sin(2 * Math.PI * 28 * t);
        s[i] += square(f * t) * hit(t, 0.34, 0.006) * trem * 0.7;
      }
    }, { level: 0.58, cut: 2600 },
  ],
  /** Overwhelmed: a warble that cannot settle. */
  dizzy: [
    0.95, (s) => {
      let phase = 0;
      for (let i = 0; i < Math.round(0.95 * SR); i++) {
        const t = i / SR;
        // The wobble deepens and the pitch sags — the sound of losing it.
        const depth = 30 + 55 * (t / 0.95);
        const f = 523 * (1 + depth / 523 * Math.sin(2 * Math.PI * 7.2 * t)) - 90 * (t / 0.95) ** 2;
        phase += f / SR;
        const arc = Math.sin(Math.PI * Math.min(1, t / 0.95)) ** 0.6;
        s[i] += tri(phase) * arc * 0.8;
      }
    }, { level: 0.6, cut: 4200 },
  ],
  /** Thinking: two slow pulses, low and patient. */
  think: [
    0.76, (s) => {
      for (const at of [0, 0.3]) {
        note(s, { at, dur: 0.34, f: 185, wave: tri, tau: 0.15, attack: 0.03 });
        note(s, { at, dur: 0.3, f: 370, wave: sine, tau: 0.13, attack: 0.03, amp: 0.3 });
      }
    }, { level: 0.5, cut: 2400 },
  ],
  /** Looking something up: three blips climbing a ladder. */
  search: [
    0.44, (s) => {
      [784, 988, 1174].forEach((f, i) =>
        note(s, { at: i * 0.11, dur: 0.2, f, tau: 0.05, amp: 0.7 }),
      );
    }, { level: 0.62, cut: 7500 },
  ],
  /** Going quiet: a soft sigh down. */
  sleep: [
    0.86, (s, rnd) => {
      glide(s, { dur: 0.84, from: 523, to: 330, wave: sine, tau: 0.42, attack: 0.09, amp: 0.75 });
      whoosh(s, { at: 0.05, dur: 0.7, rnd, amp: 0.06, shape: 0.7 });
    }, { level: 0.42, cut: (t) => 2600 - 1200 * (t / 0.86) },
  ],

  // ── Character ─────────────────────────────────────────────────────────────
  /** The launch greeting: a small arpeggio, the warmest thing here. */
  greet: [
    0.86, (s) => {
      [523, 659, 784, 1047].forEach((f, i) =>
        note(s, { at: i * 0.115, dur: 0.62, f, tau: 0.26, attack: 0.012, amp: 0.75 }),
      );
      note(s, { at: 0.345, dur: 0.5, f: 1568, tau: 0.22, amp: 0.16 });
    }, { level: 0.68, cut: 8000 },
  ],
  /** Affection: a held chord with a slow beat in it. */
  love: [
    0.95, (s) => {
      let phase = 0;
      for (let i = 0; i < Math.round(0.95 * SR); i++) {
        const t = i / SR;
        const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t);
        phase += (330 * vib) / SR;
        const arc = Math.min(1, t / 0.09) * Math.exp(-Math.max(0, t - 0.09) / 0.34);
        const chord = sine(phase) * 0.6 + sine(phase * 1.26) * 0.28 + sine(phase * 1.5) * 0.22;
        s[i] += chord * arc * 0.8;
      }
    }, { level: 0.6, cut: 5200 },
  ],
  /** Proud of itself: a tiny fanfare, four notes and a sparkle. */
  proud: [
    0.68, (s) => {
      [523, 659, 784, 1047].forEach((f, i) =>
        note(s, { at: i * 0.085, dur: 0.44, f, wave: tri, tau: 0.17, amp: 0.72 }),
      );
      note(s, { at: 0.26, dur: 0.4, f: 2093, amp: 0.13, tau: 0.16 });
    }, { level: 0.68, cut: 9000 },
  ],
  /** Caught you: two blips, the second one a joke. */
  wink: [
    0.24, (s) => {
      note(s, { at: 0, dur: 0.1, f: 880, tau: 0.032 });
      note(s, { at: 0.075, dur: 0.16, f: 1174, tau: 0.06 });
    }, { level: 0.55, cut: 7500 },
  ],
  /** Bored: a long downward slide that starts before it commits. */
  yawn: [
    1, (s, rnd) => {
      let phase = 0;
      for (let i = 0; i < Math.round(1 * SR); i++) {
        const t = i / SR;
        const f = 415 * (1 - 0.4 * (t / 1) ** 1.3) + 14 * Math.sin(2 * Math.PI * 6 * t);
        phase += f / SR;
        const arc = Math.sin(Math.PI * (t / 1) ** 0.8) ** 1.2;
        s[i] += tri(phase) * arc * 0.75;
      }
      whoosh(s, { at: 0.12, dur: 0.76, rnd, amp: 0.07, shape: 0.8 });
    }, { level: 0.5, cut: 3200 },
  ],

  // ── Gestures ──────────────────────────────────────────────────────────────
  /** Something has been dropped on the island. */
  attach: [
    0.18, (s, rnd) => {
      for (const at of [0, 0.085]) {
        const start = Math.round(at * SR);
        for (let i = 0; i < Math.round(0.06 * SR); i++) {
          s[start + i] += rnd() * hit(i / SR, 0.06, 0.001) * 0.7;
        }
        note(s, { at, dur: 0.06, f: 1318, tau: 0.012, attack: 0.001, amp: 0.5 });
      }
    }, { level: 0.6, cut: 6200 },
  ],
  /** Swallowing the file: air moving down, and a gulp at the bottom of it. */
  gulp: [
    0.44, (s, rnd) => {
      whoosh(s, { dur: 0.36, rnd, amp: 1, shape: 0.9 });
      glide(s, { dur: 0.3, from: 196, to: 98, wave: tri, tau: 0.16, attack: 0.02, amp: 0.6 });
      note(s, { at: 0.26, dur: 0.18, f: 131, wave: sine, tau: 0.06, amp: 0.8 });
    }, { level: 0.66, cut: (t) => 2600 - 1900 * (t / 0.44) },
  ],
  /** Question sent on its way: out and up. The glide leads, the air follows. */
  send: [
    0.3, (s, rnd) => {
      // Loud enough to be heard as air, quiet enough not to bury the rise — that
      // rise is what makes it a "send" rather than a hiss. The filter follows the
      // glide up rather than outrunning it, or the glide it is there to colour
      // gets filtered away.
      whoosh(s, { at: 0.03, dur: 0.24, rnd, amp: 0.5, shape: 1.5 });
      glide(s, { dur: 0.22, from: 392, to: 1174, wave: tri, tau: 0.11, amp: 0.85 });
    }, { level: 0.6, cut: (t) => 700 + 2400 * (t / 0.3), q: 0.9 },
  ],
  /** A single bright pop — the smallest punctuation mark there is. */
  pop: [
    0.08, (s, rnd) => {
      note(s, { dur: 0.08, f: 1174, tau: 0.014, attack: 0.0012 });
      note(s, { dur: 0.04, f: 2349, tau: 0.008, attack: 0.001, amp: 0.3 });
      whoosh(s, { dur: 0.014, rnd, amp: 0.4, shape: 1 });
    }, { level: 0.46, cut: 9000 },
  ],
};

// ── Write them out ───────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const names = Object.keys(SOUNDS).sort();
let total = 0;
let silent = 0;

for (const name of names) {
  const [seconds, recipe, opts] = SOUNDS[name];
  const samples = render(seconds, recipe, opts);

  // A recipe that writes nothing still produces a perfectly valid WAV, and the
  // island would simply never make that sound. Caught here instead, where the
  // name is still known.
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.005) {
    silent++;
    process.stderr.write(`  ${name}: SILENT — the recipe wrote no audio\n`);
    continue;
  }

  const bytes = wav(samples);
  writeFileSync(join(OUT, `${name}.wav`), bytes);
  total += bytes.length;
  process.stdout.write(
    `  ${name.padEnd(9)} ${seconds.toFixed(2)}s  ${String(bytes.length).padStart(6)} B\n`,
  );
}

if (silent) {
  process.stderr.write(`\n${silent} of ${names.length} sounds came out silent\n`);
  process.exit(1);
}

process.stdout.write(
  `\n${names.length} sounds, ${(total / 1024).toFixed(0)} KB total → shared/sounds/\n`,
);

// The island asks for exactly these names; a typo here would be a silent sound
// missing at runtime rather than a build error, so it is worth the check.
const wanted = [
  "peek", "open", "close", "hover", "blip", "slap", "annoyed", "dizzy", "greet",
  "work", "finish", "error", "approval", "question", "approve", "gulp", "tick",
  "send", "love", "pop", "proud", "wink", "yawn", "attach", "think", "search",
  "rate", "sleep",
];
const missing = wanted.filter((n) => !names.includes(n));
const extra = names.filter((n) => !wanted.includes(n));
if (missing.length || extra.length) {
  process.stderr.write(
    `\nname mismatch — missing: [${missing}] unexpected: [${extra}]\n` +
      `sound.ts asks for ${wanted.length}, this script wrote ${names.length}\n`,
  );
  process.exit(1);
}