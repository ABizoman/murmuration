// Round 2 (after the handoff), step 2: three extra parts — pad, arp, perc — each claimable by its
// own device, coming in section by section.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeTone, routes, nodes, triggers } from './fake-tone.mjs';
import { createLibrary, ROLES, CORE_ROLES, kindOf } from '../src/loops.js';
import { VOICES } from '../src/voices.js';
import { nextClaim, rolesFor } from '../src/swarm/roles.js';
import { POP_FORM } from '../src/form.js';
import { renderPhrase } from '../src/render.js';
import { structureFromSeed } from '../src/seed.js';
import { MIX, DRUM_STRIP } from '../src/mix.js';
import { simulateBand, byRole } from '../tools/sim.mjs';

test('seven parts: the core band plus pad, arp and perc, each of a kind the renderer knows', () => {
  assert.deepEqual(ROLES, ['drums', 'bass', 'chords', 'melody', 'pad', 'arp', 'perc']);
  assert.deepEqual(CORE_ROLES, ['drums', 'bass', 'chords', 'melody']);
  assert.equal(kindOf('pad'), 'chords');
  assert.equal(kindOf('arp'), 'melody');
  assert.equal(kindOf('perc'), 'drums');
  for (const r of ROLES) assert.ok(VOICES[r]?.length, `${r} has instruments`);
});

test('devices claim the core band first, then the extra layers; one device still plays everything', () => {
  const claims = [];
  for (const [i, id] of ['a', 'b', 'c', 'd', 'e', 'f', 'g'].entries()) claims.push({ id, role: nextClaim(id, claims), ts: i });
  assert.deepEqual(claims.map((c) => c.role), ['chords', 'drums', 'bass', 'melody', 'pad', 'arp', 'perc']);
  assert.equal(rolesFor('solo', [{ id: 'solo', role: 'chords', ts: 0 }], ['solo']).size, 7);
  // four devices: the extra layers are covered by them, nobody's part is left silent
  const four = claims.slice(0, 4);
  const covered = new Set(['a', 'b', 'c', 'd'].flatMap((id) => [...rolesFor(id, four, ['a', 'b', 'c', 'd'])]));
  assert.equal(covered.size, 7);
});

test('the form brings the layers in: pad from the verse, arp and perc build into the chorus, only the pad in the breakdown', () => {
  const at = (name) => POP_FORM.find((s) => s.name === name).plan;
  assert.equal(at('intro').pad, 'out');
  assert.notEqual(at('verse').pad, 'out');
  assert.equal(at('verse').arp, 'out');
  assert.equal(at('pre').arp, 'light');
  assert.equal(at('chorus').arp, 'full');
  assert.equal(at('chorus').perc, 'full');
  assert.equal(at('breakdown').arp, 'out');
  assert.equal(at('breakdown').perc, 'out');
  assert.notEqual(at('breakdown').pad, 'out');
});

test('a pad never holds a chord into the next bar (it would clash with the chord change)', () => {
  const lib = createLibrary();
  const s = structureFromSeed('padbars');
  for (const l of lib.loops.filter((x) => x.role === 'pad')) {
    for (const phrase of [1, 2, 4]) {
      for (const n of renderPhrase(l, { structure: s, phrase }).notes) assert.ok((n.step % 16) + n.dur <= 16, `${l.id}: step ${n.step} dur ${n.dur}`);
    }
  }
  for (const l of lib.loops.filter((x) => x.role === 'perc')) for (const e of l.events) assert.ok(DRUM_STRIP[e.drum], `${l.id}: ${e.drum} has a route`);
});

test('the mix: the pad and the arp have their own strips; perc goes to the hats', () => {
  assert.equal(MIX.strips.pad.bus, 'chords', 'the pad pumps with the chords');
  assert.ok(MIX.strips.pad.hall > MIX.strips.chords.hall, 'and sits further back');
  assert.ok(MIX.strips.arp.delay > MIX.strips.melody.delay, 'the arp echoes more than the melody');
  assert.ok(MIX.strips.arp.pan !== 0);
  assert.equal(DRUM_STRIP.shaker, 'hats');
  assert.equal(DRUM_STRIP.tamb, 'hats');
});

test('audio: each part gets its own synth instance into its own strip; the shaker reaches the hats', async (t) => {
  globalThis.window = { Tone: makeFakeTone() };
  const { createAudio } = await import(`../src/audio.js?${Math.random()}`);
  const audio = await createAudio({ onStatus: () => {}, lite: false });
  t.after(() => audio.dispose());
  const play = (role, n, voice) => {
    const before = triggers.length;
    audio.play(role, { step: 0, dur: 4, vel: 0.8, ...n }, performance.timeOrigin + performance.now() + 500, 500, voice, 150);
    return triggers.slice(before);
  };
  const chordsPad = play('chords', { midis: [60, 64, 67] }, 'synth-pad')[0].node;
  const padPad = play('pad', { midis: [64, 67, 71] }, 'pad-warm')[0].node;
  assert.notEqual(chordsPad, padPad, 'two instances of the pad patch');
  assert.ok(routes(padPad).every((p) => p.includes('Filter(250 highpass)')), routes(padPad).join('\n'));
  assert.ok(routes(chordsPad).every((p) => p.includes('Filter(180 highpass)')));
  const arp = play('arp', { midi: 67 }, 'arp-pluck')[0].node;
  assert.ok(routes(arp).every((p) => p.includes('Filter(300 highpass)') && p.includes('Panner(0.25)')));
  const shaker = play('perc', { drum: 'shaker' }, 'perc-shaker');
  assert.equal(shaker.length, 1);
  assert.ok(routes(shaker[0].node).every((p) => p.includes('Panner(0.15)')), 'through the hats strip');
  const tamb = play('perc', { drum: 'tamb' }, 'perc-shaker')[0].node;
  assert.notEqual(tamb, shaker[0].node);
  void nodes;
});

test('seven devices improvising: every layer plays where the form says, and fits', () => {
  const { parts, directive } = simulateBand({ seed: 'layers', rng: 'seven', phrases: 16, devices: 7 });
  const series = byRole(parts);
  for (const r of ['pad', 'arp', 'perc']) {
    for (const { phrase, part } of series[r]) {
      const plan = directive(phrase).plan[r];
      if (plan === 'out') assert.equal(part.notes.length, 0, `${r} should rest in the ${directive(phrase).section}`);
    }
    assert.ok(series[r].some((x) => x.part.notes.length), `${r} plays somewhere`);
  }
  // the arp hears the melody's phrase before it decides
  const arp = series.arp.filter((x) => x.part.notes.length && x.phrase > 0);
  assert.ok(arp.length && arp.every((x) => x.part.fresh.includes('melody')), 'the arp decides after the melody');
});

test('Murmur gives the new parts their own lines', async () => {
  const { SONGS } = await import('../src/songs/index.js');
  const roles = new Set(SONGS.murmur.loops.map((l) => l.role));
  for (const r of ['pad', 'arp', 'perc']) assert.ok(roles.has(r), `Murmur has a ${r} part`);
});
