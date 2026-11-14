// Music theory helpers. Loops are written in scale degrees relative to the current chord root,
// and this file turns them into MIDI notes for a given key, chord and register.
//
// Degree convention (diatonic, relative to the chord root):
//   0 = root, 2 = third, 4 = fifth, 6 = seventh, 7 = root an octave up, -1 = scale step below root.
//   Even degrees (0, 2, 4, 6) use the chord's actual tones, so a major V in a minor key still sounds right.
//   Odd degrees (1, 3, 5) are passing tones from the key's scale.

export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function keyPc(key) {
  const i = KEYS.indexOf(key);
  if (i < 0) throw new Error(`unknown key ${key}`);
  return i;
}

// "VI", "iv", "bVII", "ii°" -> { degree, rootPc, pcs:[root, third, fifth], seventhPc, name }
export function parseChord(numeral, key, mode) {
  const m = /^([b#]?)([ivIV]+)(°?)$/.exec(numeral);
  if (!m) throw new Error(`bad numeral ${numeral}`);
  const degree = NUMERALS.indexOf(m[2].toUpperCase());
  if (degree < 0) throw new Error(`bad numeral ${numeral}`);
  const scale = SCALES[mode];
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const rootPc = (keyPc(key) + scale[degree] + acc + 12) % 12;
  const upper = m[2] === m[2].toUpperCase();
  const shape = m[3] ? [0, 3, 6] : upper ? [0, 4, 7] : [0, 3, 7];
  const pcs = shape.map((s) => (rootPc + s) % 12);
  const seventhPc = (keyPc(key) + scale[(degree + 6) % 7]) % 12;
  return { degree, rootPc, pcs, seventhPc, name: numeral, key, mode };
}

// Pitch class of a degree relative to the chord root.
export function degreePc(deg, chord) {
  const d = ((deg % 7) + 7) % 7;
  if (d === 0) return chord.pcs[0];
  if (d === 2) return chord.pcs[1];
  if (d === 4) return chord.pcs[2];
  if (d === 6) return chord.seventhPc;
  const scale = SCALES[chord.mode];
  return (keyPc(chord.key) + scale[(chord.degree + d) % 7]) % 12;
}

// Semitones above the chord root for degree d (0..6), always 0..11.
export function degreeInterval(d, chord) {
  return (degreePc(d, chord) - chord.rootPc + 12) % 12;
}

// Where the chord root sits for each role. Register shifts by octaves.
export const REGISTERS = {
  bass: { low: 33, high: 44 }, // root placed between A1 and G#2
  chords: { center: 62 },
  melody: { low: 60, high: 71 }, // root placed in the octave from C4
};

export function anchorFor(role, chord, register = 0) {
  const r = REGISTERS[role];
  let a = r.low + ((chord.rootPc - r.low) % 12 + 12) % 12;
  return a + 12 * register;
}

export function degreeToMidi(deg, oct, chord, anchor) {
  const octs = Math.floor(deg / 7);
  const d = deg - 7 * octs;
  return anchor + degreeInterval(d, chord) + 12 * (octs + (oct || 0));
}

// Chord voicing with simple voice leading: pick the inversion closest to the previous voicing.
export function voiceChord(chord, size, prev, register = 0) {
  const pcs = size >= 4 ? [...chord.pcs, chord.seventhPc] : chord.pcs;
  const center = REGISTERS.chords.center + 12 * register;
  const candidates = [];
  for (let bottom = center - 10; bottom <= center + 2; bottom++) {
    if (!pcs.includes(((bottom % 12) + 12) % 12)) continue;
    const start = pcs.indexOf(((bottom % 12) + 12) % 12);
    const notes = [bottom];
    for (let i = 1; i < pcs.length; i++) {
      const pc = pcs[(start + i) % pcs.length];
      let n = notes[notes.length - 1] + 1;
      while (((n % 12) + 12) % 12 !== pc) n++;
      notes.push(n);
    }
    candidates.push(notes);
  }
  const cost = (v) =>
    prev && prev.length
      ? v.reduce((s, n, i) => s + Math.abs(n - prev[Math.min(i, prev.length - 1)]), 0)
      : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
  candidates.sort((a, b) => cost(a) - cost(b));
  return candidates[0];
}

// Root pitch of the chord at or below `pitch`.
export function rootNear(pitch, chord) {
  return pitch - ((((pitch - chord.rootPc) % 12) + 12) % 12);
}

// MIDI pitch -> diatonic index relative to rootRef (0 = root, 7 = root an octave up, -1 = step below).
// Notes outside the chord/scale snap to the nearest degree.
export function diatonicIndex(midi, chord, rootRef) {
  const semis = (((midi - chord.rootPc) % 12) + 12) % 12;
  let best = 0, bestDist = 99;
  for (let d = 0; d < 7; d++) {
    const iv = degreeInterval(d, chord);
    const dist = Math.min(Math.abs(iv - semis), 12 - Math.abs(iv - semis)) + (d % 2 ? 0.1 : 0);
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  return best + 7 * Math.round((midi - rootRef - degreeInterval(best, chord)) / 12);
}
