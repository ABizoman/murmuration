// Phase 1 of docs/MUSIC_QUALITY_PLAN.md: feel (swing, timing, dynamics).
// The important property is determinism: the groove is baked into the note data, so a device that
// takes a part over or doubles it plays the same performance instead of flamming.
import test from 'node:test';
import assert from 'node:assert/strict';
import { humanise, swingOffset, sanitiseNotes, MAX_NUDGE, MAX_OFFSET, MAX_SWING } from '../src/feel.js';
import { createLibrary, ROLES } from '../src/loops.js';
import { renderPhrase } from '../src/render.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';
import { DEFAULT_VOICE } from '../src/voices.js';
import { structureFromSeed } from '../src/seed.js';

const lib = createLibrary();
const structure = { seed: 'durhack', key: 'A', mode: 'minor', bpm: 100, progression: ['i', 'VI', 'III', 'VII'], swing: 0.04 };
const H = (notes, opts = {}) => humanise(notes, { role: 'drums', phrase: 0, seed: 'durhack', bpm: 100, ...opts });
const nudgeOf = (n) => n.nudge ?? 0;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('swing: only the odd 16ths move, and every device computes the same push', () => {
  for (const step of [0, 2, 8, 62]) assert.equal(swingOffset(step, 0.06), 0);
  for (const step of [1, 3, 9, 63]) assert.equal(swingOffset(step, 0.06), 0.06);
  assert.equal(swingOffset(1), 0, 'no swing in the structure: dead straight, as today');
  assert.equal(swingOffset(1, undefined), 0);
  assert.equal(swingOffset(1, 5), MAX_SWING, 'a silly value is clamped, not trusted');
  assert.equal(swingOffset(1, -1), 0);
  // Songs decide for themselves; improvising stays in the upbeat-pop range.
  assert.equal(structureFromSeed('song:ode-to-joy').swing, 0);
});

test('humanise: deterministic, bounded, and it never moves a note off the grid', () => {
  for (const role of ROLES) {
    const loop = lib.loops.find((l) => l.role === role && l.density === 'busy');
    const base = renderPhrase(loop, { structure, phrase: 3 }).notes;
    const before = JSON.stringify(base);
    const opts = { role, phrase: 3, seed: 'durhack', voice: DEFAULT_VOICE[role], bpm: 100 };
    const a = humanise(base, opts);
    assert.deepEqual(humanise(base, opts), a, `${role}: same inputs, same performance`);
    assert.equal(JSON.stringify(base), before, `${role}: the rendered notes are not mutated`);
    assert.notDeepEqual(humanise(base, { ...opts, phrase: 4 }), a, `${role}: a new phrase breathes differently`);
    assert.notDeepEqual(humanise(base, { ...opts, seed: 'other' }), a, `${role}: a new song breathes differently`);
    assert.deepEqual(a.map((n) => n.step), base.map((n) => n.step), `${role}: steps are untouched`);
    for (const n of a) {
      assert.ok(Number.isInteger(n.step) && n.step >= 0 && n.step < 64);
      assert.ok(Math.abs(nudgeOf(n)) <= MAX_NUDGE, `${role}: nudge ${n.nudge}`);
      assert.ok(n.vel >= 0.25 && n.vel <= 1, `${role}: vel ${n.vel}`);
      assert.ok(n.dur > 0, `${role}: dur ${n.dur}`);
      if (n.offsets) {
        assert.equal(n.offsets.length, n.midis.length, `${role}: one offset per pitch`);
        for (const o of n.offsets) assert.ok(o >= 0 && o <= MAX_OFFSET, `${role}: offset ${o}`);
      }
    }
    assert.ok(a.some((n) => nudgeOf(n) !== 0) || role === 'chords' || role === 'pad', `${role}: something actually moved`);
  }
});

test('drums: laid-back snare, hats push and pull, ghost notes stay quiet', () => {
  const notes = [
    { step: 0, dur: 1, vel: 0.85, drum: 'kick' }, { step: 4, dur: 1, vel: 0.85, drum: 'snare' },
    { step: 8, dur: 1, vel: 0.85, drum: 'kick' }, { step: 12, dur: 1, vel: 0.85, drum: 'snare' },
    ...Array.from({ length: 16 }, (_, s) => ({ step: s, dur: 1, vel: s % 2 ? 0.45 : 0.85, drum: 'hat' })),
  ];
  const out = H(notes, { role: 'drums', seed: 'g1' });
  const by = (drum) => out.filter((n) => n.drum === drum);
  for (const n of by('kick')) assert.ok(Math.abs(nudgeOf(n)) <= 0.01, `kick ${n.nudge}`);
  for (const n of by('snare')) assert.ok(nudgeOf(n) >= 0.02 && nudgeOf(n) <= 0.05, `snare ${n.nudge}`);
  const hats = by('hat');
  for (const [i, n] of hats.entries()) {
    assert.ok(Math.abs(nudgeOf(n)) <= 0.03, `hat ${n.nudge}`);
    assert.ok(i % 2 ? nudgeOf(n) >= 0 : nudgeOf(n) <= 0, `hat ${i} pushes and pulls in turn`);
  }
  // 16 hats in the bar: the 0.9 / 0.55 alternation, whatever the loop wrote
  assert.ok(mean(hats.filter((n) => n.step % 2 === 0).map((n) => n.vel)) > 0.84);
  assert.ok(mean(hats.filter((n) => n.step % 2 === 1).map((n) => n.vel)) < 0.62);

  // Eighth-note hats instead: the loop's own ghost note is left quiet rather than boosted.
  const eighths = H([...Array.from({ length: 8 }, (_, k) => ({ step: k * 2, dur: 1, vel: k === 3 ? 0.3 : 0.8, drum: 'hat' }))], { seed: 'g2' });
  assert.ok(eighths[3].vel < 0.6, `ghost ${eighths[3].vel}`);
  assert.ok(mean(eighths.filter((_, k) => k !== 3).map((n) => n.vel)) > 0.7);
});

test('drums: a fill crescendos into the next downbeat', () => {
  const fill = Array.from({ length: 8 }, (_, k) => ({ step: 48 + k * 2, dur: 1, vel: 0.6, drum: 'snare' }));
  const out = H(fill, { seed: 'g3' });
  assert.ok(mean(out.slice(4).map((n) => n.vel)) > mean(out.slice(0, 4).map((n) => n.vel)) + 0.05);
  // A bar that is not a fill keeps its level flat.
  const plain = H([{ step: 4, dur: 1, vel: 0.6, drum: 'snare' }, { step: 12, dur: 1, vel: 0.6, drum: 'snare' }], { seed: 'g3' });
  assert.ok(Math.abs(plain[1].vel - plain[0].vel) < 0.15);
});

test('bass: sits just behind the kick, beat 1 is louder, notes end before the next one', () => {
  const out = H([{ step: 0, dur: 8, vel: 0.8, midi: 40 }, { step: 8, dur: 8, vel: 0.7, midi: 43 }, { step: 16, dur: 16, vel: 0.7, midi: 40 }],
    { role: 'bass', seed: 'b1' });
  for (const n of out) assert.ok(nudgeOf(n) >= 0 && nudgeOf(n) <= 0.02, `bass ${n.nudge}: never early`);
  assert.equal(out[0].dur, 7.5, 'ends a 32nd before the next bass note');
  assert.equal(out[1].dur, 7.5);
  assert.equal(out[2].dur, 16, 'the last note of the phrase keeps its length');
  assert.ok(out[0].vel > 0.85 && out[2].vel > 0.75, 'beat 1 of each bar +0.08');
  assert.ok(Math.abs(out[1].vel - 0.7) <= 0.05);
  // Two notes on the same step must not produce a zero or negative length.
  assert.ok(H([{ step: 0, dur: 4, vel: 0.7, midi: 40 }, { step: 0, dur: 4, vel: 0.7, midi: 52 }], { role: 'bass' }).every((n) => n.dur > 0));
});

test('chords: pianos and guitars strum, pads and strings do not, stabs get shorter', () => {
  const chord = { step: 0, dur: 8, vel: 0.7, midis: [60, 64, 67] };
  const piano = H([chord], { role: 'chords', voice: 'keys-piano', seed: 'c1' })[0];
  assert.equal(piano.offsets.length, piano.midis.length);
  assert.equal(piano.offsets[0], 0, 'the lowest note is first');
  assert.ok(piano.offsets[2] > piano.offsets[1] && piano.offsets[1] > 0, 'low to high');
  const spreadMs = piano.offsets[2] * stepMs(100);
  assert.ok(spreadMs >= 8 && spreadMs <= 25, `strum spread ${spreadMs} ms`);
  // Same strum in milliseconds at any tempo, so it is a hand, not a grid position.
  const fast = H([chord], { role: 'chords', voice: 'guitar-steel', seed: 'c1', bpm: 160 })[0];
  assert.ok(fast.offsets[2] * stepMs(160) >= 8 && fast.offsets[2] * stepMs(160) <= 25);
  for (const voice of ['strings', 'synth-pad', 'choir', 'brass-section']) {
    assert.equal(H([chord], { role: 'chords', voice, seed: 'c1' })[0].offsets, undefined, voice);
  }
  assert.equal(H([{ ...chord, midis: [60] }], { role: 'chords', voice: 'keys-piano' })[0].offsets, undefined, 'one note is not a strum');
  // Unsorted voicings still strum low to high.
  const un = H([{ ...chord, midis: [67, 60, 64] }], { role: 'chords', voice: 'guitar-nylon', seed: 'c1' })[0];
  assert.equal(un.offsets[1], 0);
  assert.ok(un.offsets[0] > un.offsets[2] && un.offsets[2] > 0);
  // lengths
  assert.equal(H([{ step: 0, dur: 3, vel: 0.8, midis: [60, 64] }], { role: 'chords', voice: 'keys-piano' })[0].dur, 1.8, 'stab');
  assert.equal(H([{ step: 0, dur: 16, vel: 0.5, midis: [60, 64] }], { role: 'chords', voice: 'strings' })[0].dur, 16, 'pad');
});

test('melody: loudest in the middle of each 2-bar idea, legato when notes touch', () => {
  const line = Array.from({ length: 32 }, (_, k) => ({ step: k * 2, dur: 2, vel: 0.7, midi: 72 }));
  const out = H(line, { role: 'melody', seed: 'm1' });
  const near = (lo, hi) => mean(out.filter((n) => n.step % 32 >= lo && n.step % 32 <= hi).map((n) => n.vel));
  assert.ok(near(12, 20) > near(0, 4) + 0.03, `middle ${near(12, 20)} vs edge ${near(0, 4)}`);
  for (const n of out) assert.ok(Math.abs(nudgeOf(n)) <= 0.04, `melody ${n.nudge}`);
  // long notes lean late
  assert.ok(mean(H(line.map((n) => ({ ...n, dur: 8 })), { role: 'melody', seed: 'm1' }).map(nudgeOf)) > mean(out.map(nudgeOf)));
  // touching notes fill the gap exactly; a note with air after it keeps its length
  const legato = H([{ step: 0, dur: 6, vel: 0.7, midi: 72 }, { step: 4, dur: 2, vel: 0.7, midi: 74 }, { step: 16, dur: 2, vel: 0.7, midi: 76 }], { role: 'melody' });
  assert.equal(legato[0].dur, 4, 'no overlap with the next note');
  assert.equal(legato[1].dur, 2);
  assert.equal(legato[2].dur, 2);
});

test('gossip: the new note fields survive and everything is bounded', () => {
  const kept = sanitiseNotes([
    { step: 4, dur: 2, vel: 0.8, midi: 60, nudge: 0.04 },
    { step: 0, dur: 4, vel: 0.5, midis: [60, 64, 67], offsets: [0, 0.05, 0.1] },
    { step: 0, dur: 1, vel: 0.9, drum: 'kick', nudge: -0.01 },
  ]);
  assert.equal(kept.length, 3);
  assert.equal(kept[0].nudge, 0.04);
  assert.deepEqual(kept[1].offsets, [0, 0.05, 0.1]);
  assert.equal(kept[2].nudge, -0.01);
  const bad = sanitiseNotes([
    { step: 4, dur: 2, vel: 2, midi: 60, nudge: 99 },
    { step: 0, dur: 2, vel: 0.5, midis: [60, 64], offsets: [0, 9] },
    { step: 0, dur: 2, vel: 0.5, midis: [60, 64], offsets: [0] },
    { step: 64, dur: 1, vel: 0.5, midi: 60 }, { step: 1.5, dur: 1, vel: 0.5, midi: 60 },
    { step: 0, dur: 0, vel: 0.5, midi: 60 }, { step: 0, dur: 1, vel: 0.5, midi: NaN },
    { step: 0, dur: 1, vel: 0.5, midis: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, null, 'x', 7,
  ]);
  assert.equal(bad.length, 3);
  assert.equal(bad[0].vel, 1);
  assert.equal(bad[0].nudge, MAX_NUDGE);
  assert.deepEqual(bad[1].offsets, [0, MAX_OFFSET]);
  assert.equal(bad[2].offsets, undefined, 'one offset per pitch or none at all');
  assert.equal(sanitiseNotes('nope').length, 0);
  assert.equal(sanitiseNotes(Array(500).fill({ step: 0, dur: 1, vel: 0.5, midi: 60 })).length, 400);
  assert.deepEqual(Object.keys(sanitiseNotes([{ step: 0, dur: 1, vel: 0.5, midi: 60, evil: '<script>' }])[0]).sort(), ['dur', 'midi', 'step', 'vel']);
});

test('doubling: two devices play the same gossiped part at the same millisecond', () => {
  const sMs = stepMs(structure.bpm);
  const owner = new Engine({ agents: ROLES.map((r) => new Agent(r, lib, () => 0.42)), now: () => t, audio: { play: (role, n, when) => mine.push({ role, step: n.step, when }) } });
  const other = new Engine({ agents: ROLES.map((r) => new Agent(r, lib, () => 0.9)), now: () => t, audio: { play: (role, n, when) => theirs.push({ role, step: n.step, when }) } });
  const mine = [], theirs = [];
  let t = 0;
  owner.start(structure, 0);
  other.start(structure, 0);
  other.myRoles = new Set(ROLES);
  other.doubling = new Set(ROLES); // every part is owned elsewhere: replay what arrives
  for (; t < 3 * 64 * sMs; t += 25) {
    owner.tick();
    for (const phrase of [0, 1, 2, 3]) {
      const entry = owner.phrases.get(phrase);
      for (const role of ROLES) if (entry?.local[role]) other.setRemotePart(phrase, role, entry.local[role]);
    }
    other.tick();
  }
  assert.ok(mine.length > 100);
  const order = (xs) => [...xs].sort((a, b) => a.when - b.when || a.role.localeCompare(b.role) || a.step - b.step);
  assert.deepEqual(order(theirs), order(mine), 'the doubling device is sample-accurate with the owner');

  // The times are the shared formula: step + swing on the odd 16ths + the note's baked-in nudge.
  const part = owner.phrases.get(1).local.drums;
  for (const n of part.notes) {
    const when = 64 * sMs + (n.step + (n.step % 2 ? structure.swing : 0) + (n.nudge || 0)) * sMs;
    assert.ok(mine.some((p) => p.role === 'drums' && Math.abs(p.when - when) < 1e-6), `drums step ${n.step}`);
  }
  // Swing moves the odd 16ths and nothing else: the same run with swing 0 differs by exactly the
  // swing on odd steps and not at all on even ones.
  const flat = [];
  let t2 = 0;
  const straight = new Engine({
    agents: ROLES.map((r) => new Agent(r, lib, () => 0.42)), now: () => t2,
    audio: { play: (role, n, when) => flat.push({ role, step: n.step, when }) },
  });
  straight.start({ ...structure, swing: 0 }, 0);
  for (; t2 < 3 * 64 * sMs; t2 += 25) straight.tick();
  assert.equal(flat.length, mine.length);
  for (const [i, p] of flat.entries()) {
    assert.equal(p.step, mine[i].step);
    const pushed = mine[i].when - p.when;
    assert.ok(Math.abs(pushed - (p.step % 2 ? structure.swing * sMs : 0)) < 1e-6, `step ${p.step} pushed ${pushed} ms`);
    assert.ok(Math.abs(p.when / sMs - Math.round(p.when / sMs)) <= MAX_NUDGE, 'a nudge never reaches the next 16th');
  }
  assert.ok(flat.some((p) => p.step % 2 === 1), 'the test actually saw notes on odd 16ths');
});
