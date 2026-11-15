// Phase 2 of docs/MUSIC_QUALITY_PLAN.md: the mix. audio.js needs a browser, but the whole signal
// flow is data in mix.js, so the routing and the numbers can be checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIX, DRUM_STRIP, mixFor, isWeakDevice, dbToGain, reverbsIn } from '../src/mix.js';
import { DRUM_FILES } from '../src/voices.js';
import { createLibrary, ROLES , kindOf } from '../src/loops.js';

const full = mixFor(false);
const lite = mixFor(true);
const centre = (eq) => Math.sqrt(eq.lowFrequency * eq.highFrequency); // the EQ3 mid band

test('mix: every strip reaches a bus, every bus reaches the master, nothing is orphaned', () => {
  for (const [name, s] of Object.entries(MIX.strips)) {
    assert.ok(MIX.buses[s.bus], `${name} feeds a bus that does not exist: ${s.bus}`);
    assert.ok(s.pan == null || (s.pan >= -1 && s.pan <= 1), `${name} pan ${s.pan}`);
    for (const send of ['room', 'hall', 'delay']) assert.ok(s[send] == null || (s[send] > 0 && s[send] <= 1), `${name} ${send} ${s[send]}`);
  }
  // one strip per pitched role, plus the three the drums split into
  for (const role of ROLES.filter((r) => kindOf(r) !== 'drums')) assert.ok(MIX.strips[role], `no strip for ${role}`); // perc goes to the hats
  assert.deepEqual(Object.keys(MIX.strips).filter((n) => MIX.strips[n].bus === 'drums'), ['kick', 'body', 'hats']);
  for (const bus of Object.keys(MIX.buses)) assert.ok(Object.values(MIX.strips).some((s) => s.bus === bus), `${bus} has no strips`);
});

test('mix: every drum the library can play has a route', () => {
  for (const f of [...DRUM_FILES, 'ohat', 'hat']) assert.ok(MIX.strips[DRUM_STRIP[f]], `drum "${f}" is not routed`);
  const played = new Set(createLibrary().loops.filter((l) => l.role === 'drums').flatMap((l) => l.events.map((e) => e.drum)));
  for (const drum of played) assert.ok(MIX.strips[DRUM_STRIP[drum]], `loops play "${drum}" but it is not routed`);
  for (const [drum, strip] of Object.entries(DRUM_STRIP)) assert.equal(MIX.strips[strip]?.bus, 'drums', `${drum} -> ${strip}`);
});

test('mix: the EQ does what the plan says (and the kick is left alone)', () => {
  assert.equal(MIX.strips.kick.hp, undefined, 'the kick keeps its bottom end');
  assert.equal(MIX.strips.kick.eq, undefined);
  assert.equal(MIX.strips.hats.hp, 300);
  assert.equal(MIX.strips.bass.hp, 35);
  assert.ok(MIX.strips.bass.eq.mid === -2 && centre(MIX.strips.bass.eq) > 200 && centre(MIX.strips.bass.eq) < 350);
  assert.ok(MIX.strips.chords.hp >= 160 && MIX.strips.chords.hp <= 200);
  assert.ok(MIX.strips.chords.eq.mid <= -2 && MIX.strips.chords.eq.mid >= -3);
  assert.ok(centre(MIX.strips.chords.eq) > 300 && centre(MIX.strips.chords.eq) < 400, `chords cut at ${centre(MIX.strips.chords.eq)} Hz`);
  assert.equal(MIX.strips.melody.hp, 220);
  assert.ok(MIX.strips.melody.eq.high < 0 && MIX.strips.melody.eq.highFrequency <= 3000, 'a gentle top cut on the lead');
  assert.deepEqual(MIX.master.eq, { low: 1, high: 0, lowFrequency: 100, highFrequency: 10000 });
  assert.equal(MIX.master.limiter, -1);
});

test('mix: drums sit in the room more than the kick, hats are off centre, the rest is centred', () => {
  assert.ok(MIX.strips.body.room > MIX.strips.kick.room, 'the snare gets more room than the kick');
  assert.ok(MIX.strips.hats.pan > 0.1 && MIX.strips.hats.pan < 0.3);
  for (const n of ['kick', 'body', 'bass', 'chords', 'melody']) assert.equal(MIX.strips[n].pan, 0, `${n} is centred`);
  assert.equal(MIX.strips.chords.widen, undefined, 'mono samples: the widener added no width');
  assert.ok(MIX.strips.melody.delay > 0 && MIX.strips.bass.delay == null, 'only the melody is delayed');
  assert.ok(MIX.strips.chords.hall > 0 && MIX.strips.melody.hall > 0 && MIX.strips.bass.hall == null);
});

test('mix: compressors and the glue match the plan', () => {
  assert.deepEqual(MIX.buses.drums.comp, { threshold: -14, ratio: 4, attack: 0.01, release: 0.12, knee: 6 });
  assert.equal(MIX.buses.bass.comp.ratio, 3);
  assert.equal(MIX.buses.chords.comp, undefined);
  assert.equal(MIX.buses.melody.comp, undefined);
  assert.equal(MIX.master.glue.ratio, 2);
  assert.equal(MIX.master.glue.threshold, -18);
  assert.equal(MIX.master.glue.attack, 0.03);
  assert.equal(MIX.master.glue.release, 0.2);
});

test('ducking: the kick dips the bass and the chords, and nothing else', () => {
  assert.equal(MIX.buses.bass.duck, -4);
  assert.equal(MIX.buses.chords.duck, -2);
  assert.equal(MIX.buses.drums.duck, undefined);
  assert.equal(MIX.buses.melody.duck, undefined);
  assert.equal(MIX.duckMs, 120);
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(-4) - 0.631) < 0.001);
  assert.ok(Math.abs(dbToGain(-2) - 0.794) < 0.001);
  assert.ok(dbToGain(-4) < dbToGain(-2) && dbToGain(-2) < 1);
});

test('lite graph: one reverb, no widener, and the full graph never exceeds two reverbs', () => {
  assert.equal(reverbsIn(full), 2, 'ground rule: at most two convolution reverbs');
  assert.equal(reverbsIn(lite), 1);
  assert.equal(lite.fx.hall, null);
  assert.ok(lite.fx.room && lite.fx.delay, 'the room and the delay stay: they are cheap');
  for (const [name, s] of Object.entries(lite.strips)) {
    assert.equal(s.hall, undefined, `${name} still sends to the hall`);
    assert.equal(s.widen, undefined, `${name} still has a widener`);
  }
  assert.equal(lite.strips.chords.hp, MIX.strips.chords.hp, 'the EQ is kept: it costs nothing');
  assert.equal(lite.strips.melody.delay, MIX.strips.melody.delay);
  assert.equal(lite.lite, true);
  assert.equal(full.lite, false);
  // mixFor is pure: the shared spec is never edited
  assert.equal(MIX.strips.chords.hall, 0.22);
  assert.ok(MIX.fx.hall && MIX.fx.hall.decay === 2.2);
  assert.equal(MIX.fx.room.decay, 0.9);
});

test('weak devices get the lite graph, unknown ones do not', () => {
  for (const cores of [1, 2, 3, 4]) assert.equal(isWeakDevice({ hardwareConcurrency: cores }), true, `${cores} cores`);
  for (const cores of [5, 8, 16]) assert.equal(isWeakDevice({ hardwareConcurrency: cores }), false, `${cores} cores`);
  for (const nav of [{}, undefined, { hardwareConcurrency: 0 }, { hardwareConcurrency: NaN }, { hardwareConcurrency: 'lots' }])
    assert.equal(isWeakDevice(nav), false, JSON.stringify(nav));
});
