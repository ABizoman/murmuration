// Song registry. Built-in songs are public domain; songs in the gitignored songs-local/ folder are
// registered at startup by main.js (see docs/ADDING_SONGS.md).
import { compileSong } from './format.js';
import mountainKing from './mountain-king.js';
import canon from './canon-in-d.js';
import ode from './ode-to-joy.js';
import murmurPop from './murmur-pop.js';
import odePop from './ode-to-joy-pop.js';

export const SONGS = {};

export function registerSong(def) {
  const song = compileSong(def);
  SONGS[song.id] = song;
  return song;
}

for (const def of [murmurPop, odePop, mountainKing, canon, ode]) registerSong(def);

export const songSeed = (id) => `song:${id}`;
// A trailing "#end" (end after one pass, see seed.js) is not part of the song id.
export const songFromSeed = (seed) => (typeof seed === 'string' && seed.startsWith('song:') ? SONGS[seed.slice(5).replace(/#end$/, '')] || null : null);
