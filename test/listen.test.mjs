// Phase 0 of docs/MUSIC_QUALITY_PLAN.md: the listening tools (npm test, Node only, no audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newMeters, addMeterSample, describeMeters, clipName, clipExt, CLIP_DB } from '../src/listen.js';
import { randomFor, seededRandom } from '../src/seed.js';
import { createLibrary, ROLES } from '../src/loops.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';

const lib = createLibrary();
const structure = { key: 'A', mode: 'minor', bpm: 100, progression: ['i', 'VI', 'III', 'VII'] };

test('meters: peak holds, loudness averages, clips count once per overload', () => {
  let m = newMeters();
  assert.equal(describeMeters(m), 'master: no audio yet');
  m = addMeterSample(m, { peakDb: -12, rmsDb: -20 }, 0);
  assert.equal(m.peakDb, -12);
  assert.equal(m.loudDb, -20, 'the first reading sets the average');
  m = addMeterSample(m, { peakDb: -18, rmsDb: -20 }, 40);
  assert.equal(m.peakDb, -12, 'the peak is a maximum, not the latest value');
  // a long overload is one clip; dipping below the threshold and going over again is two
  for (const peak of [0.2, 0.5, 1.5]) m = addMeterSample(m, { peakDb: peak, rmsDb: -6 }, (m.at ?? 0) + 40);
  assert.equal(m.clips, 1);
  m = addMeterSample(m, { peakDb: -6, rmsDb: -12 }, m.at + 40);
  m = addMeterSample(m, { peakDb: CLIP_DB, rmsDb: -6 }, m.at + 40);
  assert.equal(m.clips, 2, 'exactly at -0.3 dBFS counts');
  assert.ok(m.samples === 7 && m.peakDb === 1.5);
  assert.match(describeMeters(m), /^master peak \+1\.5 dB · loudness ~-\d+\.\d dB · clips 2$/);
});

test('meters: loudness converges on a steady signal and survives silence', () => {
  let m = newMeters();
  let t = 0;
  for (let i = 0; i < 400; i++) m = addMeterSample(m, { peakDb: -10, rmsDb: -18 }, (t += 40));
  assert.ok(Math.abs(m.loudDb + 18) < 0.2, `loudness ${m.loudDb}`);
  // -Infinity from a silent meter must not poison the average
  m = addMeterSample(m, { peakDb: -Infinity, rmsDb: -Infinity }, (t += 40));
  assert.ok(Number.isFinite(m.loudDb) && m.loudDb < -18);
  assert.equal(m.clips, 0);
  assert.equal(describeMeters(newMeters()), 'master: no audio yet');
});

test('clip names: seed, HH:MM and the browser mime type', () => {
  const at = new Date(2026, 0, 2, 9, 5);
  assert.equal(clipName('durhack', at, 'audio/webm;codecs=opus'), 'murmuration-durhack-0905.webm');
  assert.equal(clipName('song:ode-to-joy', at, 'audio/mp4'), 'murmuration-song-ode-to-joy-0905.mp4');
  assert.equal(clipName('  Mixed Case!! ', new Date(2026, 0, 2, 23, 59)), 'murmuration-mixed-case-2359.webm');
  assert.equal(clipName('', at), 'murmuration-improvised-0905.webm');
  assert.equal(clipName('???', at), 'murmuration-improvised-0905.webm');
  assert.equal(clipExt(''), 'webm');
  assert.equal(clipExt('audio/mpeg'), 'mp3');
  assert.equal(clipExt('audio/ogg;codecs=opus'), 'ogg');
});

test('?rng=: randomFor is deterministic per role and falls back to Math.random', () => {
  assert.equal(randomFor(null, 'drums'), Math.random);
  assert.equal(randomFor('', 'drums'), Math.random);
  const draws = (rng, who) => Array.from({ length: 5 }, randomFor(rng, who));
  assert.deepEqual(draws('test1', 'drums'), draws('test1', 'drums'));
  assert.notDeepEqual(draws('test1', 'drums'), draws('test1', 'bass'), 'each role gets its own stream');
  assert.notDeepEqual(draws('test1', 'drums'), draws('test2', 'drums'));
  assert.deepEqual(draws('test1', 'drums'), Array.from({ length: 5 }, seededRandom('test1', 'drums')));
  for (const x of draws('test1', 'melody')) assert.ok(x >= 0 && x < 1);
});

// The point of ?rng=: two runs of the same build make the same music, so a before/after clip is fair.
test('?rng=: two engines seeded the same way play identical notes', () => {
  const run = (rng) => {
    let t = 0;
    const parts = [];
    const e = new Engine({
      agents: ROLES.map((r) => new Agent(r, lib, randomFor(rng, r))),
      now: () => t,
      audio: { play() {} },
      onEvent: (ev) => parts.push({ phrase: ev.phrase, role: ev.role, d: ev.part.d, notes: ev.part.notes }),
    });
    e.start(structure, 0);
    for (const end = 8 * 64 * stepMs(structure.bpm); t < end; t += 50) e.tick();
    return parts;
  };
  const a = run('test1');
  assert.ok(a.length >= 20);
  assert.deepEqual(run('test1'), a, 'same rng, same music');
  assert.notDeepEqual(run('test2').map((x) => x.d), a.map((x) => x.d), 'a different rng decides differently');
});
