// Feel: the groove (Phase 1 of docs/MUSIC_QUALITY_PLAN.md). Two things live here, and both have to
// give the same answer on every device, or two phones playing one part would flam.
//
//   swingOffset(step, swing)  the shared push of the odd 16ths. Computed at playback time from
//                             `structure.swing`, which every device agrees on.
//   humanise(notes, opts)     timing, velocity and length shaping, baked into the note data
//                             (`nudge` in steps, `offsets` in steps per chord pitch, `vel`, `dur`),
//                             so a device that takes a part over or doubles it replays exactly the
//                             same performance. Every draw comes from a hash of
//                             (seed, phrase, role, note index) -- never from Math.random.
//   sanitiseNotes(list)       the note-field contract, used on notes that arrive over gossip.
//
// Nothing here is allowed to look at the clock, the device or anything outside its arguments.

import { seededRandom } from './seed.js';
import { voiceById } from './voices.js';
import { stepMs, MAX_SWING } from './clock.js';
import { kindOf } from './loops.js';

export const MAX_NUDGE = 0.25; // steps, either way
export const MAX_OFFSET = 0.5; // steps: a strum never spreads further than an 8th note
export { MAX_SWING };
const VEL = [0.25, 1];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, places = 3) => Math.round(x * 10 ** places) / 10 ** places;
const sym = (r, a) => (r() * 2 - 1) * a; // symmetric draw in +-a

// The odd 16ths are late by `swing` of a step. Every device computes this from shared data.
export const swingOffset = (step, swing = 0) => (step % 2 === 1 ? clamp(swing || 0, 0, MAX_SWING) : 0);

const HATS = new Set(['hat', 'hihat', 'ohat', 'ride', 'shaker', 'tamb']);
const TOMS = new Set(['tom1', 'tom2', 'tom3']);
const SNARES = new Set(['snare', 'clap', 'rim']);
const STRUM = new Set(['keys', 'guitar']); // pianos and guitars strum; pads, strings and brass don't
const GHOST = 0.5; // a note written quieter than this is a ghost note and stays quiet

// Downbeats strongest, then beats, then the 16ths in between.
const metric = (inBar) => (inBar % 16 === 0 ? 0.08 : inBar % 8 === 0 ? 0.04 : inBar % 4 === 0 ? 0 : -0.04);

// What the drum shaping needs to know about the whole phrase: how the hats sit in each bar, and
// which bars are fills (a bar crowded with snare and tom hits).
function drumContext(notes, order) {
  const hats = [0, 0, 0, 0];
  const rolls = [0, 0, 0, 0];
  const hatIndex = new Map();
  for (const i of order) {
    const bar = Math.floor(notes[i].step / 16);
    if (HATS.has(notes[i].drum)) hatIndex.set(i, hats[bar]++);
    if (SNARES.has(notes[i].drum) || TOMS.has(notes[i].drum)) rolls[bar]++;
  }
  return { hats, hatIndex, fill: rolls.map((c) => c >= 6) };
}

function drumFeel(n, r, ctx, i) {
  // The crash and the riser are effects placed by the arrangement: exactly on time, fixed level.
  if (n.drum === 'crash') return { nudge: 0, vel: 0.8 };
  if (n.drum === 'riser') return { nudge: 0, vel: n.vel };
  const inBar = n.step % 16;
  const bar = Math.floor(n.step / 16);
  const hat = HATS.has(n.drum);
  let nudge = 0;
  if (n.drum === 'kick') nudge = sym(r, 0.01);
  else if (SNARES.has(n.drum)) nudge = 0.02 + r() * 0.03; // a laid-back backbeat
  else if (hat) nudge = ((ctx.hatIndex.get(i) ?? 0) % 2 ? 1 : -1) * r() * 0.03; // alternating push and pull
  else if (TOMS.has(n.drum)) nudge = sym(r, 0.02);

  let vel;
  if (hat && ctx.hats[bar] >= 12) vel = inBar % 2 === 0 ? 0.9 : 0.55; // 16th hats: alternate hard/soft
  else {
    const ghost = n.vel < GHOST;
    vel = n.vel + (ghost ? 0 : metric(inBar));
    if (ghost) vel = Math.min(vel, GHOST);
  }
  if (ctx.fill[bar]) vel += 0.18 * (inBar / 15); // a fill crescendos into the next downbeat
  return { nudge, vel: vel + sym(r, 0.06) };
}

// A strum: the chord's pitches arrive low to high over 8-25 ms. Stored per pitch in steps, so the
// spread is the same number of milliseconds whatever the tempo, on every device.
function strumOffsets(midis, r, sMs) {
  const totalMs = 8 + r() * 17;
  const rank = midis.map((_, k) => k).sort((a, b) => midis[a] - midis[b]);
  const offsets = new Array(midis.length).fill(0);
  rank.forEach((k, place) => (offsets[k] = round(clamp((totalMs / sMs) * (place / (midis.length - 1)), 0, MAX_OFFSET))));
  return offsets;
}

export function humanise(notes, { role: part, phrase = 0, seed = '', voice = null, bpm = 100 } = {}) {
  if (!Array.isArray(notes) || !notes.length) return [];
  const role = kindOf(part); // pad feels like chords, arp like a melody, perc like drums
  const sMs = stepMs(bpm);
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].step - notes[b].step || a - b);
  const drums = role === 'drums' ? drumContext(notes, order) : null;
  // For the two monophonic roles: where the next note of the same part starts.
  const next = new Map();
  if (role === 'bass' || role === 'melody') for (let k = 0; k < order.length - 1; k++) next.set(order[k], notes[order[k + 1]].step);
  const strum = role === 'chords' && STRUM.has(voiceById[voice]?.family);

  return notes.map((n, i) => {
    const r = seededRandom(seed, phrase, part, i);
    const inBar = n.step % 16;
    const out = { ...n };
    let nudge = 0;
    let vel = n.vel;
    let dur = n.dur;

    if (role === 'drums') ({ nudge, vel } = drumFeel(n, r, drums, i));
    else if (role === 'bass') {
      nudge = r() * 0.02; // sits just behind the kick
      vel = n.vel + (inBar === 0 ? 0.08 : sym(r, 0.05));
      const gap = next.has(i) ? next.get(i) - n.step : null;
      if (gap != null) dur = clamp(gap - 0.5, 0.25, dur); // end a 32nd before the next bass note
    } else if (role === 'chords') {
      vel = n.vel + (inBar === 0 ? 0.08 : sym(r, 0.05));
      if (dur <= 4) dur = round(dur * 0.6); // stabs get shorter; pads keep their full length
      if (strum && Array.isArray(n.midis) && n.midis.length > 1) out.offsets = strumOffsets(n.midis, r, sMs);
    } else if (role === 'melody') {
      nudge = sym(r, 0.03) + (n.dur > 4 ? 0.01 : 0); // long notes lean a touch late
      const mid = n.step % 32; // louder towards the middle of each 2-bar idea
      vel = n.vel + 0.07 * (1 - Math.abs(mid - 16) / 16) + sym(r, 0.05);
      const gap = next.has(i) ? next.get(i) - n.step : null;
      if (gap != null && n.dur >= gap - 0.1) dur = gap; // notes that touch the next one stay legato
    }

    out.vel = round(clamp(vel, VEL[0], VEL[1]));
    out.dur = Math.max(0.25, round(dur));
    if (nudge) out.nudge = round(clamp(nudge, -MAX_NUDGE, MAX_NUDGE));
    return out;
  });
}

// Notes that arrived over gossip: keep the fields the engine, audio and screen use, drop the rest,
// and bound everything (another device, or a bad actor, could send anything).
export function sanitiseNotes(list, { maxNotes = 400 } = {}) {
  if (!Array.isArray(list)) return [];
  const num = (x, lo, hi, dflt) => (Number.isFinite(x) ? clamp(x, lo, hi) : dflt);
  const out = [];
  for (const n of list.slice(0, maxNotes)) {
    if (!n || !Number.isInteger(n.step) || n.step < 0 || n.step >= 64 || !(n.dur > 0)) continue;
    const note = { step: n.step, dur: num(n.dur, 0.25, 64, 1), vel: num(n.vel, 0, 1, 0.7) };
    if (Number.isFinite(n.nudge)) note.nudge = clamp(n.nudge, -MAX_NUDGE, MAX_NUDGE);
    if (Number.isFinite(n.sweep)) note.sweep = clamp(Math.round(n.sweep), 1, 64); // transitions.js build-up
    if (typeof n.drum === 'string') note.drum = n.drum.slice(0, 12);
    else if (Number.isFinite(n.midi)) note.midi = clamp(Math.round(n.midi), 0, 127);
    else if (Array.isArray(n.midis) && n.midis.length && n.midis.length <= 8 && n.midis.every(Number.isFinite)) {
      note.midis = n.midis.map((m) => clamp(Math.round(m), 0, 127));
      if (Array.isArray(n.offsets) && n.offsets.length === note.midis.length && n.offsets.every(Number.isFinite))
        note.offsets = n.offsets.map((o) => clamp(o, 0, MAX_OFFSET));
    } else continue;
    out.push(note);
  }
  return out;
}
