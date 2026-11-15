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
//
// Build-ups (round 2, step 3), in the last phrase of a section that leads into a hook section
// (directive.buildUp: pre -> chorus, verse2 -> chorus, breakdown -> finalChorus):
//   sweep   the chords, the pad and the arp open up from dark to bright over the phrase: their
//           first note carries `sweep` = the steps left to the end of the phrase, and audio.js
//           ramps that part's lowpass from that note to the chorus downbeat, where it snaps open
//   drop    the drums, the bass and the perc leave the last half bar empty (from step 56), so the
//           chorus downbeat lands on silence; the drum fill moves to end at the drop, the riser stays
// And into any other new section (verse -> pre, chorus -> verse2, outro -> verse2, -> the coda):
//   walk    the bass's last beats become a stepwise walk up (or down) the scale to the root of the
//           next section's first chord

import { seededRandom } from './seed.js';
import { keyPc, SCALES } from './theory.js';
import { chordAt } from './render.js';

const SNARES = new Set(['snare', 'clap', 'rim']);
const TOMS = new Set(['tom1', 'tom2', 'tom3']);
const HATS = new Set(['hat', 'hihat', 'ohat', 'ride']);
const LAST_BAR = 48;
export const DROP_AT = 56; // the drop: the last half bar before a chorus is left empty
export const SWEEP_ROLES = ['chords', 'pad', 'arp'];
export const DROP_ROLES = ['drums', 'bass', 'perc'];

export const hasFill = (notes, fromStep = LAST_BAR) =>
  notes.filter((n) => n.step >= fromStep && (SNARES.has(n.drum) || TOMS.has(n.drum))).length >= 6;

// A generated fill over the last `len` steps: snare first, then the toms walking down, velocity
// rising 0.5 -> 0.95, and a kick on the first step to push off.
export function makeFill(len, random, end = 64) {
  const from = end - len;
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

  const drop = !!dir.buildUp && DROP_ROLES.includes(role);
  if (role === 'drums') {
    // Before a drop the fill always goes in (the loop's own fill would be cut in half), ends at
    // the drop and is a full 8 steps (half a bar).
    const fillEnd = drop ? DROP_AT : 64;
    if (next.includes('fill') && out.length && (drop || !hasFill(out))) {
      const r = seededRandom(structure.seed, phrase, 'fill');
      const len = r() < 0.5 && !drop ? 4 : 8;
      out = out.filter((n) => n.step < fillEnd - len || n.step >= fillEnd).concat(makeFill(len, r, fillEnd));
    }
    if (into.includes('crash')) {
      out = out.filter((n) => !(n.step === 0 && HATS.has(n.drum)));
      out.push({ step: 0, dur: 4, vel: 0.85, drum: 'crash' });
      if (!out.some((n) => n.step === 0 && n.drum === 'kick')) out.push({ step: 0, dur: 1, vel: 0.9, drum: 'kick' });
    }
    if (drop) out = cutFrom(out, DROP_AT);
    if (next.includes('riser')) out.push({ step: LAST_BAR, dur: 16, vel: 0.8, drum: 'riser' });
  } else if (drop) out = cutFrom(out, DROP_AT);

  if (dir.buildUp && SWEEP_ROLES.includes(role) && out.length) {
    out.sort((a, b) => a.step - b.step);
    out[0] = { ...out[0], sweep: 64 - out[0].step };
  }

  if (role === 'bass' && wantsWalk(dir) && out.some((n) => n.step < WALK_FROM[0])) {
    out = walkUp(out, chordAt(structure, phrase + 1, 0), structure, seededRandom(structure.seed, phrase, 'walk'));
  }

  if (dir.dropLastBar && ['bass', 'melody', 'arp', 'perc'].includes(role)) {
    out = out.filter((n) => n.step < LAST_BAR).map((n) => (n.step + n.dur > LAST_BAR ? { ...n, dur: LAST_BAR - n.step } : n));
  }

  out.sort((a, b) => a.step - b.step);
  return out;
}

// Notes from `step` on are dropped; notes that ring past it are cut short there.
const cutFrom = (notes, step) => notes.filter((n) => n.step < step).map((n) => (n.step + n.dur > step ? { ...n, dur: step - n.step } : n));

// A bass walk goes into every new section except a hook section (that gets the drop), a section
// where the bass sits out, and the breakdown's own drop.
export const WALK_FROM = [52, 56]; // three quarter notes from beat 2, or four 8ths from beat 3
const wantsWalk = (dir) => !!(dir.isLastPhrase && dir.nextSection && !dir.nextHook && !dir.buildUp && !dir.dropLastBar && !dir.end && dir.nextPlan?.bass !== 'out');

// The walk: the bass's last notes become 3 or 4 neighbouring scale notes leading into `target`'s
// root, from below (or from above, when the bass was already higher). Every walk note is a scale
// note; the root itself lands on the next section's downbeat.
export function walkUp(notes, target, structure, random) {
  const three = random() < 0.5;
  const from = three ? WALK_FROM[0] : WALK_FROM[1];
  const steps = three ? [52, 56, 60] : [56, 58, 60, 62];
  const len = three ? 4 : 2;
  const kept = cutFrom(notes, from);
  const ref = [...kept].reverse().find((n) => Number.isFinite(n.midi))?.midi ?? 40;
  // the target root in the octave nearest the last bass note, kept in the bass range
  let root = ref - ((((ref - target.rootPc) % 12) + 12) % 12);
  if (ref - root > 6) root += 12;
  while (root < 33) root += 12;
  while (root > 52) root -= 12;
  const tonic = keyPc(structure.key);
  const inScale = new Set((SCALES[structure.mode] || SCALES.major).map((x) => (tonic + x) % 12));
  let up = ref <= root;
  if (up && root - 7 < 28) up = false; // four scale steps can span 7 semitones: never into the mud
  else if (!up && root + 7 > 55) up = true;
  const walk = [];
  for (let m = root + (up ? -1 : 1); walk.length < steps.length; m += up ? -1 : 1) if (inScale.has(((m % 12) + 12) % 12)) walk.unshift(m);
  const added = walk.map((midi, i) => ({ step: steps[i], dur: len, vel: Math.round((0.72 + (0.18 * i) / (steps.length - 1)) * 100) / 100, midi }));
  return kept.concat(added);
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
  if (role === 'perc') return [];
  if (role === 'arp') return [{ step: 0, dur: 16, vel: 0.5, midi: near(67) }];
  if (role === 'pad') {
    const third = structure.mode === 'minor' ? 3 : 4;
    const r = near(64);
    return [{ step: 0, dur: 48, vel: 0.5, midis: [r, r + third, r + 7, r + 12] }];
  }
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
  // (or, before a drop, the same just before the drop at step 56)
  fill: hasFill(notes) || [60, 61, 62, 63].every((s) => notes.some((n) => n.step === s && (SNARES.has(n.drum) || TOMS.has(n.drum))))
    || [52, 53, 54, 55].every((s) => notes.some((n) => n.step === s && (SNARES.has(n.drum) || TOMS.has(n.drum)))),
  // the drop before a chorus: nothing but the riser from step 56
  drop: !notes.some((n) => n.step >= DROP_AT && n.drum !== 'riser'),
});

