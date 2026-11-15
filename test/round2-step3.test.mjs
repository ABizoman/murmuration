// Round 2, step 3: build-ups and drops. Before a hook section the chords, pad and arp sweep open
// and the drums, bass and perc drop out for the last half bar; into any other new section the bass
// walks to the next chord's root. All of it baked into the notes, so it is shared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeTone, nodes } from './fake-tone.mjs';
import { formFromStructure, formDirective } from '../src/form.js';
import { applyTransitions, transitionsIn, walkUp, DROP_AT } from '../src/transitions.js';
import { structureFromSeed, seededRandom } from '../src/seed.js';
import { chordAt } from '../src/render.js';
import { sanitiseNotes, humanise } from '../src/feel.js';
import { keyPc, SCALES } from '../src/theory.js';
import { MIX, SWEEP, sweepHz } from '../src/mix.js';
import { simulateBand, byRole } from '../tools/sim.mjs';

const structure = structureFromSeed('buildup');
const form = formFromStructure(structure);
const dir = (p) => formDirective(form, p);

const groove = () => {
  const g = [];
  for (let s = 0; s < 64; s += 2) g.push({ step: s, dur: 1, vel: 0.7, drum: 'hat' });
  for (const s of [0, 16, 32, 48, 56]) g.push({ step: s, dur: 1, vel: 0.9, drum: 'kick' });
  for (const s of [4, 12, 20, 28, 36, 44, 52, 60]) g.push({ step: s, dur: 1, vel: 0.9, drum: 'snare' });
  return g;
};
const bassLine = () => [0, 8, 16, 24, 32, 40, 48, 52, 56, 60].map((step) => ({ step, dur: 4, vel: 0.8, midi: 45 }));

test('form: the build-up is the last phrase before a hook section, and only that', () => {
  const ups = Array.from({ length: 22 }, (_, p) => (dir(p).buildUp ? p : null)).filter((p) => p != null);
  // pre (3) -> chorus, verse2 (7) -> chorus, breakdown (10) -> finalChorus, then round again
  assert.deepEqual(ups, [3, 7, 10, 15, 18]);
  assert.equal(dir(3).nextHook, true);
  assert.equal(dir(5).nextHook, false, 'chorus -> verse2');
  assert.equal(dir(12).nextPlan.bass, 'out', 'finalChorus -> outro: the bass sits out of the outro');
  assert.equal(dir(1).nextPlan, null, 'not the last phrase of its section');
});

test('drop: the drums leave the last half bar to the riser, after a fill that ends at the drop', () => {
  const out = applyTransitions(groove(), { role: 'drums', dir: dir(3), structure, phrase: 3 });
  assert.ok(!out.some((n) => n.step >= DROP_AT && n.drum !== 'riser'), 'nothing but the riser from step 56');
  assert.ok(!out.some((n) => n.step + n.dur > DROP_AT && n.drum !== 'riser'), 'nothing rings into the drop');
  const tr = transitionsIn(out);
  assert.ok(tr.fill && tr.riser && tr.drop);
  for (const s of [48, 49, 50, 51, 52, 53, 54, 55]) assert.ok(out.some((n) => n.step === s && ['snare', 'tom1', 'tom2', 'tom3'].includes(n.drum)), `fill at ${s}`);
  assert.deepEqual(out.filter((n) => n.step < 48), groove().filter((n) => n.step < 48).sort((a, b) => a.step - b.step), 'bars 1-3 untouched');
  assert.deepEqual(applyTransitions(groove(), { role: 'drums', dir: dir(3), structure, phrase: 3 }), out, 'deterministic');
  // the bass and the perc drop too; the melody plays on
  const bass = applyTransitions([{ step: 40, dur: 24, vel: 0.8, midi: 40 }], { role: 'bass', dir: dir(3), structure, phrase: 3 });
  assert.deepEqual(bass, [{ step: 40, dur: 16, vel: 0.8, midi: 40 }]);
  const shaker = [60, 62].map((step) => ({ step, dur: 1, vel: 0.5, drum: 'shaker' }));
  assert.deepEqual(applyTransitions(shaker, { role: 'perc', dir: dir(3), structure, phrase: 3 }), []);
  const mel = [{ step: 58, dur: 4, vel: 0.7, midi: 72 }];
  assert.deepEqual(applyTransitions(mel, { role: 'melody', dir: dir(3), structure, phrase: 3 }), mel);
  // no drop mid-verse or into a verse
  assert.ok(applyTransitions(groove(), { role: 'drums', dir: dir(5), structure, phrase: 5 }).some((n) => n.step >= DROP_AT && n.drum !== 'riser'));
});

test('sweep: the first note of the chords, pad and arp carries the steps left in the build-up', () => {
  const chords = [{ step: 4, dur: 12, vel: 0.7, midis: [57, 60, 64] }, { step: 20, dur: 12, vel: 0.7, midis: [57, 60, 64] }];
  for (const role of ['chords', 'pad', 'arp']) {
    const out = applyTransitions(chords, { role, dir: dir(3), structure, phrase: 3 });
    assert.equal(out[0].sweep, 60, role);
    assert.equal(out.filter((n) => n.sweep).length, 1);
  }
  assert.ok(!applyTransitions(chords, { role: 'melody', dir: dir(3), structure, phrase: 3 }).some((n) => n.sweep));
  assert.ok(!applyTransitions(chords, { role: 'chords', dir: dir(2), structure, phrase: 2 }).some((n) => n.sweep), 'not in the verse');
  assert.ok(!applyTransitions(chords, { role: 'chords', dir: dir(4), structure, phrase: 4 }).some((n) => n.sweep), 'not in the chorus');
  // it survives the groove and gossip, bounded
  const felt = humanise(applyTransitions(chords, { role: 'chords', dir: dir(3), structure, phrase: 3 }), { role: 'chords', phrase: 3, seed: 's', bpm: 120 });
  assert.equal(sanitiseNotes(felt)[0].sweep, 60);
  assert.equal(sanitiseNotes([{ step: 0, dur: 4, vel: 0.5, midi: 60, sweep: 900 }])[0].sweep, 64);
  assert.equal(sanitiseNotes([{ step: 0, dur: 4, vel: 0.5, midi: 60, sweep: 'x' }])[0].sweep, undefined);
});

test('walk: into a non-hook section the bass walks the scale to the next root', () => {
  const scale = new Set(SCALES[structure.mode].map((x) => (keyPc(structure.key) + x) % 12));
  for (const p of [2, 5]) { // verse -> pre, chorus -> verse2
    const out = applyTransitions(bassLine(), { role: 'bass', dir: dir(p), structure, phrase: p });
    const target = chordAt(structure, p + 1, 0).rootPc;
    const walk = out.filter((n) => n.step >= 56).length === 4 ? out.filter((n) => n.step >= 56) : out.filter((n) => n.step >= 52);
    assert.ok(walk.length === 3 || walk.length === 4, `phrase ${p}: ${JSON.stringify(out)}`);
    const pitches = walk.map((n) => n.midi);
    for (const m of pitches) assert.ok(scale.has(m % 12) && m >= 28 && m <= 60, `${m} in the scale, in range`);
    const dirn = Math.sign(pitches[1] - pitches[0]);
    for (let i = 1; i < pitches.length; i++) assert.ok(Math.sign(pitches[i] - pitches[i - 1]) === dirn && Math.abs(pitches[i] - pitches[i - 1]) <= 2, 'stepwise, one way');
    const last = pitches[pitches.length - 1];
    assert.ok([1, 2, 10, 11].includes((((target - last) % 12) + 12) % 12), 'the last note is a step from the next root');
    assert.ok(walk.every((n, i) => i === 0 || n.vel >= walk[i - 1].vel), 'getting louder');
  }
  // not into a hook section (that is the drop), not when the bass sits out of the next section
  assert.ok(!applyTransitions(bassLine(), { role: 'bass', dir: dir(3), structure, phrase: 3 }).some((n) => n.step >= DROP_AT));
  assert.deepEqual(applyTransitions(bassLine(), { role: 'bass', dir: dir(12), structure, phrase: 12 }), bassLine());
  assert.deepEqual(applyTransitions(bassLine(), { role: 'bass', dir: dir(1), structure, phrase: 1 }), bassLine(), 'mid-section');
  // a resting bass stays resting
  assert.deepEqual(applyTransitions([], { role: 'bass', dir: dir(2), structure, phrase: 2 }), []);
  // deterministic, and never down in the mud
  const r = () => seededRandom('x', 1, 'walk');
  assert.deepEqual(walkUp(bassLine(), chordAt(structure, 3, 0), structure, r()), walkUp(bassLine(), chordAt(structure, 3, 0), structure, r()));
  const low = walkUp([{ step: 0, dur: 4, vel: 0.8, midi: 30 }], chordAt(structure, 3, 0), structure, r());
  assert.ok(low.every((n) => n.midi >= 28));
});

test('audio: a note with `sweep` ramps its own strip lowpass open, then snaps it back', async (t) => {
  assert.ok(MIX.strips.chords.sweep && MIX.strips.pad.sweep && MIX.strips.arp.sweep && !MIX.strips.bass.sweep && !MIX.strips.melody.sweep);
  assert.ok(sweepHz(0) === SWEEP.from && Math.abs(sweepHz(1) - SWEEP.to) < 1e-6 && sweepHz(0.5) > SWEEP.from && sweepHz(0.5) < SWEEP.to);
  globalThis.window = { Tone: makeFakeTone() };
  const { createAudio } = await import(`../src/audio.js?${Math.random()}`);
  const audio = await createAudio({ onStatus: () => {}, lite: false });
  t.after(() => audio.dispose());
  const lowpasses = () => nodes.filter((n) => n.kind === 'Filter' && n.opts?.type === 'lowpass' && n.opts?.frequency === SWEEP.open);
  assert.equal(lowpasses().length, 3, 'chords, pad and arp');
  const when = performance.timeOrigin + performance.now() + 500;
  audio.play('chords', { step: 0, dur: 4, vel: 0.8, midis: [60, 64, 67] }, when, 500, null, 125);
  assert.ok(lowpasses().every((f) => !f.frequency.events.length), 'no sweep without the field');
  audio.play('chords', { step: 32, dur: 4, vel: 0.8, midis: [60, 64, 67], sweep: 32 }, when, 500, null, 125);
  audio.play('bass', { step: 32, dur: 4, vel: 0.8, midi: 40, sweep: 32 }, when, 500, null, 125); // no lowpass on the bass: ignored
  const swept = lowpasses().filter((f) => f.frequency.events.length);
  assert.equal(swept.length, 1, 'only the chords strip');
  const ev = swept[0].frequency.events;
  assert.deepEqual(ev.map((e) => e.op), ['cancel', 'set', 'exp', 'set']);
  assert.ok(Math.abs(ev[1].v - sweepHz(0.5)) < 1e-6, 'halfway through the phrase, halfway up');
  assert.ok(Math.abs(ev[2].t - ev[1].t - 32 * 0.125) < 1e-6, 'opens over the 32 steps left');
  assert.equal(ev[2].v, SWEEP.to);
  assert.equal(ev[3].v, SWEEP.open);
});

test('the improvising band and Murmur both build up: drops, sweeps and walks in the played notes', () => {
  for (const seed of ['buildup', 'song:murmur']) {
    const { parts, directive } = simulateBand({ seed, rng: `t-${seed}`, phrases: 14, devices: 7 });
    const s = byRole(parts);
    const at = (r, p) => s[r].find((x) => x.phrase === p)?.part;
    const ups = Array.from({ length: 14 }, (_, p) => p).filter((p) => directive(p).buildUp);
    assert.ok(ups.length >= 2, seed);
    for (const p of ups) {
      const drums = at('drums', p);
      if (drums?.notes.some((n) => n.step < 48)) assert.ok(transitionsIn(drums.notes).drop, `${seed} drums drop at ${p}`);
      for (const r of ['chords', 'pad']) if (at(r, p)?.notes.length) assert.ok(at(r, p).notes.some((n) => n.sweep), `${seed} ${r} sweeps at ${p}`);
    }
  }
});

test('audio: bigger buffers (no crackles), the engine schedules past the latency, glitches are counted', async (t) => {
  globalThis.window = { Tone: makeFakeTone() };
  const Tone = window.Tone;
  const { createAudio } = await import(`../src/audio.js?${Math.random()}`);
  const audio = await createAudio({ onStatus: () => {}, lite: false });
  t.after(() => audio.dispose());
  assert.equal(Tone.getContext().rawContext.latencyHint, 'playback');
  assert.equal(audio.glitches(), null, 'no playbackStats: nothing to report');
  Tone.getContext().rawContext.outputLatency = 0.12;
  assert.equal(Math.round(audio.latencyMs()), 120);
  Tone.getContext().rawContext.playbackStats = { underrunEvents: 3 };
  assert.equal(audio.glitches(), 3);
  // the engine hands notes over latency + 100 ms early (not just its usual 150 ms)
  const { Engine } = await import('../src/engine.js');
  const handOver = (latencyMs, nowMs) => {
    const sent = [];
    const e = new Engine({ agents: [], audio: { play: (role, n, when) => sent.push(when), latencyMs: () => latencyMs }, now: () => nowMs, getDirective: () => null });
    e.start({ bpm: 120 }, 0);
    e.myRoles.add('chords');
    e.ensureParts = () => {}; // only the hand-over is under test
    e.phrases.set(0, { phrase: 0, local: { chords: { notes: [{ step: 4, dur: 2, vel: 0.5, midis: [60] }], d: {} } }, sent: new Set() });
    e.tick();
    return sent;
  };
  // step 4 at 120 bpm sounds at 500 ms; at 250 ms it is 250 ms away
  assert.deepEqual(handOver(0, 250), [], 'no latency: handed over 150 ms before');
  assert.deepEqual(handOver(200, 250), [500], 'a 200 ms speaker: handed over 300 ms before');
});

test('server: the QR code points at the Wi-Fi address, not a virtual adapter', async () => {
  const { rankAddresses } = await import('../src/net/lan.js');
  const ifaces = {
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.22.48.1', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'Ethernet 2': [{ family: 'IPv4', address: '169.254.10.3', internal: false }],
    'VirtualBox Host-Only Network': [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    'Wi-Fi': [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '10.240.3.17', internal: false }],
  };
  const ranked = rankAddresses(ifaces);
  assert.equal(ranked[0].address, '10.240.3.17');
  assert.ok(!ranked.some((a) => a.address === '127.0.0.1' || a.address.includes(':')));
  assert.equal(ranked[ranked.length - 1].address, '169.254.10.3');
  assert.equal(rankAddresses({ en0: [{ family: 4, address: '192.168.1.20', internal: false }] })[0].address, '192.168.1.20', 'macOS, older Node');
});
