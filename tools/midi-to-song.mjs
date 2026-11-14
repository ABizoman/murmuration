// Turn a MIDI file into a Murmuration song file (see docs/ADDING_SONGS.md).
//
//   node tools/midi-to-song.mjs my-song.mid --id my-song --title "My Song" --key A --mode minor \
//        --melody "Lead" --bass "Bass" --chords "Keys" --drums "Drums" [--bars 4|8] [--from 1] [--out songs-local]
//
// --melody/--bass/--chords/--drums name the MIDI tracks (part of the track name is enough; omit a
// part you don't have). --from is the first bar to take (1 = the start). The chords in the file are
// guessed from the --chords track (or all tracks) bar by bar: check them, they matter.
// The result is written to songs-local/<id>.js, which is gitignored, and checked by compiling it.

import fs from 'node:fs';
import path from 'node:path';
import MidiPkg from '@tonejs/midi';
import { compileSong } from '../src/songs/format.js';
import { KEYS, SCALES, keyPc } from '../src/theory.js';

const { Midi } = MidiPkg;
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
if (!file) { console.log('usage: node tools/midi-to-song.mjs file.mid --id ... --title ... --key A --mode minor --melody Lead --bass Bass --chords Keys --drums Drums'); process.exit(1); }

const id = opt('id', path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const key = opt('key', 'C');
const mode = opt('mode', 'major');
const bars = Number(opt('bars', 4));
const from = Number(opt('from', 1)) - 1;
if (!KEYS.includes(key)) throw new Error(`--key must be one of ${KEYS.join(' ')}`);
if (!['major', 'minor'].includes(mode)) throw new Error('--mode must be major or minor');
if (![4, 8].includes(bars)) throw new Error('--bars must be 4 or 8');

const midi = new Midi(fs.readFileSync(file));
const ppq = midi.header.ppq;
const barTicks = ppq * 4; // assumes 4/4
const six = ppq / 4;
const start = from * barTicks;
const bpm = Math.round(midi.header.tempos[0]?.bpm || 120);
const track = (name) => (name ? midi.tracks.find((t) => t.name.toLowerCase().includes(name.toLowerCase())) : null);
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// notes -> [{ bar, step, dur, midi }] inside the window, on the 16th grid, split at bar lines
function grid(notes) {
  const out = [];
  for (const n of notes) {
    let s = Math.round((n.ticks - start) / six);
    let len = Math.max(1, Math.round(n.durationTicks / six));
    if (s < 0 || s >= bars * 16) continue;
    while (len > 0 && s < bars * 16) {
      const room = 16 - (s % 16);
      out.push({ bar: Math.floor(s / 16), step: s % 16, dur: Math.min(len, room), midi: n.midi, velocity: n.velocity });
      len -= room;
      s += room;
    }
  }
  return out;
}

// one note at a time: at each onset keep the highest (melody) or lowest (bass), cut overlaps
function line(notes, pick) {
  const byStep = new Map();
  for (const n of grid(notes)) {
    const k = n.bar * 16 + n.step;
    const cur = byStep.get(k);
    if (!cur || pick(n.midi, cur.midi)) byStep.set(k, n);
  }
  const list = [...byStep.entries()].sort((a, b) => a[0] - b[0]);
  return list.map(([k, n], i) => {
    const next = list[i + 1]?.[0] ?? Infinity;
    return { ...n, dur: Math.min(n.dur, next - k, 16 - n.step) };
  });
}

function toText(events, token) {
  const out = [];
  for (let b = 0; b < bars; b++) {
    const toks = [];
    let step = 0;
    for (const e of events.filter((x) => x.bar === b).sort((x, y) => x.step - y.step)) {
      if (e.step > step) toks.push(`.:${e.step - step}`);
      if (e.step < step) continue;
      toks.push(`${token(e)}:${e.dur}`);
      step = e.step + e.dur;
    }
    if (step < 16) toks.push(`.:${16 - step}`);
    out.push(toks.join(' '));
  }
  return out.join(' |\n               ');
}

const GM = { 35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 40: 'snare', 42: 'hat', 44: 'hat', 51: 'hat', 46: 'ohat', 49: 'ohat', 48: 'tom1', 50: 'tom1', 45: 'tom2', 47: 'tom2', 41: 'tom3', 43: 'tom3' };
function drumText(notes) {
  const rows = {};
  for (const n of grid(notes)) {
    const d = GM[n.midi];
    if (!d) continue;
    rows[d] ||= Array.from({ length: bars }, () => Array(16).fill('.'));
    rows[d][n.bar][n.step] = n.velocity > 0.85 ? 'X' : 'x';
  }
  return Object.fromEntries(Object.entries(rows).map(([d, bs]) => [d, bs.map((b) => b.join('')).join(' | ')]));
}

// Guess one chord per bar: the scale degree whose triad covers the most sounding pitch classes.
function guessChords(notes) {
  const scale = SCALES[mode];
  const kp = keyPc(key);
  const NUM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const out = [];
  for (let b = 0; b < bars; b++) {
    const weight = new Array(12).fill(0);
    for (const n of grid(notes).filter((x) => x.bar === b)) weight[n.midi % 12] += n.dur;
    let best = 0, bestScore = -1;
    for (let d = 0; d < 7; d++) {
      const pcs = [0, 2, 4].map((k) => (kp + scale[(d + k) % 7]) % 12);
      const score = pcs.reduce((a, pc) => a + weight[pc], 0) + (d === 0 ? 0.5 : 0);
      if (score > bestScore) { best = d; bestScore = score; }
    }
    const third = (scale[(best + 2) % 7] - scale[best] + 12) % 12;
    const fifth = (scale[(best + 4) % 7] - scale[best] + 12) % 12;
    let num = third === 4 ? NUM[best] : NUM[best].toLowerCase();
    if (fifth === 6) num += '°';
    out.push(num);
  }
  return out;
}

const parts = {};
const pick = { melody: opt('melody'), bass: opt('bass'), chords: opt('chords'), drums: opt('drums') };
for (const [role, name] of Object.entries(pick)) {
  if (!name) continue;
  const t = track(name);
  if (!t) throw new Error(`no track matching "${name}" (tracks: ${midi.tracks.map((x) => x.name || '(unnamed)').join(', ')})`);
  if (role === 'drums') parts.drums = { medium: drumText(t.notes) };
  else if (role === 'chords') parts.chords = { medium: toText(line(t.notes, (a, b) => a > b), () => 'x') };
  else parts[role] = { medium: toText(line(t.notes, role === 'bass' ? (a, b) => a < b : (a, b) => a > b), (e) => noteName(e.midi)) };
}
if (!Object.keys(parts).length) throw new Error('name at least one track with --melody, --bass, --chords or --drums');

const harmonySource = track(pick.chords)?.notes || midi.tracks.filter((t) => !t.instrument.percussion).flatMap((t) => t.notes);
const progression = guessChords(harmonySource);
const def = { id, title: opt('title', id), composer: opt('composer', 'unknown'), licence: opt('licence', 'local only'), key, mode, bpm, progression, parts };

const q = (s) => '`' + s + '`';
const body = (role, v) => role === 'drums'
  ? `{ ${Object.entries(v.medium).map(([d, p]) => `${d}: '${p}'`).join(',\n                 ')} }`
  : q(v.medium);
const text = `// ${def.title} — made with tools/midi-to-song.mjs from ${path.basename(file)}.
// CHECK THE CHORDS: they were guessed bar by bar. Add sparse/busy versions of parts if you like.
export default {
  id: '${def.id}',
  title: ${JSON.stringify(def.title)},
  composer: ${JSON.stringify(def.composer)},
  licence: ${JSON.stringify(def.licence)},
  key: '${key}',
  mode: '${mode}',
  bpm: ${bpm},
  progression: ${JSON.stringify(progression).replace(/,/g, ', ')}, // guessed: check
  build: ${JSON.stringify(Object.keys(parts)).replace(/,/g, ', ')}, // order the parts come in
  parts: {
${Object.entries(parts).map(([role, v]) => `    ${role}: {\n      medium: ${body(role, v)},\n    },`).join('\n')}
  },
};
`;

compileSong(def); // throws with a clear message if something is off
const outDir = opt('out', 'songs-local');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${id}.js`);
fs.writeFileSync(out, text);
console.log(`wrote ${out}: ${Object.keys(parts).join(', ')} over ${bars} bars at ${bpm} bpm, chords ${progression.join(' ')} (guessed)`);
