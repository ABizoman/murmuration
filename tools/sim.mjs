// A whole band in Node, with a fake clock and an audio sink that just collects the notes. Used by
// `npm run qa` (tools/qa.mjs) and by tests that want app-like numbers.
//
//   devices: 1  one engine plays all four parts (a laptop on its own)
//   devices: 4  (any number > 1) one engine per part, gossiping parts and hooks to each other after
//               `latencyMs` (the demo: a phone per part). This is where staggered decisions
//               (Phase 6) matter: on one engine the later parts already hear the earlier ones.
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
import { formFromStructure, formDirective } from '../src/form.js';
import { fitScore } from '../src/decide/fit.js';
import { summarise } from '../src/decide/context.js';

const packLibrary = () => createLibrary({ packs: PACK_LOOPS });

// The library the app would use for this structure (main.js: libraryFor).
export function libraryFor(structure) {
  if (structure.song) return createLibrary({ packs: SONGS[structure.song.id].loops, builtins: false });
  return packLibrary();
}

// Returns { structure, form, directive, engine(s), events, parts: [{ phrase, role, part }], played }.
// `parts` holds what each part's owner composed (one entry per phrase and role).
// setup(agentsByRole): optional, to pin agents before the song starts (as a typed instruction does).
export function simulateBand({ seed = 'durhack', rng = 'qa', phrases = 40, getDirective = null, engineOptions = {}, agentOptions = {}, devices = 1, latencyMs = 60, setup = null } = {}) {
  const structure = structureFromSeed(seed);
  const library = libraryFor(structure);
  // As main.js does: the form leads (improvising), the director's directive nudges (default here).
  const form = formFromStructure(structure);
  const directive = getDirective || (form ? (p) => formDirective(form, p, DEFAULT_DIRECTIVE) : () => DEFAULT_DIRECTIVE);
  let t = 0;
  const parts = [];
  const played = [];
  const events = [];
  const queue = []; // gossip in flight: { at, to, fn }
  const groups = devices > 1 ? ROLES.map((r) => [r]) : [ROLES];
  const engines = groups.map((mine, i) => {
    const id = devices > 1 ? `dev-${mine[0]}` : 'local';
    const e = new Engine({
      agents: (() => {
        const list = ROLES.map((r) => new Agent(r, library, randomFor(rng, r), agentOptions));
        setup?.(Object.fromEntries(list.map((a) => [a.role, a])));
        return list;
      })(),
      now: () => t,
      id,
      audio: { play: (role, note, when) => played.push({ role, note, when, device: id }) },
      onEvent: (ev) => {
        if (ev.type === 'part') {
          parts.push({ phrase: ev.phrase, role: ev.role, part: ev.part });
          for (const other of engines) if (other !== e) queue.push({ at: t + latencyMs, fn: () => other.setRemotePart(ev.phrase, ev.role, { ...ev.part, by: id }) });
        } else {
          events.push({ ...ev, device: id });
          if (ev.type === 'hook') for (const other of engines) if (other !== e) queue.push({ at: t + latencyMs, fn: () => other.hooks.record(ev.hook) });
        }
      },
      getDirective: directive,
      ...engineOptions,
    });
    e.myRoles = new Set(mine);
    return e;
  });
  for (const e of engines) e.start(structure, 0);
  const end = phrases * 64 * stepMs(structure.bpm);
  for (t = 0; t < end; t += 25) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= t) { queue[i].fn(); queue.splice(i, 1); }
    for (const e of engines) e.tick();
  }
  // With one device every event is reported once; with four, the end is reported by each.
  const seen = new Set();
  const uniq = events.filter((ev) => { const k = `${ev.type}|${ev.phrase}|${ev.hook?.role ?? ''}`; if (ev.type === 'part' || !seen.has(k)) { seen.add(k); return true; } return false; });
  return { structure, form, directive, engine: engines[0], engines, events: uniq, parts: parts.filter((p) => p.phrase < phrases), played };
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
  // parts with no fit terms (a coda, a riser on its own) are not judged
  const playing = series.filter((x) => x.part.notes.length && x.part.fit?.terms && Object.keys(x.part.fit.terms).length);
  const total = playing.reduce((a, x) => a + x.part.fit.total, 0) / (playing.length || 1);
  const terms = {};
  for (const x of playing) for (const [k, v] of Object.entries(x.part.fit.terms)) (terms[k] ||= []).push(v);
  for (const k of Object.keys(terms)) terms[k] = terms[k].reduce((a, b) => a + b, 0) / terms[k].length;
  return { total, terms, n: playing.length };
}

// After the fact: how well every part fits what the others *actually* played in the same phrase
// (all peers fresh). Unlike fit-at-decision-time, this is comparable between engine set-ups.
export function ensembleStats(series, { structure, directive }) {
  const out = {};
  const at = (r, p) => series[r].find((x) => x.phrase === p)?.part;
  for (const role of ROLES) {
    const terms = {};
    let total = 0, n = 0;
    for (const { phrase, part } of series[role]) {
      if (!part.notes.length) continue;
      const peers = {};
      for (const r of ROLES) if (r !== role && at(r, phrase)) peers[r] = summarise(at(r, phrase), r, phrase);
      const last = at(role, phrase - 1) ? summarise(at(role, phrase - 1), role, phrase - 1) : null;
      const ctx = { role, phrase, structure, peers, last, history: last ? [last] : [], directive: directive(phrase), hook: !!directive(phrase)?.hook };
      const f = fitScore(part.notes, { role, ctx, d: part.d });
      if (!Object.keys(f.terms).length) continue;
      total += f.total; n++;
      for (const [k, v] of Object.entries(f.terms)) (terms[k] ||= []).push(v);
    }
    for (const k of Object.keys(terms)) terms[k] = terms[k].reduce((a, b) => a + b, 0) / terms[k].length;
    out[role] = { total: n ? total / n : null, terms, n };
  }
  return out;
}

// Share of decisions that heard each other part's same-phrase part.
export function freshStats(series) {
  const out = {};
  for (const role of ROLES) {
    const playing = series[role].filter((x) => Array.isArray(x.part.fresh));
    out[role] = {};
    for (const r of ROLES) if (r !== role) out[role][r] = playing.length ? playing.filter((x) => x.part.fresh.includes(r)).length / playing.length : null;
  }
  return out;
}
