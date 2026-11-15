// Phase 2 of docs/MUSIC_QUALITY_PLAN.md: the signal flow in src/audio.js, checked against a fake
// Tone.js (test/fake-tone.mjs). No browser and no audio context, so this cannot tell us how the
// mix sounds -- only that every part is routed, ducked and filtered the way mix.js says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeTone, routes, nodes, triggers, lastTrigger, DEST } from './fake-tone.mjs';
import { dbToGain, MIX } from '../src/mix.js';

const WHEN = () => performance.timeOrigin + performance.now() + 500; // half a second from now
const note = (extra) => ({ step: 0, dur: 4, vel: 0.9, ...extra });

async function makeAudio(opts = {}) {
  globalThis.window = { Tone: makeFakeTone() };
  const { createAudio } = await import(`../src/audio.js?${Math.random()}`); // a fresh graph per test
  return createAudio({ onStatus: () => {}, lite: false, ...opts });
}
// Where a part ends up after play(): the node that was triggered last.
const played = (audio, role, n, voice) => {
  const before = triggers.length;
  audio.play(role, n, WHEN(), 500, voice, 150);
  return triggers.slice(before);
};

test('graph: a kick runs through the drum bus compressor, the glue and the limiter, untouched', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const [hit] = played(audio, 'drums', note({ drum: 'kick' }));
  const paths = routes(hit.node);
  assert.ok(paths.some((p) => /^MembraneSynth -> Panner\(0\) -> Gain\(1\) -> Compressor\(r4\) -> EQ3\(mid 0, high 0\) -> Compressor\(r2\) -> Limiter\(-1\) -> destination$/.test(p)),
    `kick routes:\n${paths.join('\n')}`);
  assert.ok(!paths.some((p) => p.includes('Filter')), 'the kick keeps its bottom end');
  assert.ok(paths.some((p) => p.includes('Reverb(0.9)')), 'a little room');
  assert.ok(!paths.some((p) => p.includes('Reverb(2.2)')), 'but never the hall');
});

test('graph: the hats are filtered and panned, the snare gets more room than the kick', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const hatPaths = routes(played(audio, 'drums', note({ drum: 'hat' }))[0].node);
  assert.ok(hatPaths.every((p) => p.includes('Filter(300 highpass)')), `hats:\n${hatPaths.join('\n')}`);
  assert.ok(hatPaths.every((p) => p.includes('Panner(0.15)')));
  const sendOf = (paths, decay) => paths.find((p) => p.includes(`Reverb(${decay})`))?.match(/Gain\((0\.\d+)\) -> Reverb/)?.[1];
  assert.equal(sendOf(hatPaths, 0.9), String(MIX.strips.hats.room));
  const snare = routes(played(audio, 'drums', note({ drum: 'snare' }))[0].node);
  const kick = routes(played(audio, 'drums', note({ drum: 'kick' }))[0].node);
  assert.ok(Number(sendOf(snare, 0.9)) > Number(sendOf(kick, 0.9)), 'snare more than kick');
});

test('graph: the bass is highpassed, cut in the mud, then ducked BEFORE its compressor', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const paths = routes(played(audio, 'bass', note({ midi: 40 }))[0].node);
  // Two gains in a row = the bus input and the duck gain; the compressor must come after both.
  assert.ok(paths.some((p) => /Filter\(35 highpass\) -> EQ3\(mid -2, high 0\) -> Panner\(0\) -> Gain\(1\) -> Gain\(1\) -> Compressor\(r3\) -> EQ3\(mid 0, high 0\) -> Compressor\(r2\) -> Limiter\(-1\) -> destination/.test(p)),
    `bass routes:\n${paths.join('\n')}`);
  assert.ok(!paths.some((p) => p.includes('Reverb')), 'no reverb on the bass');
});

test('graph: chords and melody get the hall, only the melody gets the delay', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const chords = routes(played(audio, 'chords', note({ midis: [60, 64, 67] }))[0].node);
  assert.ok(chords.every((p) => p.includes('Filter(180 highpass)') && !p.includes('Widener')), `chords:\n${chords.join('\n')}`);
  assert.ok(chords.some((p) => p.includes('Reverb(2.2)')));
  assert.ok(!chords.some((p) => p.includes('PingPongDelay')));
  const melody = routes(played(audio, 'melody', note({ midi: 72 }))[0].node);
  assert.ok(melody.every((p) => p.includes('Filter(220 highpass)') && p.includes('EQ3(mid 0, high -2)')));
  assert.ok(melody.some((p) => p.includes('Reverb(2.2)')));
  assert.ok(melody.some((p) => /PingPongDelay -> Filter\(300 highpass\) -> EQ3/.test(p)), 'the delay comes back through a highpass');
});

test('ducking: every kick dips the bass and chord buses and lets them back up over 120 ms', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const ducked = () => nodes.filter((n) => n.kind === 'Gain' && n.gain.events.length);
  assert.equal(ducked().length, 0, 'nothing is ducked before a kick');
  audio.play('drums', note({ drum: 'kick' }), WHEN(), 500, 'kit-acoustic', 150);
  const gains = ducked();
  assert.equal(gains.length, 2, 'the bass and the chords, nothing else');
  const dips = gains.map((g) => g.gain.events.find((e) => e.op === 'set').v).sort((a, b) => a - b);
  assert.ok(Math.abs(dips[0] - dbToGain(-4)) < 1e-9 && Math.abs(dips[1] - dbToGain(-2)) < 1e-9, `dips ${dips}`);
  for (const g of gains) {
    const [cancel, set, ramp] = g.gain.events;
    assert.equal(cancel.op, 'cancel');
    assert.ok(set.op === 'set' && ramp.op === 'ramp' && ramp.v === 1);
    assert.ok(Math.abs(ramp.t - set.t - 0.12) < 1e-9, 'back up over 120 ms');
    assert.ok(set.t > 0.4, 'scheduled at the kick, not immediately');
  }
  // a hat is not a kick
  const counts = gains.map((g) => g.gain.events.length);
  audio.play('drums', note({ drum: 'hat' }), WHEN(), 100, 'kit-acoustic', 150);
  assert.deepEqual(gains.map((g) => g.gain.events.length), counts);
});

test('kits: three samplers per kit, one per route, and every drum sample is still loaded', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  await audio.ensure('kit-acoustic');
  assert.ok(audio.isReady('kit-acoustic'));
  const kit = nodes.filter((n) => n.kind === 'Sampler' && n.baseUrl.includes('acoustic-kit'));
  assert.equal(kit.length, 3);
  const urls = Object.assign({}, ...kit.map((s) => s.urls));
  assert.deepEqual(Object.keys(urls).sort(), ['A#2', 'B2', 'C2', 'D2', 'D3', 'F#2', 'G2'].sort(), 'same notes as the old single sampler');
  assert.equal(urls['A#2'], 'hihat.mp3', 'the open hat is the hat sample, pitched down');
  const sent = (drum) => played(audio, 'drums', note({ drum }), 'kit-acoustic')[0].node;
  assert.notEqual(sent('kick'), sent('snare'));
  assert.equal(sent('tom1'), sent('snare'), 'toms go with the snare');
  assert.equal(sent('ohat'), sent('hat'), 'the open hat goes with the hats');
  assert.ok(routes(sent('hat')).every((p) => p.includes('Filter(300 highpass)')));
  assert.ok(routes(sent('kick')).every((p) => !p.includes('Filter')));
  // the kits have no crash sample: it is synthesised into the hats strip, whatever kit is playing
  const crash = played(audio, 'drums', note({ drum: 'crash' }), 'kit-acoustic');
  assert.equal(crash.length, 1);
  assert.equal(crash[0].node.kind, 'NoiseSynth');
  assert.ok(routes(crash[0].node).every((p) => /Filter\(5000 highpass\) -> Filter\(300 highpass\) -> Panner\(0.15\)/.test(p)), routes(crash[0].node).join('\n'));
});

test('velocity and strum reach the instruments: vel ** 1.6, one trigger per chord pitch', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const [hit] = played(audio, 'bass', note({ midi: 40, vel: 0.5 }));
  assert.ok(Math.abs(hit.args[3] - 0.5 ** 1.6) < 1e-9, `gain ${hit.args[3]}`);
  const strum = played(audio, 'chords', note({ midis: [60, 64, 67], offsets: [0, 0.05, 0.1], dur: 8 }));
  assert.equal(strum.length, 3, 'each pitch triggered on its own');
  const times = strum.map((s) => s.args[2]);
  assert.ok(times[1] - times[0] > 0.006 && times[2] - times[1] > 0.006, `strum times ${times}`);
  assert.ok(times[2] - times[0] < 0.03, 'and the whole strum stays inside 30 ms');
  // without offsets every pitch lands together
  const block = played(audio, 'chords', note({ midis: [60, 64, 67], dur: 8 }));
  assert.equal(new Set(block.map((s) => s.args[2])).size, 1);
});

test('lite graph: built without the hall, and it can drop to lite while playing', async (t) => {
  const liteAudio = await makeAudio({ lite: true });
  t.after(() => liteAudio.dispose());
  assert.equal(liteAudio.isLite(), true);
  assert.equal(nodes.filter((n) => n.kind === 'Reverb').length, 1, 'one reverb on a weak device');
  assert.equal(nodes.filter((n) => n.kind === 'StereoWidener').length, 0);
  const chords = routes(played(liteAudio, 'chords', note({ midis: [60, 64] }))[0].node);
  assert.ok(chords.every((p) => !p.includes('Reverb(2.2)')) && chords.some((p) => p.includes('Limiter(-1)')));
  assert.equal(liteAudio.setLite(), false, 'already lite');

  const audio = await makeAudio({ lite: false });
  t.after(() => audio.dispose());
  const hall = nodes.find((n) => n.kind === 'Reverb' && n.opts.decay === 2.2);
  const sends = nodes.filter((n) => n.kind === 'Gain' && n.outs.includes(hall));
  assert.equal(sends.length, 2, 'the chords and the melody send to the hall');
  assert.equal(audio.setLite(), true);
  assert.equal(audio.isLite(), true);
  for (const g of sends) assert.ok(g.gain.events.some((e) => e.op === 'rampTo' && e.v === 0), 'hall send faded out');
  for (const w of nodes.filter((n) => n.kind === 'StereoWidener')) assert.ok(w.wet.events.some((e) => e.v === 0));
  await new Promise((done) => setTimeout(done, 900));
  assert.equal(hall.disposed, true, 'a silent convolver still costs CPU, so it goes');
});

test('the final node is still Tone.getDestination(), which the visuals tap', async (t) => {
  const audio = await makeAudio();
  t.after(() => audio.dispose());
  const limiter = nodes.find((n) => n.kind === 'Limiter');
  assert.ok(limiter.outs.includes(DEST));
  // the meters and the recorder read the destination, not the limiter
  assert.ok(nodes.some((n) => n.kind === 'Analyser') && nodes.some((n) => n.kind === 'Meter'));
  assert.equal(audio.canRecord(), true);
  const blob = await audio.recordClip(0.01);
  assert.equal(blob.type, 'audio/webm');
});
