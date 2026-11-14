// Seed -> structure. Only key, mode, tempo and the default chord progression come from the seed.
// Everything else (what each agent plays, how busy it is) is decided by the agents.

import { KEYS } from './theory.js';
import { PACK_PROGRESSIONS } from './packs.js';
import { songFromSeed } from './songs/index.js';

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRandom(...parts) {
  let a = hash(parts.join('|'));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROGRESSIONS = {
  minor: [
    ['i', 'VI', 'III', 'VII'],
    ['i', 'iv', 'VI', 'V'],
    ['i', 'VII', 'VI', 'VII'],
    ['VI', 'VII', 'i', 'i'],
    ['i', 'iv', 'VII', 'III'],
  ],
  major: [
    ['I', 'V', 'vi', 'IV'],
    ['vi', 'IV', 'I', 'V'],
    ['I', 'vi', 'IV', 'V'],
    ['IV', 'I', 'V', 'vi'],
    ['I', 'iii', 'IV', 'V'],
  ],
};

export function structureFromSeed(seed) {
  // "song:<id>" plays a fixed song: its own key, tempo and chords, and the agents build it up.
  const song = songFromSeed(seed);
  if (song) {
    const { id, title, composer, build, voices, react } = song;
    return { seed, key: song.key, mode: song.mode, bpm: song.bpm, progression: song.progression, mood: `${title} (${composer})`, song: { id, title, composer, build, voices, react: !!react } };
  }
  const r = seededRandom(seed, 'structure');
  const mode = r() < 0.6 ? 'minor' : 'major';
  const key = KEYS[Math.floor(r() * 12)];
  const bpm = 78 + Math.floor(r() * 28); // 78-105
  // The built-in progressions plus the mood-tagged ones from free-midi-chords.
  const list = [...PROGRESSIONS[mode].map((chords) => ({ chords, mood: '' })), ...(PACK_PROGRESSIONS[mode] || [])];
  const pick = list[Math.floor(r() * list.length)];
  return { seed, key, mode, bpm, progression: pick.chords, mood: pick.mood };
}
