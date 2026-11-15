// Step C (Phase 5) of docs/MUSIC_QUALITY_HANDOFF.md: the form, the plan, hooks, transitions and
// the ending, for the improvising band.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formFromStructure, sectionAt, formDirective, POP_FORM } from '../src/form.js';
import { clampToPlan } from '../src/decide/rules.js';
import { HookBook } from '../src/hooks.js';
import { applyTransitions, endNotes, makeFill, transitionsIn } from '../src/transitions.js';
import { structureFromSeed, parseSeed, withEnd, randomFor, seededRandom } from '../src/seed.js';
import { songFromSeed } from '../src/songs/index.js';
import { sanitiseDirective, DEFAULT_DIRECTIVE } from '../src/decide/directive.js';
import { createLibrary, ROLES } from '../src/loops.js';
import { PACK_LOOPS } from '../src/packs.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';
import { simulateBand, byRole } from '../tools/sim.mjs';

const structure = structureFromSeed('formtest');
const form = formFromStructure(structure);

test('form: the upbeat-pop form, then round from verse2 again; none for songs', () => {
  assert.equal(formFromStructure(structureFromSeed('song:ode-to-joy')), null);
  const names = Array.from({ length: 30 }, (_, p) => sectionAt(form, p).section.name);
  assert.deepEqual(names.slice(0, 14), ['intro', 'verse', 'verse', 'pre', 'chorus', 'chorus', 'verse2', 'verse2', 'chorus', 'chorus', 'breakdown', 'finalChorus', 'finalChorus', 'outro']);
  assert.deepEqual(names.slice(14, 22), ['verse2', 'verse2', 'chorus', 'chorus', 'breakdown', 'finalChorus', 'finalChorus', 'outro']);
  assert.equal(sectionAt(form, 14).pass, 1);
  assert.equal(sectionAt(form, 22).pass, 2);
  assert.equal(sectionAt(form, 22).section.name, 'verse2');
  const at = sectionAt(form, 5);
  assert.ok(at.isLastPhrase && !at.isFirstPhrase && at.phraseInSection === 1);
  assert.deepEqual(sectionAt(form, 117), sectionAt(form, 117), 'pure');
  assert.equal(sectionAt(form, -1), null);
  assert.equal(form.length, POP_FORM.reduce((a, s) => a + s.phrases, 0));
});

test('form: with "end after one pass", one coda phrase after the outro, then nothing', () => {
  const f = formFromStructure(structureFromSeed('formtest#end'));
  assert.equal(sectionAt(f, 13).section.name, 'outro');
  assert.equal(sectionAt(f, 14).section.name, 'end');
  assert.equal(sectionAt(f, 14).ended, false);
  assert.equal(sectionAt(f, 15).ended, true);
  assert.equal(formDirective(f, 14).end, true);
  assert.equal(formDirective(f, 13).nextTransitionIn.includes('fill'), false, 'no fill into the coda');
});

test('seed: "#end" is carried in the seed and changes nothing else', () => {
  assert.deepEqual(parseSeed('durhack#end'), { base: 'durhack', end: true, style: null });
  assert.deepEqual(parseSeed('durhack#pop#end'), { base: 'durhack', end: true, style: 'pop' });
  assert.equal(withEnd('durhack#pop', true), 'durhack#pop#end');
  assert.equal(withEnd('durhack', true), 'durhack#end');
  assert.equal(withEnd('durhack#end', false), 'durhack');
  const a = structureFromSeed('durhack'), b = structureFromSeed('durhack#end');
  assert.deepEqual({ ...b, end: undefined }, { ...a, end: undefined });
  assert.equal(b.end, true);
  assert.equal(a.end, undefined);
  assert.equal(songFromSeed('song:ode-to-joy#end')?.id, 'ode-to-joy');
});

test('formDirective: the form leads, the director nudges, never against the plan', () => {
  const chorus = formDirective(form, 4, DEFAULT_DIRECTIVE);
  assert.equal(chorus.section, 'chorus');
  assert.equal(chorus.hook, true);
  assert.equal(chorus.energy, 0.9);
  assert.deepEqual(chorus.plan, { drums: 'full', bass: 'full', chords: 'full', melody: 'full' });
  assert.deepEqual(chorus.transitionIn, ['fill', 'crash', 'riser']);
  // director energy nudges by 0.4 x (energy - 0.5)
  assert.ok(Math.abs(formDirective(form, 1, sanitiseDirective({ energy: 1 })).energy - 0.65) < 1e-9);
  assert.ok(Math.abs(formDirective(form, 1, sanitiseDirective({ energy: 0 })).energy - 0.25) < 1e-9);
  // feature / pair a role the plan sits out: dropped. drop only a 'normal' role, never a 'full' one.
  const intro = formDirective(form, 0, sanitiseDirective({ energy: 0.5, feature: 'melody', pair: { who: 'bass', mode: 'echo', whom: 'drums' } }));
  assert.equal(intro.feature, null);
  assert.equal(intro.pair, null);
  assert.equal(formDirective(form, 1, sanitiseDirective({ energy: 0.5, drop: 'drums' })).drop, 'drums');
  assert.equal(formDirective(form, 4, sanitiseDirective({ energy: 0.5, drop: 'drums' })).drop, null);
  assert.equal(formDirective(form, 1, sanitiseDirective({ energy: 0.5, note: 'go' })).note, 'go');
  // the last phrase of the pre knows a chorus is next
  const pre = formDirective(form, 3);
  assert.deepEqual(pre.nextTransitionIn, ['fill', 'crash', 'riser']);
  assert.equal(pre.nextSection, 'chorus');
  assert.deepEqual(formDirective(form, 4).nextTransitionIn, [], 'not the last phrase of the chorus');
  assert.equal(formDirective(form, 10).dropLastBar, true, 'the breakdown');
});

test('plan: out rests, light stays sparse, normal is never busy when calm, full is never thin', () => {
  const lvl = { 0: 0.01, 1: 0.5, 2: 1, 3: 0.7 };
  assert.deepEqual(clampToPlan(lvl, 'out', 0.5), { 0: 1 });
  const light = clampToPlan(lvl, 'light', 0.5);
  assert.ok(!light[2] && !light[3] && light[1] > 0 && light[0] <= 0.02);
  assert.ok(!clampToPlan(lvl, 'normal', 0.45)[3]);
  assert.ok(clampToPlan(lvl, 'normal', 0.7)[3] > 0);
  const full = clampToPlan(lvl, 'full', 0.9);
  assert.ok(!full[0] && !full[1] && full[2] > 0);
  assert.ok(Object.keys(clampToPlan({ 0: 1 }, 'full', 0.9)).length > 0, 'never left with no options');
});

test('HookBook: earliest phrase wins, ties go to the lowest device id, junk is ignored', () => {
  const b = new HookBook();
  assert.ok(b.record({ role: 'melody', loopId: 'a', register: 0, phrase: 8, by: 'zz' }));
  assert.ok(!b.record({ role: 'melody', loopId: 'b', register: 0, phrase: 12, by: 'aa' }), 'later loses');
  assert.ok(b.record({ role: 'melody', loopId: 'c', register: 1, phrase: 8, by: 'mm' }), 'same phrase, lower id wins');
  assert.equal(b.get('melody').loopId, 'c');
  assert.ok(b.record({ role: 'melody', loopId: 'd', register: 0, phrase: 4, by: 'zz' }), 'earlier wins');
  assert.equal(b.get('melody').loopId, 'd');
  assert.ok(!b.record({ role: 'drums', loopId: 'x', phrase: 1 }), 'drums have no hook');
  assert.ok(!b.record({ role: 'bass', loopId: 5, phrase: 1 }));
  assert.ok(!b.record(null));
  assert.equal(b.all().length, 1);
});

test('transitions: fill, crash, riser and the breakdown drop land where the form says', () => {
  const groove = [];
  for (let s = 0; s < 64; s += 2) groove.push({ step: s, dur: 1, vel: 0.7, drum: 'hat' });
  for (const s of [0, 16, 32, 48, 56]) groove.push({ step: s, dur: 1, vel: 0.9, drum: 'kick' });
  for (const s of [4, 12, 20, 28, 36, 44, 52, 60]) groove.push({ step: s, dur: 1, vel: 0.9, drum: 'snare' });
  const pre = formDirective(form, 3);
  const into = applyTransitions(groove, { role: 'drums', dir: pre, structure, phrase: 3 });
  const tr = transitionsIn(into);
  assert.ok(tr.fill && tr.riser && !tr.crash);
  assert.deepEqual(into.filter((n) => n.step < 48), groove.filter((n) => n.step < 48).sort((a, b) => a.step - b.step), 'bars 1-3 untouched');
  const chorus = applyTransitions(groove, { role: 'drums', dir: formDirective(form, 4), structure, phrase: 4 });
  assert.ok(transitionsIn(chorus).crash);
  assert.ok(!chorus.some((n) => n.step === 0 && n.drum === 'hat'), 'the hat under the crash goes');
  assert.ok(!transitionsIn(chorus).fill && !transitionsIn(chorus).riser);
  const verse = applyTransitions(groove, { role: 'drums', dir: formDirective(form, 1), structure, phrase: 1 });
  assert.deepEqual(verse, [...groove].sort((a, b) => a.step - b.step), 'nothing mid-section');
  // a riser even when the drums sit out (the breakdown before the final chorus)
  assert.ok(transitionsIn(applyTransitions([], { role: 'drums', dir: formDirective(form, 10), structure, phrase: 10 })).riser);
  // the breakdown's last bar: the bass stops, notes ringing into it are cut
  const bass = [{ step: 40, dur: 12, vel: 0.8, midi: 40 }, { step: 50, dur: 2, vel: 0.8, midi: 43 }];
  const dropped = applyTransitions(bass, { role: 'bass', dir: formDirective(form, 10), structure, phrase: 10 });
  assert.deepEqual(dropped, [{ step: 40, dur: 8, vel: 0.8, midi: 40 }]);
  // deterministic
  assert.deepEqual(applyTransitions(groove, { role: 'drums', dir: pre, structure, phrase: 3 }), into);
  const fill = makeFill(8, seededRandom('f'));
  assert.ok(fill[fill.length - 1].vel > fill[1].vel, 'a fill gets louder');
});

test('the coda: one note on the downbeat from everyone, in the key', () => {
  const s = { key: 'A', mode: 'major' };
  assert.deepEqual(endNotes('drums', s).map((n) => n.drum).sort(), ['crash', 'kick']);
  const chord = endNotes('chords', s)[0];
  assert.equal(chord.step, 0);
  assert.deepEqual(chord.midis.map((m) => m % 12), [9, 1, 4, 9], 'A major');
  assert.equal(endNotes('bass', s)[0].midi % 12, 9);
  assert.equal(endNotes('chords', { key: 'A', mode: 'minor' })[0].midis[1] % 12, 0, 'A minor has C');
  for (const r of ROLES) for (const n of endNotes(r, s)) assert.equal(n.step, 0);
});

test('a run: the hook comes back in every chorus, fills, crashes and risers only at the seams', () => {
  for (const seed of ['durhack', 'pop3']) {
    const { parts, directive } = simulateBand({ seed, rng: `c-${seed}`, phrases: 30 });
    const series = byRole(parts);
    const at = (r, p) => series[r].find((x) => x.phrase === p)?.part;
    const firstHook = [...Array(30).keys()].find((p) => directive(p).hook);
    let later = 0, hooked = 0;
    for (let p = firstHook + 1; p < 30; p++) {
      if (!directive(p).hook) continue;
      later++;
      if (/the hook/.test(at('melody', p).why)) hooked++;
    }
    assert.ok(hooked / later >= 0.95, `${seed}: hook in ${hooked}/${later} chorus phrases`);
    for (let p = 0; p < 30; p++) {
      const d = directive(p);
      const tr = transitionsIn(at('drums', p)?.notes || []);
      assert.equal(tr.crash, d.transitionIn.includes('crash'), `${seed} crash at ${p}`);
      assert.equal(tr.riser, d.nextTransitionIn.includes('riser'), `${seed} riser at ${p}`);
      if (d.nextTransitionIn.includes('fill') && at('drums', p)?.notes.some((n) => n.step < 48)) assert.ok(tr.fill, `${seed} fill at ${p}`);
      if (d.plan.melody === 'out') assert.equal(at('melody', p).notes.length, 0, `${seed} melody should sit out at ${p}`);
      if (d.plan.drums === 'full') assert.ok(at('drums', p).d.level >= 2);
    }
  }
});

test('the end: the coda plays, then the engine stops and says so', () => {
  const { parts, events, engine } = simulateBand({ seed: 'durhack#end', rng: 'end', phrases: 18 });
  const coda = parts.filter((x) => x.phrase === 14);
  assert.equal(coda.length, 4);
  for (const { part } of coda) {
    assert.ok(part.notes.length > 0 && part.notes.every((n) => n.step === 0), part.why);
    assert.equal(part.why, 'the last chord');
  }
  assert.ok(!parts.some((x) => x.phrase > 14), 'nothing is composed after the coda');
  assert.deepEqual(events.filter((e) => e.type === 'end').map((e) => e.phrase), [14]);
  assert.equal(engine.startMs, null, 'stopped');
});

// Two devices, in memory: A plays drums and melody, B bass and chords. Parts and hooks are gossiped
// both ways; then A drops out and B takes over the melody.
test('two devices agree on hooks and transitions, and the hook survives a takeover', () => {
  const s = structureFromSeed('twodev');
  const f = formFromStructure(s);
  const lib = createLibrary({ packs: PACK_LOOPS });
  let t = 0;
  const mk = (id) => new Engine({
    agents: ROLES.map((r) => new Agent(r, lib, randomFor(`two-${id}`, r))),
    now: () => t, audio: { play() {} }, id,
    getDirective: (p) => formDirective(f, p),
    onEvent: (ev) => {
      const other = id === 'a' ? B : A;
      if (ev.type === 'part') { log.push({ id, ...ev }); other.setRemotePart(ev.phrase, ev.role, { ...ev.part, by: id }); }
      if (ev.type === 'hook') other.hooks.record(ev.hook);
    },
  });
  const log = [];
  const A = mk('a'), B = mk('b');
  A.myRoles = new Set(['drums', 'melody']);
  B.myRoles = new Set(['bass', 'chords']);
  A.start(s, 0);
  B.start(s, 0);
  const sMs = stepMs(s.bpm);
  for (const end = 9 * 64 * sMs; t < end; t += 25) { A.tick(); B.tick(); }
  assert.ok(A.hooks.get('melody') && B.hooks.get('melody'), 'both know the melody hook');
  assert.deepEqual(B.hooks.get('melody'), A.hooks.get('melody'));
  assert.deepEqual(A.hooks.get('bass'), B.hooks.get('bass'));
  // A leaves; B takes over the melody (and the drums)
  B.myRoles = new Set(ROLES);
  for (const end = 13 * 64 * sMs; t < end; t += 25) B.tick();
  const melody = (p) => log.find((x) => x.id === 'b' && x.role === 'melody' && x.phrase === p)?.part;
  assert.ok(!melody(9), 'phrase 9 was already composed by A');
  for (const p of [11, 12]) assert.match(melody(p)?.why || '', /the hook/, `the final chorus (phrase ${p}) plays A's hook on B`);
  assert.equal(melody(11).loop.id, A.hooks.get('melody').loopId);
  const drums12 = log.find((x) => x.id === 'b' && x.role === 'drums' && x.phrase === 11)?.part;
  assert.ok(transitionsIn(drums12.notes).crash, 'and the final chorus still starts with a crash');
});
