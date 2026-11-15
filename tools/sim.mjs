// A whole band on one engine, in Node, with a fake clock and an audio sink that just collects the
// notes. Used by `npm run qa` (tools/qa.mjs) and by tests that want app-like numbers.
//
// Everything is deterministic: the structure comes from the seed, every agent samples from
// randomFor(rng, role) exactly as `?rng=` does in the browser, and the clock is simulated.

import { structureFromSeed, randomFor } from '../src/seed.js';
import { createLibrary, ROLES } from '../src/loops.js';
import { PACK_LOOPS } from '../src/packs.js';
import { SONGS } from '../src/songs/index.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';
import { DEFAULT_DIRECTIVE } from '../src/decide/directive.js';

const packLibrary = () => createLibrary({ packs: PACK_LOOPS });

// The library the app would use for this structure (main.js: libraryFor).
export function libraryFor(structure) {
  if (structure.song) return createLibrary({ packs: SONGS[structure.song.id].loops, builtins: false });
  return packLibrary();
}

// Returns { structure, parts: [{ phrase, role, part }], played: [{ role, note, when }] }.
// `parts` holds what each agent composed (one entry per phrase and role, in compose order).
export function simulateBand({ seed = 'durhack', rng = 'qa', phrases = 40, getDirective = null, engineOptions = {}, agentOptions = {} } = {}) {
  const structure = structureFromSeed(seed);
  const library = libraryFor(structure);
  let t = 0;
  const parts = [];
  const played = [];
  const engine = new Engine({
    agents: ROLES.map((r) => new Agent(r, library, randomFor(rng, r), agentOptions)),
    now: () => t,
    audio: { play: (role, note, when) => played.push({ role, note, when }) },
    onEvent: (ev) => ev.type === 'part' && parts.push({ phrase: ev.phrase, role: ev.role, part: ev.part }),
    getDirective: getDirective || (() => DEFAULT_DIRECTIVE),
    ...engineOptions,
  });
  engine.start(structure, 0);
  const end = phrases * 64 * stepMs(structure.bpm);
  for (t = 0; t < end; t += 25) engine.tick();
  return { structure, engine, parts: parts.filter((p) => p.phrase < phrases), played };
}

// Per-role series in phrase order: [{ phrase, part }] (one per phrase that was composed).
export function byRole(parts) {
  const out = Object.fromEntries(ROLES.map((r) => [r, []]));
  for (const p of parts) out[p.role]?.push(p);
  for (const r of ROLES) out[r].sort((a, b) => a.phrase - b.phrase);
  return out;
}

// How often something changes between consecutive phrases. Only pairs where the part plays in
// both phrases count (a part coming in or resting is not a "change of loop").
export function changes(series, key) {
  let changed = 0, pairs = 0;
  for (let i = 1; i < series.length; i++) {
    const a = key(series[i - 1].part), b = key(series[i].part);
    if (a == null || b == null || series[i].phrase !== series[i - 1].phrase + 1) continue;
    pairs++;
    if (a !== b) changed++;
  }
  return { changed, pairs };
}

export const loopOf = (part) => (part.notes.length ? part.loop?.id ?? null : null);
export const voiceOf = (part) => (part.notes.length ? part.d?.voice ?? null : null);
export const styleOf = (part) => (part.notes.length ? part.d?.style ?? null : null);

export function fitStats(series) {
  const playing = series.filter((x) => x.part.notes.length && x.part.fit?.terms);
  const total = playing.reduce((a, x) => a + x.part.fit.total, 0) / (playing.length || 1);
  const terms = {};
  for (const x of playing) for (const [k, v] of Object.entries(x.part.fit.terms)) (terms[k] ||= []).push(v);
  for (const k of Object.keys(terms)) terms[k] = terms[k].reduce((a, b) => a + b, 0) / terms[k].length;
  return { total, terms, n: playing.length };
}
