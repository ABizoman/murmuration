// The "Tell your agent" box, extended: instruments, parts playing off each other, the whole song,
// the AI's answers, commands sent between devices, and the agent pins they set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstruction, sanitiseCommand, applyChanges, matchVoice } from '../src/ui/instructions.js';
import { buildInstructQuestions, commandFromAnswers } from '../src/ui/interpret.js';
import { Director, proposalOrder } from '../src/decide/director.js';
import { Agent } from '../src/agent.js';
import { createLibrary, ROLES } from '../src/loops.js';
import { PACK_LOOPS } from '../src/packs.js';
import { buildContext } from '../src/decide/context.js';
import { structureFromSeed, seededRandom } from '../src/seed.js';

const fresh = () => Object.fromEntries(ROLES.map((r) => [r, { auto: true, level: 2, register: 0, voice: null }]));
const setOf = (cmd, role) => cmd.changes.find((c) => c.role === role)?.set;

test('instruments: "play it on piano", "switch the chords to strings", "make the melody a sax"', () => {
  assert.equal(setOf(parseInstruction('play it on piano', fresh(), ['chords']), 'chords').pinVoice, 'keys-piano');
  const strings = parseInstruction('switch the chords to strings', fresh(), ['bass']);
  assert.deepEqual(strings.changes, [{ role: 'chords', set: { pinVoice: 'strings' } }], 'the pad is not a second part here');
  assert.equal(setOf(parseInstruction('make the melody a sax', fresh()), 'melody').pinVoice, 'sax-alto');
  assert.equal(setOf(parseInstruction('use a synth for the bass', fresh()), 'bass').pinVoice, 'synth-bass');
  assert.equal(setOf(parseInstruction('drums on house kit', fresh()), 'drums').pinVoice, 'kit-house');
  assert.equal(setOf(parseInstruction('organ', fresh(), ['chords']), 'chords').pinVoice, 'organ', 'an instrument name alone, for my part');
  const a = fresh();
  a.chords.voice = 'keys-piano';
  assert.equal(setOf(parseInstruction('different instrument', a, ['chords']), 'chords').pinVoice, 'keys-epiano', 'the next one in the list');
  const both = setOf(parseInstruction('melody on trumpet and busier', fresh()), 'melody');
  assert.deepEqual(both, { auto: false, level: 3, register: 0, pinVoice: 'trumpet' });
  assert.match(parseInstruction('play it on piano', fresh(), ['chords']).summary, /chords: on Grand piano/);
  assert.equal(matchVoice(' purple ', 'chords'), null);
});

test('pairings: "melody answer the bass", "have the bass copy the drums", "stop echoing"', () => {
  assert.deepEqual(parseInstruction('melody answer the bass', fresh()).changes, [{ role: 'melody', set: { pinInteraction: 'answer:bass' } }]);
  assert.deepEqual(parseInstruction('have the bass copy the drums', fresh()).changes, [{ role: 'bass', set: { pinInteraction: 'echo:drums' } }]);
  assert.deepEqual(parseInstruction('stop echoing', fresh(), ['chords']).changes, [{ role: 'chords', set: { pinInteraction: null } }], 'not "stop playing"');
  assert.equal(parseInstruction('stop echoing', fresh(), ['chords']).stop, false);
  assert.deepEqual(parseInstruction('the melody stops copying the bass', fresh()).changes, [{ role: 'melody', set: { pinInteraction: null } }]);
  assert.match(parseInstruction('melody answer the bass', fresh()).summary, /melody: answers the bass/);
});

test('the whole song: build up, bring down, spotlight; old behaviour kept', () => {
  const up = parseInstruction('build it up', fresh(), ['melody']);
  assert.deepEqual(up.song, { energy: 1, feature: null, note: 'Build it up' });
  assert.deepEqual(setOf(up, 'melody'), { auto: false, level: 3, register: 0 }, 'my part still gets busier');
  assert.equal(parseInstruction('bring it down', fresh(), ['melody']).song.energy, 0.15);
  assert.equal(parseInstruction('spotlight on the bass', fresh()).song.feature, 'bass');
  assert.deepEqual(parseInstruction('spotlight on the bass', fresh()).changes, []);
  assert.equal(parseInstruction('more drums', fresh()).song, null);
  assert.equal(parseInstruction('stop', fresh()).stop, true);
  assert.equal(parseInstruction('purple monkey', fresh()).understood, false);
});

test('commands from other devices are bounded, and applied to every agent copy', () => {
  const raw = { text: 'x<script>', changes: [
    { role: 'melody', set: { pinVoice: 'trumpet', pinInteraction: 'answer:bass', level: 9 } },
    { role: 'bass', set: { pinVoice: 'grand-piano-nope', pinInteraction: 'answer:bass' } },
    { role: 'drums', set: { auto: false, level: 3, register: 0 } },
    { role: 'nope', set: { auto: true } },
  ], song: { energy: 7, feature: 'kazoo' } };
  const c = sanitiseCommand(raw);
  assert.deepEqual(c.changes, [
    { role: 'melody', set: { pinVoice: 'trumpet', pinInteraction: 'answer:bass' } },
    { role: 'drums', set: { auto: false, level: 3, register: 0 } },
  ]);
  assert.deepEqual(c.song, { energy: 1, feature: null, note: '' });
  assert.equal(c.text, 'xscript');
  assert.equal(sanitiseCommand(null), null);
  const agents = fresh();
  applyChanges(c.changes, agents);
  assert.equal(agents.melody.pinVoice, 'trumpet');
  assert.equal(agents.drums.level, 3);
  assert.equal(agents.drums.auto, false);
});

test('the AI answers choice questions; the answers become the same kind of command', () => {
  const { state, questions } = buildInstructQuestions({ text: 'make it feel like a sunset', mine: ['chords'], agents: fresh() });
  assert.match(state, /make it feel like a sunset/);
  assert.deepEqual(Object.keys(questions), ['target', 'level', 'register', 'instrument', 'interaction', 'song']);
  for (const q of Object.values(questions)) assert.ok(q.type === 'choice' && Object.keys(q.criteria).length >= 3);
  assert.ok('answer_bass' in questions.interaction.criteria && 'electric_piano' in questions.instrument.criteria);
  const cmd = commandFromAnswers({ target: { pad: 0.8, mine: 0.2 }, level: { calmer: 0.6 }, register: { higher: 0.7 }, instrument: { strings: 0.9 }, interaction: { echo_melody: 0.6 }, song: { calm: 0.7 } }, { agents: fresh(), mine: ['chords'] });
  assert.deepEqual(cmd.changes, [{ role: 'pad', set: { auto: false, level: 1, register: 1, pinVoice: 'pad-strings', pinInteraction: 'echo:melody' } }]);
  assert.equal(cmd.song.energy, 0.15);
  assert.ok(cmd.understood);
  const nothing = commandFromAnswers({ target: { mine: 1 }, level: { same: 1 }, register: { same: 1 }, instrument: { same: 1 }, interaction: { none: 1 }, song: { none: 1 } }, { agents: fresh(), mine: ['chords'] });
  assert.equal(nothing.understood, false, 'an answer that changes nothing is "didn\'t catch that"');
  const self = commandFromAnswers({ target: { bass: 1 }, interaction: { answer_bass: 1 } }, { agents: fresh() });
  assert.equal(self.understood, false, 'a part never answers itself');
});

test('director: a typed request beats the LLM, the newest request wins, and it is adopted', () => {
  const sent = [];
  let now = 1000;
  const d = new Director({ id: 'me', now: () => now, publish: (b) => sent.push(b), liveCount: () => 1, request: async () => ({}) });
  d.onProposal({ type: 'proposal', section: 1, pid: 'llm:1', by: 'x', ts: 10, directive: { energy: 0.4 }, source: 'gemini' });
  assert.equal(d.directiveFor(4).energy, 0.4);
  now = 2000;
  d.propose(4, { energy: 1, feature: 'bass', note: 'Build it up' });
  assert.equal(d.directiveFor(4).energy, 1);
  assert.equal(d.directiveFor(4).feature, 'bass');
  now = 3000;
  d.propose(5, { energy: 0.15, note: 'Bring it down' });
  assert.equal(d.directiveFor(5).energy, 0.15, 'a newer request for the same section wins');
  assert.ok(sent.some((b) => b.type === 'proposal' && b.source === 'request'), 'gossiped so the swarm votes');
  d.onProposal({ type: 'proposal', section: 2, pid: 'llm:2', by: 'x', ts: 4000, directive: { energy: 0.5 }, source: 'gemini' });
  assert.equal(d.directiveFor(8).energy, 0.15, 'it also covers the next section, over the LLM');
  const sorted = [{ source: 'gemini', ts: 1, pid: 'a' }, { source: 'request', ts: 5, pid: 'b' }, { source: 'request', ts: 9, pid: 'c' }].sort(proposalOrder);
  assert.deepEqual(sorted.map((p) => p.pid), ['c', 'b', 'a']);
});

test('agent: an asked-for instrument applies from the next phrase, even mid-section; a pairing too', () => {
  const structure = structureFromSeed('instruct');
  const library = createLibrary({ packs: PACK_LOOPS });
  const agent = new Agent('melody', library, seededRandom('t', 'melody'));
  const peers = {};
  const bass = [0, 8, 16, 24, 32, 40, 48, 56].map((step) => ({ step, dur: 4, vel: 0.8, midi: 40 }));
  // phrase 6: mid-section (verse2 1 of 2), where the rules would keep the instrument
  const last = { phrase: 5, voice: 'sax-alto', voiceSince: 2, level: 2, register: 0, style: 'riff', interaction: 'none', notes: [{ step: 0, dur: 4, vel: 0.7, midi: 72 }] };
  const lookup = (p, r) => (r === 'melody' && p === 5 ? { ...last, d: last } : r === 'bass' && p === 6 ? { notes: bass, d: { level: 2, voice: 'bass-electric', register: 0, interaction: 'none', style: 'pulse' }, phrase: 6 } : null);
  const ctx = () => buildContext({ role: 'melody', phrase: 6, structure, roles: ROLES, lookup, directive: null });
  agent.pinVoice = 'trumpet';
  agent.pinInteraction = 'answer:bass';
  const part = agent.compose(ctx());
  assert.equal(part.d.voice, 'trumpet');
  assert.equal(part.d.interaction, 'answer:bass');
  agent.pinVoice = null;
  agent.pinInteraction = null;
  assert.equal(peers.length, undefined);
});
