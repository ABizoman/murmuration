// Echo and answer: turn "I react to that part" into notes.
//
// echo   = imitate. Between two melodic parts (bass, melody) it copies the other part's rhythm and
//          contour, moved into my register and onto the current chords (a canon, one phrase later).
//          Otherwise it copies the rhythm: my pitches (or my kick drum) land on their onsets.
// answer = respond. I play where the other part leaves gaps. A melody answering a melodic part
//          replies to each of its gestures with the mirror image, half a bar later.
//
// The target is a part summary from the shared score (usually the previous phrase).

import { kindOf } from '../loops.js';
import { chordAt } from '../render.js';
import { anchorFor, degreeToMidi, diatonicIndex, rootNear } from '../theory.js';

const strength = (step) => { const s = step % 16; return s === 0 ? 5 : s % 8 === 0 ? 4 : s % 4 === 0 ? 3 : s % 2 === 0 ? 2 : 1; };
const PITCHED_MAX = { 1: 3, 2: 6, 3: 10 }; // notes per bar by level
const SPARSE_MAX = { 1: 2, 2: 4, 3: 6 }; // kicks / chord stabs / bass notes per bar by level
const isMelodic = (role) => kindOf(role) === 'bass' || kindOf(role) === 'melody';
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const barOf = (n) => Math.floor(n.step / 16);
const byStep = (a, b) => a.step - b.step;

function thin(items, max, stepOf = (x) => x) {
  if (items.length <= max) return items;
  return [...items].sort((a, b) => strength(stepOf(b)) - strength(stepOf(a)) || stepOf(a) - stepOf(b)).slice(0, max).sort((a, b) => stepOf(a) - stepOf(b));
}

function onsetSteps(target) {
  let notes = target.notes;
  if (kindOf(target.role) === 'drums') {
    const kicks = notes.filter((n) => n.drum === 'kick'); // "lock to the kick"
    if (kicks.length) notes = kicks;
  }
  return [...new Set(notes.map((n) => n.step))].sort((a, b) => a - b);
}

function tidy(notes) {
  const seen = new Set();
  return notes
    .filter((n) => n.step >= 0 && n.step < 64 && n.dur > 0)
    .filter((n) => {
      const k = `${n.step}:${n.drum ?? n.midi ?? n.midis?.join()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(byStep);
}

// env: { role, level, register, structure, phrase }
function echoRhythm(base, target, env) {
  const { level } = env;
  const role = kindOf(env.role); // pad behaves like chords, arp like a melody, perc like drums
  const steps = onsetSteps(target);
  const out = [];
  let lastSeq = [], lastVoicing = null;
  for (let bar = 0; bar < 4; bar++) {
    const mine = base.filter((n) => barOf(n) === bar);
    const theirs = thin(steps.filter((s) => Math.floor(s / 16) === bar), role === 'melody' ? PITCHED_MAX[level] : SPARSE_MAX[level]);
    const vel = (s) => (strength(s) >= 3 ? 0.85 : 0.6);
    const gap = (i) => (theirs[i + 1] ?? (bar + 1) * 16) - theirs[i];
    if (role === 'drums') {
      if (!theirs.length) { out.push(...mine); continue; }
      out.push(...mine.filter((n) => n.drum !== 'kick'));
      for (const s of theirs) out.push({ step: s, dur: 1, vel: vel(s), drum: 'kick' });
    } else if (role === 'chords') {
      const voicing = mine[0]?.midis ?? lastVoicing;
      if (voicing) lastVoicing = voicing;
      if (!theirs.length || !voicing) { out.push(...mine); continue; }
      theirs.forEach((s, i) => out.push({ step: s, dur: clamp(gap(i), 1, level === 1 ? 8 : 4), vel: vel(s) * 0.9, midis: voicing }));
    } else {
      const seq = mine.length ? mine.map((n) => n.midi) : lastSeq;
      if (mine.length) lastSeq = seq;
      if (!theirs.length || !seq.length) { out.push(...mine); continue; }
      theirs.forEach((s, i) => out.push({ step: s, dur: clamp(gap(i), 1, role === 'bass' ? 6 : 4), vel: vel(s), midi: seq[i % seq.length] }));
    }
  }
  return out;
}

// Diatonic index of each target note, relative to the chord it was played over.
function targetIndices(target, structure) {
  const pitches = target.notes.map((n) => n.midi).filter((m) => m != null).sort((a, b) => a - b);
  if (!pitches.length) return [];
  const median = pitches[Math.floor(pitches.length / 2)];
  return target.notes
    .filter((n) => n.midi != null)
    .map((n) => {
      const chord = chordAt(structure, target.phrase, barOf(n));
      return { ...n, idx: diatonicIndex(n.midi, chord, rootNear(median, chord)) };
    });
}

function place(idx, step, env) {
  const chord = chordAt(env.structure, env.phrase, Math.floor(step / 16));
  const i = kindOf(env.role) === 'bass' ? ((idx % 7) + 7) % 7 : clamp(idx, -3, 10);
  return degreeToMidi(i, 0, chord, anchorFor(env.role, chord, env.register));
}

function echoContour(base, target, env) {
  const src = targetIndices(target, env.structure);
  const max = kindOf(env.role) === 'bass' ? SPARSE_MAX[env.level] + 2 : PITCHED_MAX[env.level];
  const out = [];
  for (let bar = 0; bar < 4; bar++) {
    const theirs = thin(src.filter((n) => barOf(n) === bar), max, (n) => n.step);
    if (!theirs.length) { out.push(...base.filter((n) => barOf(n) === bar)); continue; }
    for (const n of theirs) out.push({ step: n.step, dur: kindOf(env.role) === 'bass' ? Math.min(n.dur, 6) : n.dur, vel: n.vel, midi: place(n.idx, n.step, env) });
  }
  return out;
}

export function echo(base, target, env) {
  if (!target?.notes?.length) return base;
  const out = isMelodic(env.role) && isMelodic(target.role) ? echoContour(base, target, env) : echoRhythm(base, target, env);
  return out.length ? tidy(out) : base;
}

// Which half-bars (8 of them) the target leaves open.
function gapSlots(target) {
  const counts = new Array(8).fill(0);
  for (const n of target.notes) counts[Math.floor(n.step / 8)]++;
  const sorted = [...counts].sort((a, b) => a - b);
  const median = (sorted[3] + sorted[4]) / 2;
  let gaps = counts.map((c) => c === 0 || c < median);
  const open = gaps.filter(Boolean).length;
  if (open === 0 || open === 8) gaps = [false, false, true, true, false, false, true, true]; // steady part: take bars 2 and 4
  return gaps;
}

export function answer(base, target, env) {
  if (!target?.notes?.length) return base;
  const { level } = env;
  const role = kindOf(env.role); // pad behaves like chords, arp like a melody, perc like drums
  const gaps = gapSlots(target);
  const inGap = (n) => gaps[Math.floor(n.step / 8)];
  let out;

  if (role === 'drums') {
    // keep the groove, add snare fills where the other part is silent
    out = [...base];
    gaps.forEach((open, slot) => {
      if (!open || slot % 2 === 0) return; // fills go in the second half of a bar
      for (const off of level === 1 ? [6] : level === 2 ? [4, 6] : [3, 4, 6, 7]) {
        out.push({ step: slot * 8 + off, dur: 1, vel: 0.45 + off * 0.04, drum: 'snare' });
      }
    });
  } else if (role === 'chords') {
    out = base.filter((n) => n.step % 16 === 0 || inGap(n));
    gaps.forEach((open, slot) => {
      if (!open || level < 2) return;
      const voicing = base.find((n) => barOf(n) === Math.floor(slot / 2))?.midis;
      if (voicing && !out.some((n) => Math.floor(n.step / 8) === slot && n.step % 16 !== 0)) out.push({ step: slot * 8 + 2, dur: 2, vel: 0.6, midis: voicing });
    });
  } else if (role === 'bass') {
    out = base.filter((n) => n.step % 16 === 0 || inGap(n));
  } else {
    out = base.filter(inGap);
    if (isMelodic(target.role)) {
      // reply to each gesture with its mirror image, half a bar later
      const src = targetIndices(target, env.structure);
      for (let slot = 1; slot < 8; slot++) {
        if (!gaps[slot] || gaps[slot - 1]) continue;
        const motif = thin(src.filter((n) => Math.floor(n.step / 8) === slot - 1), level + 1, (n) => n.step);
        if (!motif.length) continue;
        out = out.filter((n) => Math.floor(n.step / 8) !== slot);
        const pivot = motif[0].idx;
        for (const n of motif) {
          const step = n.step + 8;
          out.push({ step, dur: Math.min(n.dur, (slot + 1) * 8 - step), vel: n.vel, midi: place(2 * pivot - n.idx + (kindOf(target.role) === 'bass' ? 4 : 0), step, env) });
        }
      }
    }
    if (!out.length) out = base.filter((n) => barOf(n) % 2 === 1);
    // land on the root at the end of the phrase
    const lastNote = [...out].sort(byStep).pop();
    if (lastNote && lastNote.step >= 48) lastNote.midi = place(0, lastNote.step, env) + (lastNote.midi - place(0, lastNote.step, env) >= 9 ? 12 : 0);
  }
  return out.length ? tidy(out.map((n) => ({ ...n }))) : base;
}

export function applyInteraction(base, interaction, peers, env) {
  if (!interaction || interaction === 'none') return base;
  const [mode, targetRole] = interaction.split(':');
  const target = peers[targetRole];
  if (!target) return base;
  return mode === 'echo' ? echo(base, target, env) : answer(base, target, env);
}
