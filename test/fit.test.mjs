// Phase 3 of docs/MUSIC_QUALITY_PLAN.md: listening before you play.
//   src/decide/fit.js      scores a candidate part against the chords and the other parts
//   src/decide/select.js   draws the candidates and picks one (likely AND fitting)
//   src/agent.js           renders K of them per phrase and plays the winner
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScore, describeFit, metric, onsets, jaccard, inRange, spread, WEIGHTS, TERMS } from '../src/decide/fit.js';
import { candidateDecisions, candidatePrior, pickCandidate, CANDIDATE_QUESTIONS, CONTINUITY_BONUS } from '../src/decide/select.js';
import { createLibrary, ROLES } from '../src/loops.js';
import { Agent, CANDIDATES } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';
import { structureFromSeed, randomFor } from '../src/seed.js';

// C major: I = C E G (+B as the seventh), V = G B D, vi = A C E, IV = F A C
const structure = { seed: 't', key: 'C', mode: 'major', bpm: 110, progression: ['I', 'V', 'vi', 'IV'], swing: 0 };
const lib = createLibrary();
const rng = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ctxFor = (role, peers = {}, extra = {}) => ({ role, phrase: 0, structure, peers, last: null, history: [], ...extra });
const score = (notes, role, peers = {}, extra = {}) =>
  fitScore(notes, { role, ctx: ctxFor(role, peers, extra), d: extra.d ?? null });
const peer = (role, notes, { phrase = 0, level = 2, interaction = 'none' } = {}) => ({ role, phrase, notes, level, interaction, by: 'x' });
const hold = (midi, step = 0, dur = 16) => ({ step, dur, vel: 0.7, midi });
const chordHold = (midis, step = 0, dur = 16) => ({ step, dur, vel: 0.7, midis });
const drum = (name, step, vel = 0.8) => ({ step, dur: 1, vel, drum: name });

test('metric strength is the plan\'s table, and the helpers behave', () => {
  assert.equal(metric(0), 1);
  assert.equal(metric(8), 0.8);
  assert.equal(metric(4), 0.6);
  assert.equal(metric(12), 0.6);
  assert.equal(metric(2), 0.35);
  assert.equal(metric(6), 0.35);
  assert.equal(metric(1), 0.2);
  assert.equal(metric(16), 1, 'the second bar starts strong too');
  assert.equal(metric(48 + 7), 0.2);
  assert.deepEqual(onsets([hold(60, 0, 4), hold(62, 5, 1)]).slice(0, 7), [1, 0, 0, 0, 0, 1, 0]);
  assert.equal(onsets([drum('kick', 0), drum('hat', 2)], (n) => n.drum === 'kick')[2], 0);
  assert.equal(jaccard([1, 0, 1], [1, 0, 1]), 1);
  assert.equal(jaccard([1, 1, 0], [0, 1, 1]), 1 / 3);
  assert.equal(jaccard([0, 0], [0, 0]), null, 'nothing to compare');
  assert.equal(inRange([0.4, 0.75], 0.5), 1);
  assert.equal(inRange([0.4, 0.75], 0.4), 1);
  assert.ok(Math.abs(inRange([0.4, 0.75], 0.25) - 0.5) < 1e-9, 'half a window below');
  assert.equal(inRange([0.4, 0.75], 0.05), 0);
  assert.deepEqual(spread([hold(60), hold(64), hold(67)]), { lo: 60, hi: 67, mean: (60 + 64 + 67) / 3 });
  assert.equal(spread([drum('kick', 0)]), null);
});

test('harmony: chord tones beat chromatic notes on the same rhythm', () => {
  const rhythm = [0, 16, 32, 48];
  const tones = [60, 67, 69, 65].map((m, i) => hold(m, rhythm[i], 8)); // C over I, G over V, A over vi, F over IV
  const chromatic = [61, 66, 70, 63].map((m, i) => hold(m, rhythm[i], 8)); // none in the chord
  const good = score(tones, 'melody').terms.harmony;
  const bad = score(chromatic, 'melody').terms.harmony;
  assert.equal(good, 1);
  assert.ok(bad < 0.1, `chromatic scored ${bad}`);
  assert.ok(good > bad + 0.8);
  // a passing note on a weak step that steps into a chord tone is forgiven; on a downbeat it is not
  assert.equal(score([hold(60, 0, 2), hold(63, 2, 2), hold(64, 4, 12)], 'melody').terms.harmony, 1, 'D# steps into E');
  // only a note that resolves straight into a chord tone counts, so a chromatic run still costs a little
  const run = score([hold(60, 0, 2), hold(61, 2, 1), hold(62, 3, 1), hold(64, 4, 4)], 'melody').terms.harmony;
  assert.ok(run > 0.85 && run < 1, `chromatic run ${run}`);
  const landed = [hold(61, 0, 4), hold(64, 4, 4)];
  assert.ok(score(landed, 'melody').terms.harmony < 0.6, 'the same note on beat 1 is not a passing note');
  // weight follows duration x metric strength: a long wrong note on beat 1 hurts more than a short one
  const longWrong = score([hold(61, 0, 12), hold(64, 12, 4)], 'melody').terms.harmony;
  const shortWrong = score([hold(61, 0, 1), hold(64, 1, 15)], 'melody').terms.harmony;
  assert.ok(longWrong < shortWrong);
  assert.equal(score([], 'melody').terms.harmony, undefined, 'no notes, no opinion');
});

test('bassRoot: the root on the downbeat, the fifth at half credit, late notes at none', () => {
  const roots = [hold(36, 0, 16), hold(43, 16, 16), hold(45, 32, 16), hold(41, 48, 16)]; // C G A F
  assert.equal(score(roots, 'bass').terms.bassRoot, 1);
  const fifths = [hold(43, 0, 16), hold(50, 16, 16), hold(52, 32, 16), hold(48, 48, 16)]; // the fifth of each
  assert.equal(score(fifths, 'bass').terms.bassRoot, 0.5);
  assert.equal(score([hold(36, 4, 12)], 'bass').terms.bassRoot, 0, 'first note of the bar is too late');
  assert.equal(score([hold(36, 2, 14)], 'bass').terms.bassRoot, 1, 'a step or two of swing is fine');
  assert.equal(score([hold(36, 0, 16), hold(43, 16, 16)], 'bass').terms.bassRoot, 1, 'the two bars it sits out do not count');
  assert.equal(score([hold(36, 0, 16), hold(44, 16, 16)], 'bass').terms.bassRoot, 0.5, 'the root, then a wrong note');
});

test('clash: a held semitone against the chords is caught, a whole step is not', () => {
  const chords = { chords: peer('chords', [chordHold([60, 64, 67])]) }; // C major
  assert.equal(score([hold(65)], 'melody', chords).terms.clash, 0, 'F held against E for a whole bar is as bad as it gets');
  assert.equal(score([hold(62)], 'melody', chords).terms.clash, 1, 'D against C and E is a whole step: fine');
  // longer and stronger overlaps cost more
  const semitone = score([hold(65, 0, 2)], 'melody', chords).terms.clash;
  assert.equal(semitone, 0.5, 'two steps of semitone');
  assert.ok(score([hold(65, 0, 16)], 'melody', chords).terms.clash < semitone);
  // a seventh chord against its own root is harmony, not a clash (both notes are in the chord)
  const maj7 = { chords: peer('chords', [chordHold([60, 64, 67, 71])]) };
  assert.equal(score([hold(72)], 'melody', maj7).terms.clash, 1, 'C against the B of a C major 7');
  assert.equal(score([hold(36, 0, 16)], 'bass', maj7).terms.clash, 1);
  // a tritone counts half, and only against the bass
  const bassF = { bass: peer('bass', [hold(41, 0, 16)]) }; // F
  const tritone = score([hold(71, 0, 2)], 'melody', bassF).terms.clash; // B against F
  assert.equal(tritone, 1 - (1 - semitone) / 2, 'a tritone against the bass costs half a semitone');
  // a stale peer counts half as much as one that is for this phrase
  const stale = { chords: peer('chords', [chordHold([60, 64, 67])], { phrase: -1 }) };
  assert.equal(score([hold(65, 0, 2)], 'melody', stale).terms.clash, 1 - (1 - semitone) / 2);
  assert.equal(score([hold(65)], 'melody').terms.clash, undefined, 'nobody to clash with');
});

test('register: parts own their range, and the two hard rules fail outright', () => {
  const chords = peer('chords', [chordHold([60, 64, 67])]);
  const melodyAbove = peer('melody', [hold(79, 0, 8), hold(81, 8, 8)]);
  // a bass sitting above the chords breaks the hard rule
  assert.equal(score([hold(70, 0, 8), hold(74, 8, 8)], 'bass', { chords }).terms.register, 0);
  assert.equal(score([hold(36, 0, 8), hold(40, 8, 8)], 'bass', { chords }).terms.register, 1, 'a bass below them is fine');
  // a melody that sits inside the chords breaks the other one
  assert.equal(score([hold(62, 0, 8), hold(64, 8, 8)], 'melody', { chords }).terms.register, 0);
  assert.ok(score([hold(79, 0, 8), hold(81, 8, 8)], 'melody', { chords }).terms.register > 0.9);
  // the chords are judged by the same rules from their side
  assert.equal(score([chordHold([60, 64, 67])], 'chords', { melody: peer('melody', [hold(62, 0, 16)]) }).terms.register, 0);
  // Overlapping by more than a minor third costs, in proportion. (Bass against chords is governed
  // by the hard rule instead -- any overlap at all already breaks it -- so this is bass vs melody.)
  const highMelody = peer('melody', [hold(64, 0, 8), hold(74, 8, 8)]);
  assert.equal(score([hold(60, 0, 8), hold(62, 8, 8)], 'bass', { melody: highMelody }).terms.register, 1, 'two semitones of overlap is fine');
  const lots = score([hold(60, 0, 8), hold(70, 8, 8)], 'bass', { melody: peer('melody', [hold(62, 0, 8), hold(74, 8, 8)]) }).terms.register;
  assert.ok(Math.abs(lots - (1 - 5 / 12)) < 1e-9, `eight semitones of overlap scored ${lots}`);
  assert.equal(score([hold(60)], 'chords').terms.register, undefined);
});

test('rhythm: the bass locks to the kick, the melody keeps out of the way, interactions move the target', () => {
  const kickSteps = [0, 8, 16, 24, 32, 40, 48, 56];
  const kit = peer('drums', [...kickSteps.map((s) => drum('kick', s)), ...[4, 12, 20, 28].map((s) => drum('hat', s))]);
  // The target is 0.5-0.9: lock in, but a bass on literally every kick and nothing else is stiff.
  assert.ok(Math.abs(score(kickSteps.map((s) => hold(36, s, 4)), 'bass', { drums: kit }).terms.rhythm - 2 / 3) < 1e-9);
  assert.equal(score([0, 8, 16, 24, 32, 40, 3].map((s) => hold(36, s, 2)), 'bass', { drums: kit }).terms.rhythm, 1, 'most kicks, plus a note of its own');
  const offKick = score([2, 6, 10, 14, 18, 22].map((s) => hold(36, s, 2)), 'bass', { drums: kit }).terms.rhythm;
  assert.ok(offKick < 0.5, `bass ignoring the kick ${offKick}`);
  // only the kick counts for that pair, not the whole kit
  assert.equal(score([4, 12, 20, 28].map((s) => hold(36, s, 2)), 'bass', { drums: kit }).terms.rhythm, 0, 'hats are not the kick');
  // melody against chords: landing on every chord stab is too much
  const comp = peer('chords', [0, 8, 16, 24].map((s) => chordHold([60, 64, 67], s, 4)));
  assert.ok(score([0, 8, 16, 24].map((s) => hold(79, s, 4)), 'melody', { chords: comp }).terms.rhythm < 0.6);
  const mostlyApart = [0, 6, 20, 30].map((s) => hold(79, s, 2)); // shares one onset out of seven
  assert.equal(score(mostlyApart, 'melody', { chords: comp }).terms.rhythm, 1);
  // answering wants to stay out of the way; echoing wants to land together
  const together = [0, 8, 16, 24].map((s) => hold(79, s, 4));
  assert.equal(score(together, 'melody', { chords: comp }, { d: { interaction: 'echo:chords', level: 2 } }).terms.rhythm, 1);
  assert.equal(score(together, 'melody', { chords: comp }, { d: { interaction: 'answer:chords', level: 2 } }).terms.rhythm, 0);
  assert.equal(score([2, 6, 20, 30].map((s) => hold(79, s, 2)), 'melody', { chords: comp }, { d: { interaction: 'answer:chords', level: 2 } }).terms.rhythm, 1);
});

test('shape: leaps, repeated notes and range cost; stepwise motion pays', () => {
  const stepwise = [60, 62, 64, 65, 67, 65, 64, 62].map((m, i) => hold(m, i * 2, 2));
  const leapy = [60, 72, 59, 74, 58, 71, 60, 73].map((m, i) => hold(m, i * 2, 2));
  const stuck = Array.from({ length: 8 }, (_, i) => hold(64, i * 2, 2));
  // The reward is for a stepwise share of 0.4-0.8, so a line that only ever steps is a little flat.
  const mixed = [60, 62, 64, 69, 67, 65, 64, 67].map((m, i) => hold(m, i * 2, 2)); // 5 of 7 stepwise
  assert.equal(score(mixed, 'melody').terms.shape, 1);
  const good = score(stepwise, 'melody').terms.shape;
  assert.ok(good > 0.8 && good < 1, `all stepwise ${good}`);
  assert.ok(score(leapy, 'melody').terms.shape < 0.6);
  assert.ok(score(stuck, 'melody').terms.shape < good);
  // octaves are not leaps
  assert.ok(score([60, 72, 60, 72, 60, 72, 60, 72].map((m, i) => hold(m, i * 2, 2)), 'bass').terms.shape >
    score(leapy, 'bass').terms.shape);
  // a melody spanning more than 19 semitones costs; the same shape in the bass does not
  const wide = [55, 60, 64, 72, 76, 72, 64, 60].map((m, i) => hold(m, i * 2, 2));
  assert.ok(score(wide, 'melody').terms.shape < score(wide, 'bass').terms.shape);
  assert.equal(score([hold(60), hold(62)], 'melody').terms.shape, undefined, 'two notes are not a shape');
});

test('continuity: similar to my last phrase, but not identical (and a hook has to be)', () => {
  const last = [0, 8, 16, 24, 32, 40, 48, 56].map((s) => hold(60 + (s % 16 ? 2 : 0), s, 4));
  const same = { last: peer('melody', last, { phrase: -1 }) };
  const identical = score(last, 'melody', {}, same).terms.continuity;
  assert.ok(identical < 0.3, `playing exactly the same thing again scored ${identical}`);
  const varied = last.map((n, i) => (i % 2 ? { ...n, step: n.step + 1 } : n)); // same shape, new rhythm
  assert.equal(score(varied, 'melody', {}, same).terms.continuity, 1, 'a variation is just right');
  const unrelated = [3, 7, 19, 23, 35, 39].map((s) => hold(72, s, 2));
  assert.ok(score(unrelated, 'melody', {}, same).terms.continuity < 0.5);
  // in a hook section (Phase 5) it is the other way round: say it again
  assert.equal(score(last, 'melody', {}, { ...same, hook: true }).terms.continuity, 1);
  assert.ok(score(varied, 'melody', {}, { ...same, hook: true }).terms.continuity < 0.5);
  assert.equal(score(last, 'melody').terms.continuity, undefined, 'no history yet');
});

test('drums: the kick follows the bass, the backbeat stays, fills wait for the last bar', () => {
  const bass = peer('bass', [0, 10, 16, 26, 32, 42, 48, 58].map((s) => hold(36, s, 4)));
  const withBass = (notes, d) => score(notes, 'drums', { bass }, { d }).terms.drums;
  const backbeat = [0, 1, 2, 3].flatMap((b) => [drum('snare', b * 16 + 4), drum('snare', b * 16 + 12)]);
  const locked = [0, 10, 16, 26, 32, 42, 48, 58].map((s) => drum('kick', s));
  assert.equal(withBass([...locked, ...backbeat], { level: 2 }), 1);
  // two steps away from every bass note: close, but not locked (the window is one step)
  const loose = [...[2, 6, 18, 22, 34, 38, 50, 54].map((s) => drum('kick', s)), ...backbeat];
  assert.equal(withBass(loose, { level: 2 }), 0.5, 'a kick that ignores the bass');
  assert.equal(withBass([...[1, 11, 17, 27, 33, 43, 49, 57].map((s) => drum('kick', s)), ...backbeat], { level: 2 }), 1, 'within a step counts');
  assert.ok(withBass(locked, { level: 2 }) < 1, 'no backbeat at medium level');
  assert.equal(withBass(locked, { level: 1 }), 1, 'a sparse part is not asked for a backbeat');
  // a fill in the middle of the phrase is wrong; the same fill in the last bar is right
  const fill = (bar) => Array.from({ length: 8 }, (_, i) => drum('snare', bar * 16 + i * 2));
  assert.ok(withBass([...locked, ...backbeat, ...fill(1)], { level: 2 }) < withBass([...locked, ...backbeat, ...fill(3)], { level: 2 }));
  // the bass only counts when its part is for this phrase
  const staleBass = { bass: peer('bass', bass.notes, { phrase: -1 }) };
  assert.equal(score(loose, 'drums', staleBass, { d: { level: 1 } }).terms.drums, undefined, 'last phrase\'s bass is no guide');
});

test('fitScore: only the role\'s own terms, weighted, and an empty part is neutral', () => {
  const peers = { chords: peer('chords', [chordHold([60, 64, 67])]), bass: peer('bass', [hold(36, 0, 16)]), drums: peer('drums', [drum('kick', 0)]) };
  for (const role of ROLES) {
    const notes = role === 'drums' ? [drum('kick', 0), drum('snare', 4)] : [hold(role === 'bass' ? 36 : 79, 0, 8)];
    const { total, terms } = score(notes, role, peers);
    assert.ok(total >= 0 && total <= 1, `${role} total ${total}`);
    for (const name of Object.keys(terms)) assert.ok(TERMS[role].includes(name), `${role} should not be judged on ${name}`);
    assert.ok(Object.keys(terms).length >= 2, `${role} got ${Object.keys(terms).length} terms`);
  }
  // the total is the weighted mean of the terms present
  const { total, terms } = score([hold(79, 0, 8), hold(81, 8, 8), hold(79, 16, 8)], 'melody', peers);
  const expect = Object.entries(terms).reduce((a, [k, v]) => a + WEIGHTS[k] * v, 0) / Object.keys(terms).reduce((a, k) => a + WEIGHTS[k], 0);
  assert.ok(Math.abs(total - expect) < 1e-9);
  assert.deepEqual(score([], 'melody', peers), { total: 0.5, terms: {} }, 'resting is neither good nor bad');
  assert.match(describeFit(score([hold(60, 0, 8)], 'bass', peers), 6), /^best of 6: /);
  assert.equal(describeFit(null, 6), '');
});

test('candidates: the most likely one and last phrase\'s are always in, duplicates are not', () => {
  const dist = {
    level: { 1: 0.2, 2: 0.5, 3: 0.3 },
    style: { stabs: 0.6, pad: 0.4 },
    register: { '-1': 0.2, 0: 0.7, 1: 0.1 },
    interaction: { none: 0.8, 'echo:bass': 0.2 },
  };
  const base = { level: 2, style: 'stabs', register: 0, interaction: 'none', voice: 'keys-piano' };
  const last = { level: 1, style: 'pad', register: -1, interaction: 'none' };
  const cands = candidateDecisions(dist, base, { last, prefer: 'chords/pad/sparse', k: 6, random: rng(3) });
  assert.ok(cands.length >= 3 && cands.length <= 6);
  assert.equal(cands[0].kind, 'top');
  assert.deepEqual({ ...cands[0].d }, { ...base, level: 2, style: 'stabs', register: 0, interaction: 'none' });
  assert.equal(cands[1].kind, 'continuity');
  assert.deepEqual([cands[1].d.level, cands[1].d.style, cands[1].d.register], [1, 'pad', -1]);
  for (const c of cands) {
    assert.equal(c.prefer, 'chords/pad/sparse', 'every candidate keeps the loop we are playing');
    assert.equal(c.d.voice, 'keys-piano', 'the instrument is not searched over');
  }
  const keys = cands.map((c) => CANDIDATE_QUESTIONS.map((q) => c.d[q]).join('|'));
  assert.equal(new Set(keys).size, keys.length, 'no duplicates');
  // pins win in every candidate
  const pinned = candidateDecisions(dist, base, { pins: { level: 3, register: 1 }, last, k: 6, random: rng(4) });
  for (const c of pinned) assert.ok(c.d.level === 3 && c.d.register === 1, JSON.stringify(c.d));
  // nothing to carry on from: no continuity candidate
  assert.ok(!candidateDecisions(dist, base, { last: { ...last, level: 0 }, k: 4, random: rng(5) }).some((c) => c.kind === 'continuity'));
  // a single option per question collapses to one candidate
  assert.equal(candidateDecisions({ level: { 0: 1 } }, base, { k: 6, random: rng(6) }).length, 1);
});

test('choosing: the fit decides between likely candidates, and the prior still matters', () => {
  const dist = { level: { 1: 0.5, 2: 0.5 }, style: { a: 0.5, b: 0.5 }, register: { 0: 1 }, interaction: { none: 1 } };
  const mk = (level, style, total, bonus = 0) => ({ d: { level, style, register: 0, interaction: 'none' }, fit: { total }, bonus });
  assert.ok(Math.abs(candidatePrior({ level: 1, style: 'a', register: 0, interaction: 'none' }, dist) - 0.25) < 1e-9);
  // same prior, better fit: the better fit wins nearly always
  const cands = [mk(1, 'a', 0.9), mk(2, 'b', 0.6)];
  const { probs } = pickCandidate(cands, { dist, random: () => 0.5 });
  assert.ok(probs[0] > 0.98, `${probs}`);
  // a 10x less likely option needs a clearly better fit to win
  // With lambda = 6 and a 9:1 prior, the fit has to be about log(9)/6 = 0.37 better to take over.
  const skewed = { ...dist, level: { 1: 0.9, 2: 0.1 } };
  assert.ok(pickCandidate([mk(1, 'a', 0.7), mk(2, 'a', 0.75)], { dist: skewed }).probs[0] > 0.9, 'a small gain does not beat the prior');
  assert.ok(pickCandidate([mk(1, 'a', 0.5), mk(2, 'a', 0.95)], { dist: skewed }).probs[1] > 0.75, 'a big one does');
  // the continuity bonus tips a tie
  assert.ok(pickCandidate([mk(1, 'a', 0.8), mk(2, 'b', 0.8, CONTINUITY_BONUS)], { dist }).probs[1] > 0.6);
  // sampling follows the probabilities, and every index is reachable
  const picks = Array.from({ length: 200 }, (_, i) => pickCandidate([mk(1, 'a', 0.8), mk(2, 'b', 0.79)], { dist, random: randomFor(`tie${i}`, 'x') }).index);
  assert.equal(new Set(picks).size, 2, 'the near-tie goes both ways');
  const share = picks.filter((i) => i === 0).length / picks.length;
  assert.ok(share > 0.4 && share < 0.75, `the slightly better fit won ${share} of the time`);
});

test('the agent plays one of the candidates it rendered, and the same rng gives the same part', () => {
  const made = [];
  const agent = new Agent('melody', lib, randomFor('test1', 'melody'));
  const render = agent.renderCandidate.bind(agent);
  agent.renderCandidate = (c, ctx) => {
    const out = render(c, ctx);
    made.push(out);
    return out;
  };
  const ctx = ctxFor('melody', { chords: peer('chords', [chordHold([60, 64, 67])]), drums: peer('drums', [drum('kick', 0)]) }, { phrase: 3 });
  const part = agent.compose(ctx);
  assert.ok(made.length >= 3 && made.length <= CANDIDATES, `rendered ${made.length}`);
  assert.equal(part.candidates, made.length);
  const won = made.find((c) => CANDIDATE_QUESTIONS.every((q) => c.d[q] === part.d[q]));
  assert.ok(won, `the winner was not one of the candidates: ${JSON.stringify(part.d)}`);
  assert.equal(part.loop, won.loop);
  assert.deepEqual(part.notes.map((n) => n.step), won.notes.map((n) => n.step), 'the winner, humanised');
  assert.ok(part.fit && part.fit.terms && part.fit.total > 0);
  assert.ok(part.rank >= 1 && part.rank <= part.candidates);
  assert.match(part.why, /best of \d/);
  // same rng, same decision
  const again = new Agent('melody', lib, randomFor('test1', 'melody')).compose(ctxFor('melody', ctx.peers, { phrase: 3 }));
  assert.deepEqual(again.notes, part.notes);
  assert.deepEqual(again.d, part.d);
  assert.equal(again.fit.total, part.fit.total);
});

// The point of the whole phase: scored candidates fit the band better than the rules alone.
test('a band that scores its candidates fits together better than one that does not', async () => {
  // With the packs loaded (real drummers, POP909 melodies and bass lines over whatever chords the
  // seed picked), there is something to go wrong: this is the library the app actually runs.
  const { PACK_LOOPS } = await import('../src/packs.js');
  const packLib = createLibrary({ packs: PACK_LOOPS });
  const run = (k, seed) => {
    const s = structureFromSeed(seed);
    let t = 0;
    const parts = [];
    const e = new Engine({
      agents: ROLES.map((r) => new Agent(r, packLib, randomFor('ab', r), { candidates: k })),
      now: () => t, audio: { play() {} }, onEvent: (ev) => parts.push(ev),
    });
    e.start(s, 0);
    for (const end = 24 * 64 * stepMs(s.bpm); t < end; t += 50) e.tick();
    const late = parts.filter((p) => p.phrase >= 2 && p.part.notes.length);
    return {
      fit: late.reduce((a, p) => a + p.part.fit.total, 0) / late.length,
      clash: late.filter((p) => p.part.fit.terms.clash != null),
    };
  };
  const pooled = { 1: [], 6: [] };
  const fits = { 1: [], 6: [] };
  for (const seed of ['durhack', 'pop-demo', 's1']) {
    const one = run(1, seed);
    const six = run(6, seed);
    // Step A5's groove bonus trades a little fit for keeping a loop, so per seed only "no worse".
    assert.ok(six.fit >= one.fit, `${seed}: best-of-6 ${six.fit.toFixed(3)} vs most-likely ${one.fit.toFixed(3)}`);
    fits[1].push(one.fit);
    fits[6].push(six.fit);
    pooled[1].push(...one.clash);
    pooled[6].push(...six.clash);
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(avg(fits[6]) > avg(fits[1]) + 0.015, `fit ${avg(fits[1]).toFixed(3)} -> ${avg(fits[6]).toFixed(3)}`);
  // Fewer sour notes, which is the point: this is the acceptance test for the phase.
  const clashOf = (k) => pooled[k].reduce((a, p) => a + p.part.fit.terms.clash, 0) / pooled[k].length;
  assert.ok(clashOf(6) > clashOf(1) + 0.05, `clash ${clashOf(1).toFixed(3)} -> ${clashOf(6).toFixed(3)}`);
});

test('budget: six candidates for all four roles stay well inside 40 ms per phrase', () => {
  const s = structureFromSeed('durhack');
  const e = new Engine({ agents: ROLES.map((r) => new Agent(r, lib, randomFor('perf', r), { candidates: 6 })), now: () => 0, audio: { play() {} } });
  e.start(s, 0);
  for (let p = 0; p < 3; p++) e.ensureParts(p); // warm up
  let worst = 0;
  for (let phrase = 3; phrase < 20; phrase++) {
    const t0 = performance.now();
    e.ensureParts(phrase);
    worst = Math.max(worst, performance.now() - t0);
  }
  assert.ok(worst < 40, `worst phrase took ${worst.toFixed(1)} ms for all four roles`);
});
