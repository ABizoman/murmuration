// npm test  (Node only: no browser, no audio)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, degreeToMidi, anchorFor, voiceChord, KEYS, SCALES, keyPc } from '../src/theory.js';
import { structureFromSeed } from '../src/seed.js';
import { position, phraseStartMs, stepMs } from '../src/clock.js';
import { createLibrary, ROLES, DENSITIES } from '../src/loops.js';
import { renderPhrase } from '../src/render.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { toRelativeLoop } from '../src/midi-import.js';

test('chords: V in minor is major, iv is minor', () => {
  const V = parseChord('V', 'C', 'minor');
  assert.deepEqual(V.pcs, [7, 11, 2]); // G B D
  const iv = parseChord('iv', 'A', 'minor');
  assert.deepEqual(iv.pcs, [2, 5, 9]); // D F A
});

test('degrees map to chord tones and scale tones', () => {
  const VI = parseChord('VI', 'A', 'minor'); // F major
  const a = anchorFor('melody', VI);
  assert.equal(a % 12, 5);
  assert.equal(degreeToMidi(0, 0, VI, a) % 12, 5); // F
  assert.equal(degreeToMidi(2, 0, VI, a) % 12, 9); // A
  assert.equal(degreeToMidi(4, 0, VI, a) % 12, 0); // C
  assert.equal(degreeToMidi(7, 0, VI, a), a + 12);
  assert.equal(degreeToMidi(-1, 0, VI, a), a - 1); // E, scale step below
});

test('seed only gives structure, deterministically', () => {
  const a = structureFromSeed('durhack'), b = structureFromSeed('durhack');
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), ['bpm', 'key', 'mode', 'progression', 'seed']);
  const keys = new Set(Array.from({ length: 200 }, (_, i) => structureFromSeed(`s${i}`).key));
  assert.ok(keys.size >= 10, 'seeds spread over keys');
});

test('clock: phrase/bar/step from time', () => {
  const bpm = 120, start = 1000, s = stepMs(bpm); // 125 ms per 16th
  assert.equal(s, 125);
  assert.deepEqual({ ...position(start, start, bpm), stepFloat: 0 }, { stepFloat: 0, phrase: 0, bar: 0, step: 0 });
  const p = position(start + 125 * (64 + 16 + 3) + 1, start, bpm);
  assert.equal(p.phrase, 1); assert.equal(p.bar, 1); assert.equal(p.step, 3);
  assert.equal(phraseStartMs(2, start, bpm), start + 2 * 64 * 125);
});

test('every loop renders in every key/mode, in range, with chord tones on downbeats', () => {
  const lib = createLibrary();
  for (const mode of ['minor', 'major'])
    for (const key of KEYS) {
      const structure = { key, mode, bpm: 90, progression: mode === 'minor' ? ['i', 'VI', 'III', 'V'] : ['I', 'V', 'vi', 'IV'] };
      for (const loop of lib.loops) {
        const { notes } = renderPhrase(loop, { structure, phrase: 0 });
        assert.ok(notes.length > 0, loop.id);
        for (const n of notes) {
          assert.ok(n.step >= 0 && n.step < 64);
          if (n.midi != null) {
            const [lo, hi] = loop.role === 'bass' ? [28, 60] : [52, 92];
            assert.ok(n.midi >= lo && n.midi <= hi, `${loop.id} ${key} ${mode} midi ${n.midi}`);
          }
          if (n.midis) assert.ok(n.midis.every((m) => m >= 48 && m <= 80), `${loop.id} voicing ${n.midis}`);
        }
        // bass downbeat of every bar is the chord root
        if (loop.role === 'bass')
          for (const n of notes.filter((n) => n.step % 16 === 0)) {
            const chord = parseChord(structure.progression[Math.floor(n.step / 16)], key, mode);
            assert.equal(n.midi % 12, chord.rootPc, `${loop.id} bar ${n.step / 16}`);
          }
      }
    }
});

test('every role has sparse, medium and busy for every style', () => {
  const lib = createLibrary();
  for (const r of ROLES)
    for (const s of lib.styles(r))
      for (const d of DENSITIES) assert.equal(lib.find(r, s, d).density, d, `${r}/${s}/${d}`);
});

test('chord voicing moves smoothly', () => {
  const chords = ['i', 'VI', 'III', 'VII'].map((n) => parseChord(n, 'A', 'minor'));
  let prev = null, maxJump = 0;
  for (let k = 0; k < 8; k++) {
    const v = voiceChord(chords[k % 4], 3, prev);
    if (prev) maxJump = Math.max(maxJump, ...v.map((n, i) => Math.abs(n - prev[i])));
    prev = v;
  }
  assert.ok(maxJump <= 5, `max voice jump ${maxJump}`);
});

test('MIDI import: a pack loop in another key round-trips through scale degrees', () => {
  const lib = createLibrary();
  const ppq = 480;
  for (const id of ['melody/call/busy', 'melody/motif/medium', 'bass/roots/busy', 'drums/boombap/busy']) {
    const loop = lib.loops.find((l) => l.id === id);
    const packStructure = { key: 'E', mode: 'minor', bpm: 90, progression: ['i', 'VI', 'III', 'VII'] };
    // render as if it were a pack file in E minor, then convert it to MIDI-ish raw notes
    const { notes } = renderPhrase(loop, { structure: packStructure, phrase: 0 });
    const raw = notes
      .filter((n) => n.step < loop.bars * 16)
      .map((n) => ({ midi: n.midi ?? { kick: 36, snare: 38, hat: 42, ohat: 46 }[n.drum], ticks: n.step * 120, durationTicks: n.dur * 120, velocity: n.vel }));
    const imported = toRelativeLoop(raw, ppq, { id: 'x', role: loop.role, style: 's', density: loop.density, ...packStructure });
    // now play both in a different key: must give identical notes
    const target = { key: 'Bb', mode: 'minor', bpm: 90, progression: ['i', 'iv', 'VI', 'V'] };
    const a = renderPhrase(loop, { structure: target, phrase: 0 }).notes.map((n) => `${n.step}:${n.midi ?? n.drum}`);
    const b = renderPhrase(imported, { structure: target, phrase: 0 }).notes.map((n) => `${n.step}:${n.midi ?? n.drum}`);
    assert.deepEqual(b, a, id);
  }
});

test('engine decides the next phrase exactly N bars ahead, and every note is sent once, on time', () => {
  for (const aheadBars of [1, 2]) {
    let t = 0;
    const played = [];
    const events = [];
    const plans = [];
    const lib = createLibrary();
    let seedR = 1;
    const rand = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
    const agents = ROLES.map((r) => new Agent(r, lib, rand));
    const e = new Engine({
      agents, now: () => t, composeAheadBars: aheadBars, planAheadBars: aheadBars + 1,
      onEvent: (ev) => events.push({ ...ev, at: t }),
      onPlan: (phrase, ctxs, deadline) => plans.push({ phrase, roles: Object.keys(ctxs), deadline }),
      audio: { play: (role, n, when) => played.push({ role, when, at: t, what: n.drum ?? n.midi ?? n.midis.join() }) },
    });
    const structure = { key: 'A', mode: 'minor', bpm: 100, progression: ['i', 'VI', 'III', 'VII'] };
    e.start(structure, 300);
    for (t = 0; t < 90000; t += 25) e.tick();

    const barMs = 16 * stepMs(100);
    for (const ev of events.filter((x) => x.phrase > 0)) {
      const startsIn = phraseStartMs(ev.phrase, 300, 100) - ev.at;
      assert.ok(startsIn > 0 && startsIn <= aheadBars * barMs + 1, `phrase ${ev.phrase} decided ${startsIn} ms early`);
    }
    for (const p of plans) assert.ok(Math.abs(p.deadline - barMs) <= 26, `Jev gets about one bar: ${p.deadline}`);
    assert.equal(plans.length, new Set(plans.map((p) => p.phrase)).size, 'one plan per phrase');
    assert.ok(played.length > 200);
    for (const p of played) assert.ok(p.when - p.at >= -20 && p.when - p.at <= 150, `sent ${p.when - p.at} ms ahead`);
    const keys = played.map((p) => `${p.role}:${p.what}@${p.when}`);
    assert.equal(new Set(keys).size, keys.length, 'no duplicates');
  }
});

test('arrangement: chords first, then drums and bass, then melody', () => {
  let t = 0;
  const lib = createLibrary();
  const e = new Engine({ agents: ROLES.map((r) => new Agent(r, lib, () => 0.5)), now: () => t, audio: { play() {} } });
  e.start({ key: 'C', mode: 'major', bpm: 90, progression: ['I', 'V', 'vi', 'IV'] }, 0);
  const playing = (p) => Object.entries(e.ensureParts(p).local).filter(([, part]) => part.notes.length).map(([r]) => r).sort();
  assert.deepEqual(playing(0), ['chords']);
  assert.deepEqual(playing(1), ['bass', 'chords', 'drums']);
  assert.deepEqual(playing(2), ['bass', 'chords', 'drums', 'melody']);
});
