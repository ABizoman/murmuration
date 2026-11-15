// Step B (Phase 4) of docs/MUSIC_QUALITY_HANDOFF.md: synth patches, the crash and the riser, and the
// upbeat-pop style family with its instrument and groove stability rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeTone, routes, nodes, triggers } from './fake-tone.mjs';
import { createLibrary, ROLES } from '../src/loops.js';
import { PACK_LOOPS } from '../src/packs.js';
import { VOICES, voiceById } from '../src/voices.js';
import { STYLE_FAMILIES, familyWeight } from '../src/styles.js';
import { structureFromSeed, seededRandom } from '../src/seed.js';
import { ruleScores, voiceTurn, SECTION_PHRASES } from '../src/decide/rules.js';
import { blend, sample } from '../src/decide/select.js';
import { sanitiseNotes, humanise } from '../src/feel.js';
import { DRUM_STRIP } from '../src/mix.js';
import { Agent } from '../src/agent.js';
import { simulateBand, byRole } from '../tools/sim.mjs';

const FAM = STYLE_FAMILIES['pop-upbeat'];
const packLib = createLibrary({ packs: PACK_LOOPS });
const popStructure = structureFromSeed('durhack#pop');
const ctxFor = (role, extra = {}) => ({ role, phrase: 0, structure: popStructure, peers: {}, before: {}, last: null, history: [], directive: null, ...extra });

// ---- voices and patches -------------------------------------------------------------

test('voices: every synth voice names a patch and a family; ids are never shared across roles', () => {
  const seen = new Set();
  for (const [role, list] of Object.entries(VOICES)) for (const v of list) {
    assert.ok(!seen.has(v.id), `${v.id} is used twice`);
    seen.add(v.id);
    assert.ok(v.family, `${v.id} has a family`);
    if (v.synth != null) assert.equal(typeof v.synth, 'string', `${v.id}: synth names a patch`);
  }
  assert.equal(voiceById['synth-keys'].family, 'keys', 'synth keys strum like a piano');
  assert.equal(voiceById['melody-epiano'].dir, voiceById['keys-epiano'].dir, 'the melody e-piano uses the same samples');
  for (const role of ROLES) for (const id of Object.keys(FAM.voices[role])) assert.ok(VOICES[role].some((v) => v.id === id), `${role}: ${id} exists`);
});

async function makeAudio() {
  globalThis.window = { Tone: makeFakeTone() };
  const mod = await import(`../src/audio.js?${Math.random()}`);
  return { audio: await mod.createAudio({ onStatus: () => {}, lite: false }), mod };
}
const WHEN = () => performance.timeOrigin + performance.now() + 500;
const played = (audio, role, n, voice, durMs = 500) => {
  const before = triggers.length;
  audio.play(role, { step: 0, dur: 4, vel: 0.9, ...n }, WHEN(), durMs, voice, 150);
  return triggers.slice(before);
};
const STRIP_OF = { bass: 'Filter(35 highpass)', chords: 'Filter(180 highpass)', melody: 'Filter(220 highpass)' };

test('patches: each synth voice plays through its own patch into its role strip', async (t) => {
  const { audio } = await makeAudio();
  t.after(() => audio.dispose());
  const cases = [
    ['bass', 'synth-bass', { midi: 40 }],
    ['chords', 'synth-pad', { midis: [60, 64, 67] }],
    ['chords', 'synth-keys', { midis: [60, 64, 67] }],
    ['melody', 'synth-lead', { midi: 76 }],
    ['melody', 'synth-pluck', { midi: 76 }],
  ];
  const first = new Map();
  for (const [role, id, n] of cases) {
    const hits = played(audio, role, n, id);
    assert.ok(hits.length >= 1, `${id} plays`);
    for (const h of hits) assert.ok(routes(h.node).every((p) => p.includes(STRIP_OF[role]) && p.endsWith('destination')), `${id}:\n${routes(h.node).join('\n')}`);
    first.set(id, hits[0].node);
  }
  assert.notEqual(first.get('synth-pad'), first.get('synth-keys'), 'one patch per voice');
  assert.notEqual(first.get('synth-lead'), first.get('synth-pluck'));
  // built once, then reused
  const count = nodes.length;
  played(audio, 'chords', { midis: [62, 65] }, 'synth-pad');
  assert.equal(nodes.length, count, 'no new nodes for a second chord');
});

test('patches: the pad is the stereo one (chorus), polyphony is capped, the lead gets vibrato', async (t) => {
  const { audio } = await makeAudio();
  t.after(() => audio.dispose());
  const pad = played(audio, 'chords', { midis: [60, 64, 67] }, 'synth-pad')[0].node;
  assert.equal(pad.opts.maxPolyphony, 12);
  assert.equal(pad.opts.oscillator.type, 'sawtooth', 'one saw per note: the CPU fix (the chorus gives the width)');
  assert.ok(routes(pad).every((p) => /Filter\(1600 lowpass\) -> Chorus/.test(p)));
  const chorus = nodes.find((n) => n.kind === 'Chorus');
  assert.ok(chorus.started != null, 'a Tone.Chorus does nothing until started');
  assert.equal(chorus.opts.wet, 0.4);
  assert.equal(played(audio, 'chords', { midis: [60, 64] }, 'synth-keys')[0].node.voice, 'FMSynth');
  const pluck = played(audio, 'melody', { midi: 76 }, 'synth-pluck')[0].node;
  assert.equal(pluck.opts.maxPolyphony, 6);
  assert.ok(routes(pluck).every((p) => p.includes('Filter(2200 lowpass)')));
  assert.equal(pluck.opts.oscillator.type, 'triangle');
  // the stab: plain voices into one shared filter, whose envelope fires once per chord
  const hits = played(audio, 'chords', { midis: [60, 64, 67] }, 'synth-stab');
  assert.equal(hits.filter((h) => h.node.kind === 'FrequencyEnvelope').length, 1, 'one filter envelope per chord');
  const stab = hits.find((h) => h.node.kind === 'PolySynth').node;
  assert.equal(stab.voice, 'Synth');
  assert.ok(routes(stab).every((p) => p.includes('Filter(300 lowpass)')));
  assert.equal(nodes.filter((n) => n.kind === 'FrequencyEnvelope').length, 1);
  played(audio, 'melody', { midi: 76 }, 'synth-lead', 800);
  const vib = nodes.find((n) => n.kind === 'Vibrato');
  const [cancel, set, ramp] = vib.depth.events;
  assert.ok(cancel.op === 'cancel' && set.v === 0 && ramp.op === 'ramp' && ramp.v === 0.08);
  assert.ok(Math.abs(ramp.t - set.t - 0.3) < 1e-9, 'the vibrato fades in over 300 ms');
});

test('patches: the synth bass is a saw plus a sine sub an octave down', async (t) => {
  const { audio } = await makeAudio();
  t.after(() => audio.dispose());
  const hits = played(audio, 'bass', { midi: 40 }, 'synth-bass');
  assert.equal(hits.length, 2);
  const [a, b] = hits.map((h) => h.args[0]).sort((x, y) => x - y);
  assert.ok(Math.abs(b / a - 2) < 1e-9, 'an octave apart');
  const sub = hits.find((h) => h.node.opts.oscillator.type === 'sine').node;
  assert.equal(sub.volume.value, -2, 'a deep sub');
  assert.equal(hits.find((h) => h.node.opts.oscillator.type === 'sawtooth').node.opts.portamento, 0.02);
});

test('patches: a sampled voice that is still loading plays through the role default patch', async (t) => {
  const { audio, mod } = await makeAudio();
  t.after(() => audio.dispose());
  assert.equal(mod.patchFor('keys-piano', 'chords'), 'pad');
  assert.equal(mod.patchFor('synth-keys', 'chords'), 'keys');
  assert.equal(mod.patchFor('trumpet', 'melody'), 'lead');
  assert.equal(mod.patchFor(null, 'bass'), 'bass');
  const hit = played(audio, 'chords', { midis: [60, 64] }, 'keys-piano')[0];
  assert.equal(hit.node.kind, 'PolySynth', 'the pad covers until the piano loads');
});

test('crash and riser: synthesised, routed into the hats strip, riser sweeps and rises over its length', async (t) => {
  const { audio } = await makeAudio();
  t.after(() => audio.dispose());
  assert.equal(DRUM_STRIP.crash, 'hats');
  assert.equal(DRUM_STRIP.riser, 'hats');
  const crash = played(audio, 'drums', { drum: 'crash', vel: 0.8 }, 'kit-breakbeat');
  assert.equal(crash[0].node.kind, 'NoiseSynth');
  assert.ok(routes(crash[0].node).every((p) => p.includes('Filter(5000 highpass)') && p.includes('Panner(0.15)')));
  const before = nodes.length;
  played(audio, 'drums', { drum: 'riser', dur: 16, vel: 0.8 }, 'kit-breakbeat', 2400);
  const made = nodes.slice(before);
  const noise = made.find((n) => n.kind === 'Noise');
  const band = made.find((n) => n.kind === 'Filter' && n.opts.type === 'bandpass');
  const out = made.find((n) => n.kind === 'Gain');
  assert.ok(noise && band && out, 'noise -> bandpass -> gain');
  assert.ok(noise.started != null && noise.stopped - noise.started > 2.3, 'plays the whole note');
  const sweep = band.frequency.events;
  assert.equal(sweep[0].v, 300);
  assert.ok(sweep[1].op === 'exp' && sweep[1].v === 6000 && Math.abs(sweep[1].t - sweep[0].t - 2.4) < 1e-9);
  const g = out.gain.events;
  assert.ok(g[1].v > g[0].v * 5, 'it gets louder');
  assert.equal(g[2].v, 0, 'and is cut at the end');
  assert.ok(routes(noise).every((p) => p.includes('Filter(300 highpass) -> Panner(0.15)')), routes(noise).join('\n'));
});

test('crash and riser: placed exactly, survive gossip', () => {
  const notes = [{ step: 0, dur: 4, vel: 0.95, drum: 'crash' }, { step: 48, dur: 16, vel: 0.8, drum: 'riser' }, { step: 4, dur: 1, vel: 0.8, drum: 'snare' }];
  const out = humanise(notes, { role: 'drums', phrase: 3, seed: 's' });
  assert.equal(out[0].nudge, undefined);
  assert.equal(out[0].vel, 0.8);
  assert.equal(out[1].nudge, undefined);
  assert.equal(out[1].vel, 0.8);
  assert.ok(out[2].nudge > 0, 'the snare still lays back');
  const back = sanitiseNotes(out);
  assert.deepEqual(back.map((n) => n.drum), ['crash', 'riser', 'snare']);
  assert.equal(back[1].dur, 16);
});

// ---- the style family -----------------------------------------------------------------

test('family: the seed gives upbeat-pop tempo, mostly major, the family recorded; songs have none', () => {
  const all = Array.from({ length: 400 }, (_, i) => structureFromSeed(`f${i}#pop`));
  for (const s of all) {
    assert.equal(s.family, 'pop-upbeat');
    assert.ok(s.bpm >= 104 && s.bpm <= 124, `bpm ${s.bpm}`);
    assert.ok(s.swing >= 0 && s.swing <= 0.06);
  }
  const major = all.filter((s) => s.mode === 'major').length / all.length;
  assert.ok(major > 0.67 && major < 0.83, `major share ${major}`);
  const own = all.filter((s) => FAM.progressions[s.mode].some((p) => p.join() === s.progression.join())).length / all.length;
  assert.ok(own > 0.55 && own < 0.8, `family progressions ${own}`);
  assert.equal(new Set(all.map((s) => s.key)).size, 12);
  assert.equal(structureFromSeed('song:ode-to-joy').family, undefined);
});

test('family: weights are applied, nothing ever gets zero options', () => {
  assert.equal(familyWeight(FAM, 'styles', 'drums', 'groove-pop'), 3);
  assert.equal(familyWeight(FAM, 'styles', 'drums', 'groove-jazz'), FAM.unlisted);
  assert.equal(familyWeight(null, 'styles', 'drums', 'groove-jazz'), 1);
  const plain = { ...popStructure, family: undefined };
  for (const role of ROLES) {
    const fam = ruleScores(ctxFor(role, { phrase: 3 }), packLib);
    const none = ruleScores(ctxFor(role, { phrase: 3, structure: plain }), packLib);
    for (const q of ['style', 'voice']) {
      assert.ok(Object.values(fam[q]).some((w) => w > 0), `${role} ${q} has options`);
      assert.equal(Object.keys(fam[q]).length, Object.keys(none[q]).length, 'soft: nothing is removed');
    }
    // the ratio between a listed and an unlisted style is the family's
    const listed = Object.keys(FAM.styles[role]).find((s) => s in fam.style);
    const unlisted = Object.keys(fam.style).find((s) => FAM.styles[role][s] == null);
    if (listed && unlisted) {
      const r = (x) => x.style[listed] / x.style[unlisted];
      assert.ok(Math.abs(r(fam) / r(none) - FAM.styles[role][listed] / FAM.unlisted) < 1e-6, role);
    }
  }
});

test('family: unlisted instruments are possible but rare (10,000 draws)', () => {
  const random = seededRandom('draws');
  for (const role of ROLES) {
    const dist = blend(ruleScores(ctxFor(role), packLib).voice, null);
    let off = 0;
    for (let i = 0; i < 10000; i++) if (FAM.voices[role][sample(dist, random)] == null) off++;
    assert.ok(off > 0 || VOICES[role].every((v) => FAM.voices[role][v.id] != null), `${role}: unlisted never drawn`);
    assert.ok(off / 10000 < 0.05, `${role}: unlisted ${off}/10000`);
  }
});

// ---- stability ------------------------------------------------------------------------

const summary = (role, phrase, voice, voiceSince) => ({ role, phrase, voice, voiceSince, level: 2, notes: [{}] });

test('voiceTurn: only at a section start, only after two sections, longest first, ties rotate', () => {
  // the extra layers changed instrument recently in these cases, so the core band's turn is tested
  const before = (since) => Object.fromEntries(ROLES.map((r) => [r, summary(r, 7, VOICES[r][0].id, since[r] ?? Math.max(0, (since.at ?? 12) - 4))]));
  const ctx = (role, phrase, since) => { const b = before(since); for (const r of ROLES) b[r].phrase = phrase - 1; return { role, phrase, last: b[role], before: b }; };
  assert.equal(voiceTurn(ctx('bass', 9, { drums: 0, bass: 0, chords: 0, melody: 0 })), null, 'not a section start');
  assert.equal(voiceTurn(ctx('bass', 4, { drums: 0, bass: 0, chords: 0, melody: 0 })), null, 'nobody has held two sections yet');
  assert.equal(voiceTurn(ctx('bass', 12, { drums: 8, bass: 0, chords: 4, melody: 4 })), 'bass', 'the longest-held goes first');
  // every role computes the same answer
  for (const r of ROLES) assert.equal(voiceTurn(ctx(r, 12, { drums: 8, bass: 0, chords: 4, melody: 4 })), 'bass');
  // all tied: the rotation picks a different role at successive section starts
  const all0 = Object.fromEntries(ROLES.map((r) => [r, 0]));
  const tied = [16, 20, 24, 28, 32, 36, 40].map((p) => voiceTurn(ctx('drums', p, all0)));
  assert.equal(new Set(tied).size, ROLES.length, `turns ${tied}`);
});

test('stability: instruments change only at section starts, one part at a time, two sections apart', () => {
  for (const seed of ['durhack', 'pop1', 'pop2']) {
    const series = byRole(simulateBand({ seed: `${seed}#pop`, rng: `stab-${seed}`, phrases: 48 }).parts);
    const voiceAt = (r, p) => series[r].find((x) => x.phrase === p)?.part.d.voice;
    let total = 0;
    for (let p = 1; p < 48; p++) {
      const changed = ROLES.filter((r) => voiceAt(r, p - 1) && voiceAt(r, p) && voiceAt(r, p - 1) !== voiceAt(r, p));
      if (p % SECTION_PHRASES) assert.deepEqual(changed, [], `${seed} phrase ${p}: mid-section change`);
      assert.ok(changed.length <= 1, `${seed} phrase ${p}: ${changed.join(', ')} changed together`);
      total += changed.length;
    }
    for (const r of ROLES) {
      const at = [];
      for (let p = 1; p < 48; p++) if (voiceAt(r, p - 1) && voiceAt(r, p) && voiceAt(r, p - 1) !== voiceAt(r, p)) at.push(p);
      for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 2 * SECTION_PHRASES, `${seed} ${r}: changes at ${at}`);
    }
    assert.ok(total >= 3, `${seed}: the band still changes instruments (${total})`);
  }
});

test('stability: drums and bass keep their style for the section unless the energy jumps', () => {
  const last = { role: 'drums', phrase: 5, level: 2, style: 'groove-pop', register: 0, voice: 'kit-breakbeat', voiceSince: 0, notes: [{ step: 0 }], onsets: [] };
  const base = { phrase: 6, last, history: [last], directive: { energy: 0.5 }, prevDirective: { energy: 0.55 } };
  const steady = ruleScores(ctxFor('drums', base), packLib);
  assert.deepEqual(Object.keys(steady.style), ['groove-pop']);
  const jump = ruleScores(ctxFor('drums', { ...base, directive: { energy: 0.95 }, prevDirective: { energy: 0.4 } }), packLib);
  assert.ok(Object.keys(jump.style).length > 1, 'an energy jump frees the groove');
  const boundary = ruleScores(ctxFor('drums', { ...base, phrase: 8 }), packLib);
  assert.ok(Object.keys(boundary.style).length > 1, 'a new section frees it too');
  const melody = ruleScores(ctxFor('melody', { ...base, last: { ...last, role: 'melody', style: 'pop909' } }), packLib);
  assert.ok(Object.keys(melody.style).length > 1, 'the melody is not locked');
});

test('?voice=: pinning an instrument keeps everything else automatic', () => {
  const s = structureFromSeed('pin');
  const agent = new Agent('chords', packLib, seededRandom('pin'));
  agent.pinVoice = 'synth-pad';
  for (let phrase = 0; phrase < 6; phrase++) {
    const part = agent.compose({ role: 'chords', phrase, structure: s, peers: {}, before: {}, last: null, history: [], directive: null });
    assert.equal(part.d.voice, 'synth-pad');
  }
  assert.equal(agent.auto, true);
});

test('dance: the default when improvising; minor, 118-124 bpm, house bass, short riffs that may repeat', async () => {
  const { withStyle } = await import('../src/seed.js');
  const D = STYLE_FAMILIES.dance;
  const all = Array.from({ length: 300 }, (_, i) => structureFromSeed(`d${i}`));
  for (const s of all) {
    assert.equal(s.family, 'dance');
    assert.ok(s.bpm >= 118 && s.bpm <= 124, `bpm ${s.bpm}`);
  }
  const minor = all.filter((s) => s.mode === 'minor').length / all.length;
  assert.ok(minor > 0.75, `minor share ${minor}`);
  assert.equal(structureFromSeed('d1#pop').family, 'pop-upbeat');
  assert.equal(structureFromSeed('d1#dance').family, 'dance');
  assert.equal(structureFromSeed('d1').key, structureFromSeed('d1#pop').key, 'the key does not depend on the style');
  assert.equal(withStyle('d1', 'pop'), 'd1#pop');
  assert.equal(withStyle('d1#pop#end', 'dance'), 'd1#end');
  // the new loops are there, and only chord notes in the riffs
  const lib = createLibrary();
  assert.ok(lib.styles('bass').includes('offbeat') && lib.styles('melody').includes('riff'));
  for (const l of lib.loops.filter((x) => x.style === 'riff')) for (const e of l.events) assert.ok([0, 2, 4, 7].includes(e.deg), `${l.id} ${e.deg}`);
  for (const l of lib.loops.filter((x) => x.style === 'offbeat')) for (const e of l.events) assert.equal(e.step % 4, 2, 'on the off-beats');
  // a run: dance styles and instruments, a melody that never goes busy
  const { parts } = simulateBand({ seed: 'dancerun', rng: 'dance', phrases: 24 });
  const playing = parts.filter((x) => x.part.notes.length && !x.part.d.style.startsWith('end'));
  const on = playing.filter((x) => D.styles[x.role][x.part.d.style] != null).length / playing.length;
  assert.ok(on > 0.95, `on-style ${on}`);
  assert.ok(playing.filter((x) => x.role === 'melody').every((x) => x.part.d.level <= 2), 'the melody stays simple');
  assert.ok(playing.some((x) => x.role === 'bass' && x.part.d.style === 'offbeat'), 'the house bass is used');
});

test('riffs: a few dozen to choose from, so improvised songs do not all share one melody', () => {
  const lib = createLibrary();
  const riffs = lib.loops.filter((l) => l.style === 'riff');
  assert.ok(riffs.length >= 24, `${riffs.length} riffs`);
  const shapes = new Set(riffs.map((l) => JSON.stringify(l.events.map((e) => [e.bar, e.step, e.deg]))));
  assert.equal(shapes.size, riffs.length, 'all different');
  for (const d of ['sparse', 'medium']) assert.ok(riffs.filter((l) => l.density === d).length >= 5, d);
  // different seeds end up with different chorus riffs
  const hooks = new Set();
  for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
    const { engine } = simulateBand({ seed, rng: `riff-${seed}`, phrases: 7 });
    hooks.add(engine.hooks.get('melody')?.loopId);
  }
  assert.ok(hooks.size >= 4, `chorus hooks: ${[...hooks].join(', ')}`);
});
