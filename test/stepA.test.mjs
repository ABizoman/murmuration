// Step A of docs/MUSIC_QUALITY_HANDOFF.md: ?feel=off, the drums keeping their groove, and the QA
// simulation helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, ROLES } from '../src/loops.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';
import { randomFor } from '../src/seed.js';
import { renderPhrase } from '../src/render.js';
import { fitScore, CONTINUITY_TARGET } from '../src/decide/fit.js';
import { summarise } from '../src/decide/context.js';
import { CONTINUITY_BONUS_BY_ROLE } from '../src/decide/select.js';
import { changes, loopOf } from '../tools/sim.mjs';

const lib = createLibrary();
const structure = { seed: 's', key: 'C', mode: 'major', bpm: 100, progression: ['I', 'V', 'vi', 'IV'], swing: 0.05 };

function run({ feel = true, swing = true } = {}) {
  let t = 0;
  const parts = [];
  const played = [];
  const e = new Engine({
    agents: ROLES.map((r) => new Agent(r, lib, randomFor('feel', r), { feel })),
    now: () => t,
    audio: { play: (role, n, when) => played.push({ role, n, when }) },
    onEvent: (ev) => parts.push(ev),
    swing,
  });
  e.start(structure, 0);
  for (const end = 4 * 64 * stepMs(structure.bpm); t < end; t += 25) e.tick();
  return { parts, played };
}

test('?feel=off: no nudges or strums in the notes, and no swing at schedule time', () => {
  const on = run();
  const off = run({ feel: false, swing: false });
  const notes = (r) => r.parts.flatMap((p) => p.part.notes);
  assert.ok(notes(on).some((n) => n.nudge), 'with feel on, notes carry a nudge');
  assert.ok(!notes(off).some((n) => n.nudge || n.offsets), 'with feel off, nothing is humanised');
  // every note lands exactly on its grid step
  const sMs = stepMs(structure.bpm);
  for (const { n, when } of off.played) {
    const inPhrase = ((when % (64 * sMs)) + 64 * sMs) % (64 * sMs);
    assert.ok(Math.abs(inPhrase - n.step * sMs) < 1e-6, `step ${n.step} at ${inPhrase.toFixed(2)} ms`);
  }
  // the same decisions are made either way: only the performance changes
  assert.deepEqual(off.parts.map((p) => p.part.d), on.parts.map((p) => p.part.d));
});

test('continuity: a drummer repeating the groove exactly is right, a melody repeating itself is not', () => {
  const loop = lib.loops.find((l) => l.id === 'drums/four/medium');
  const { notes } = renderPhrase(loop, { structure, phrase: 5 });
  const last = summarise({ notes, d: { level: 2, style: 'four' } }, 'drums', 4);
  const ctx = { role: 'drums', phrase: 5, structure, peers: {}, last, history: [last] };
  assert.equal(fitScore(notes, { role: 'drums', ctx, d: { level: 2 } }).terms.continuity, 1);
  assert.equal(CONTINUITY_TARGET.drums[1], 1);
  assert.ok(CONTINUITY_TARGET.melody[1] < 1, 'the melody should vary');
  assert.ok(CONTINUITY_BONUS_BY_ROLE.drums > CONTINUITY_BONUS_BY_ROLE.bass && CONTINUITY_BONUS_BY_ROLE.bass > CONTINUITY_BONUS_BY_ROLE.melody);
});

test('qa helper: loop changes count only phrases where the part plays in both', () => {
  const s = (ids) => ids.map((id, phrase) => ({ phrase, part: { notes: id ? [{}] : [], loop: id ? { id } : null } }));
  assert.deepEqual(changes(s(['a', 'a', 'b', null, 'b', 'c']), loopOf), { changed: 2, pairs: 3 });
});

test('both pages have every element id that src/main.js looks up', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // $('id') calls; the optional ones are written $('id')?.
  const ids = [...new Set([...main.matchAll(/\$\('([A-Za-z0-9_-]+)'\)(\?)?/g)].filter((m) => !m[2]).map((m) => m[1]))];
  assert.ok(ids.length > 15);
  for (const page of ['index.html', 'classic.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const missing = ids.filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `${page} is missing ${missing.join(', ')}`);
  }
});
