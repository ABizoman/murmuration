// Transitions: what a band does at the seams between sections (Phase 5 of
// docs/MUSIC_QUALITY_PLAN.md). Applied by Agent.compose() to the winning part, after scoring and
// before humanise(), so they end up in the note data that is gossiped: every device plays the same
// fill, crash and riser. Pure: everything comes from the directive (form.js), the seed and the phrase.
//
//   fill    last bar of a section whose next section starts with a fill: the last 4 or 8 steps
//           become snare and tom 16ths, getting louder (kept as is if the loop already has a fill)
//   crash   step 0 of the first phrase of a section that starts with a crash (the hat there goes)
//   riser   the whole last bar before a section that starts with a riser (even if the drums rest)
//   drop    the last bar of the breakdown: the bass and the melody stop, only the chords remain
//   end     the coda after the last outro: one note on the downbeat from everyone

import { seededRandom } from './seed.js';
import { keyPc } from './theory.js';

const SNARES = new Set(['snare', 'clap', 'rim']);
const TOMS = new Set(['tom1', 'tom2', 'tom3']);
const HATS = new Set(['hat', 'hihat', 'ohat', 'ride']);
const LAST_BAR = 48;

export const hasFill = (notes, fromStep = LAST_BAR) =>
  notes.filter((n) => n.step >= fromStep && (SNARES.has(n.drum) || TOMS.has(n.drum))).length >= 6;

// A generated fill over the last `len` steps: snare first, then the toms walking down, velocity
// rising 0.5 -> 0.95, and a kick on the first step to push off.
export function makeFill(len, random) {
  const from = 64 - len;
  const out = [{ step: from, dur: 1, vel: 0.8, drum: 'kick' }];
  const kit = random() < 0.5 ? ['snare', 'snare', 'tom1', 'tom2', 'tom3'] : ['snare', 'tom1', 'tom1', 'tom2', 'tom3'];
  for (let i = 0; i < len; i++) {
    const drum = kit[Math.min(kit.length - 1, Math.floor((i / len) * kit.length))];
    out.push({ step: from + i, dur: 1, vel: Math.round((0.5 + (0.45 * i) / Math.max(1, len - 1)) * 100) / 100, drum });
  }
  return out;
}

export function applyTransitions(notes, { role, dir, structure, phrase }) {
  if (!dir || !dir.section) return notes;
  let out = notes.map((n) => ({ ...n }));
  const next = dir.nextTransitionIn || [];
  const into = dir.transitionIn || [];

  if (role === 'drums') {
    if (next.includes('fill') && out.length && !hasFill(out)) {
      const r = seededRandom(structure.seed, phrase, 'fill');
      const len = r() < 0.5 ? 4 : 8;
      out = out.filter((n) => n.step < 64 - len).concat(makeFill(len, r));
    }
    if (into.includes('crash')) {
      out = out.filter((n) => !(n.step === 0 && HATS.has(n.drum)));
      out.push({ step: 0, dur: 4, vel: 0.85, drum: 'crash' });
      if (!out.some((n) => n.step === 0 && n.drum === 'kick')) out.push({ step: 0, dur: 1, vel: 0.9, drum: 'kick' });
    }
    if (next.includes('riser')) out.push({ step: LAST_BAR, dur: 16, vel: 0.8, drum: 'riser' });
  }

  if (dir.dropLastBar && (role === 'bass' || role === 'melody')) {
    out = out.filter((n) => n.step < LAST_BAR).map((n) => (n.step + n.dur > LAST_BAR ? { ...n, dur: LAST_BAR - n.step } : n));
  }

  out.sort((a, b) => a.step - b.step);
  return out;
}

// The coda: chords hold the tonic for two bars, the bass its root, the melody the tonic an octave
// above middle C, the drums a kick and a crash.
export function endNotes(role, structure) {
  const root = keyPc(structure.key);
  const near = (target) => {
    let m = target - ((((target - root) % 12) + 12) % 12);
    if (target - m > 6) m += 12;
    return m;
  };
  if (role === 'drums') return [{ step: 0, dur: 4, vel: 0.9, drum: 'kick' }, { step: 0, dur: 4, vel: 0.85, drum: 'crash' }];
  if (role === 'bass') return [{ step: 0, dur: 32, vel: 0.85, midi: near(40) }];
  if (role === 'melody') return [{ step: 0, dur: 32, vel: 0.7, midi: near(74) }];
  if (role === 'chords') {
    const third = structure.mode === 'minor' ? 3 : 4;
    const r = near(60);
    return [{ step: 0, dur: 32, vel: 0.75, midis: [r, r + third, r + 7, r + 12] }];
  }
  return [];
}

// Used by the QA report and the tests: which steps of a part hold a crash, a riser, a fill.
export const transitionsIn = (notes) => ({
  crash: notes.some((n) => n.drum === 'crash' && n.step === 0),
  riser: notes.some((n) => n.drum === 'riser' && n.step === LAST_BAR),
  // a fill: the bar is crowded with snare and toms, or its last 4 steps are all snare/tom hits
  fill: hasFill(notes) || [60, 61, 62, 63].every((s) => notes.some((n) => n.step === s && (SNARES.has(n.drum) || TOMS.has(n.drum)))),
});

