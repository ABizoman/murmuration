// Loop packs built by tools/build-packs.mjs (sources and licences in CREDITS.md).
// Stored compactly; expanded here into the loop format of loops.js.

import groove from './packs/groove.js';
import pop909 from './packs/pop909.js';
import drolez from './packs/drolez.js';
export { default as PACK_PROGRESSIONS } from './packs/progressions.js';

const DRUM = { k: 'kick', s: 'snare', h: 'hat', o: 'ohat', 1: 'tom1', 2: 'tom2', 3: 'tom3' };

function expand(l) {
  const { e, ...rest } = l;
  let events;
  if (l.role === 'drums') events = e.map(([bar, step, code, vel]) => ({ bar, step, dur: 1, drum: DRUM[code], vel }));
  else if (l.role === 'chords') events = e.map(([bar, step, dur, vel]) => ({ bar, step, dur, vel }));
  else events = e.map(([bar, step, dur, deg, oct, vel]) => ({ bar, step, dur, deg, oct, vel }));
  return { ...rest, events };
}

export const PACK_LOOPS = [...groove, ...pop909, ...drolez].map(expand);
