// Step D (Phase 6) of docs/MUSIC_QUALITY_HANDOFF.md: staggered decisions per role, and Jev ranking
// the candidates (Phase 3d).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, ROLES } from '../src/loops.js';
import { PACK_LOOPS } from '../src/packs.js';
import { Agent } from '../src/agent.js';
import { Engine, COMPOSE_AHEAD } from '../src/engine.js';
import { stepMs, phraseStartMs } from '../src/clock.js';
import { structureFromSeed, randomFor, seededRandom } from '../src/seed.js';
import { formFromStructure, formDirective } from '../src/form.js';
import { candidateKey, jevMultipliers } from '../src/decide/select.js';
import { buildCandidateQuestion, Jev } from '../src/decide/jev.js';
import { simulateBand, byRole, freshStats } from '../tools/sim.mjs';

const lib = createLibrary({ packs: PACK_LOOPS });
const structure = structureFromSeed('stagger');
const form = formFromStructure(structure);
const dir = (p) => formDirective(form, p);
const barMs = 16 * stepMs(structure.bpm);

test('horizons: drums and chords decide 2 bars ahead, the bass 1.5, the melody 1, in that order', () => {
  assert.deepEqual(COMPOSE_AHEAD, { drums: 2, chords: 2, bass: 1.5, melody: 1 });
  let t = 0;
  const events = [];
  const plans = [];
  const e = new Engine({
    agents: ROLES.map((r) => new Agent(r, lib, randomFor('h', r))), now: () => t, audio: { play() {} }, getDirective: dir,
    onEvent: (ev) => ev.type === 'part' && events.push({ ...ev, at: t }),
    onPlan: (phrase, ctxs, deadline, roles) => plans.push({ phrase, roles, deadline }),
  });
  e.start(structure, 0);
  for (const end = 8 * 64 * stepMs(structure.bpm); t < end; t += 25) e.tick();
  for (const ev of events.filter((x) => x.phrase > 0)) {
    const ahead = (phraseStartMs(ev.phrase, 0, structure.bpm) - ev.at) / barMs;
    assert.ok(ahead <= COMPOSE_AHEAD[ev.role] + 0.01 && ahead > COMPOSE_AHEAD[ev.role] - 0.05, `${ev.role} phrase ${ev.phrase} decided ${ahead.toFixed(2)} bars ahead`);
  }
  for (let p = 1; p < 7; p++) {
    const order = events.filter((x) => x.phrase === p).map((x) => x.role);
    assert.deepEqual(order, ['drums', 'chords', 'bass', 'melody'], `phrase ${p}`);
  }
  // one plan per horizon group per phrase, each giving Jev one bar
  const p3 = plans.filter((x) => x.phrase === 3).map((x) => x.roles.join('+'));
  assert.deepEqual(p3, ['drums+chords', 'bass', 'melody']);
  for (const p of plans.filter((x) => x.phrase > 1)) assert.ok(Math.abs(p.deadline - barMs) <= 26, `deadline ${p.deadline}`);
  assert.equal(e.horizonText(), 'drums + chords 2 · bass 1.5 · melody 1 bars ahead');
});

test('four devices: the bass hears the drums and chords for the same phrase, the melody hears all three', () => {
  const { parts } = simulateBand({ seed: 'stagger', rng: 'four', phrases: 12, devices: 4 });
  const fresh = freshStats(byRole(parts));
  assert.ok(fresh.bass.drums > 0.9 && fresh.bass.chords > 0.9, JSON.stringify(fresh.bass));
  assert.ok(fresh.melody.drums > 0.9 && fresh.melody.bass > 0.9 && fresh.melody.chords > 0.9, JSON.stringify(fresh.melody));
  // with the old single horizon nobody hears anyone's next phrase
  const old = freshStats(byRole(simulateBand({ seed: 'stagger', rng: 'four', phrases: 12, devices: 4, engineOptions: { composeAheadBars: 1 } }).parts));
  assert.equal(old.melody.bass, 0);
});

test('doubling still copies the owner part as soon as it is announced; takeover still continues it', () => {
  let t = 0;
  const e = new Engine({ agents: ROLES.map((r) => new Agent(r, lib, randomFor('d', r))), now: () => t, audio: { play() {} }, getDirective: dir });
  e.myRoles = new Set(['bass']);
  e.doubling = new Set(['bass']);
  e.start(structure, 0);
  const theirs = { notes: [{ step: 0, dur: 4, vel: 0.8, midi: 40 }], d: { level: 1, style: 'roots', register: 0, interaction: 'none', voice: 'bass-electric' }, by: 'owner', why: 'x' };
  t = phraseStartMs(3, 0, structure.bpm) - 3.9 * barMs; // well before any horizon
  e.setRemotePart(3, 'bass', theirs);
  e.tick();
  assert.equal(e.phrases.get(3)?.local.bass?.doubled, true);
  // takeover: the announced part for the phrase is played as it is
  e.doubling = new Set();
  e.myRoles = new Set(['bass']);
  e.phrases.clear();
  e.setRemotePart(4, 'bass', theirs);
  assert.match(e.ensureParts(4).local.bass.why, /taken over from owner/);
});

const ctxFor = (role, phrase = 5) => ({ role, phrase, structure, peers: {}, before: {}, last: null, history: [], directive: dir(phrase), hook: false, hookEntry: null });

test('prepare + finish with no Jev answer is exactly compose', () => {
  for (const role of ROLES) {
    const a = new Agent(role, lib, seededRandom('pf', role));
    const b = new Agent(role, lib, seededRandom('pf', role));
    for (let p = 2; p < 6; p++) {
      const x = a.compose(ctxFor(role, p));
      const y = b.finish(b.prepare(ctxFor(role, p)));
      assert.deepEqual(y.notes, x.notes);
      assert.deepEqual(y.d, x.d);
    }
  }
});

test('a Jev ranking that strongly prefers one candidate makes it win much more often', () => {
  let without = 0, withJev = 0, trials = 0;
  for (let i = 0; i < 60; i++) {
    const prep = new Agent('melody', lib, seededRandom('jr', i)).prepare(ctxFor('melody', 6));
    if (prep.cands.length < 3) continue;
    trials++;
    // Jev's favourite: the scorer's runner-up. (Jev multiplies the weights like blend() does, so it
    // can swing close calls but cannot overrule a much better fit.)
    const order = prep.cands.map((c, k) => k).filter((k) => prep.cands[k].notes.length).sort((x, y) => prep.cands[y].fit.total - prep.cands[x].fit.total);
    if (order.length < 2) { trials--; continue; }
    const target = order[1];
    const byKey = Object.fromEntries(prep.cands.map((c, k) => [candidateKey(c), k === target ? 0.97 : 0.005]));
    const keyOf = (part) => candidateKey({ loop: part.loop, d: part.d });
    const a = new Agent('melody', lib, seededRandom('jr', i));
    const want = candidateKey(prep.cands[target]);
    if (keyOf(a.finish(a.prepare(ctxFor('melody', 6)))) === want) without++;
    const b = new Agent('melody', lib, seededRandom('jr', i));
    const part = b.finish(b.prepare(ctxFor('melody', 6)), { jev: { byKey, source: 'jev' } });
    if (keyOf(part) === want) withJev++;
    assert.match(part.source, /ranked by jev/);
  }
  assert.ok(trials > 30);
  assert.ok(withJev > without + trials * 0.15, `Jev's pick won ${withJev}/${trials} vs ${without}/${trials}`);
});

test('jevMultipliers: floor, normalised over what Jev ranked, no opinion on the rest', () => {
  const c = (id) => ({ loop: { id }, d: { level: 2, register: 0, interaction: 'none' } });
  const cands = [c('a'), c('b'), c('x')];
  const m = jevMultipliers(cands, { [candidateKey(cands[0])]: 0.9, [candidateKey(cands[1])]: 0 });
  assert.ok(m[0] > 1.8 && m[1] > 0 && m[1] < 0.1, JSON.stringify(m));
  assert.equal(m[2], 1);
  assert.equal(jevMultipliers(cands, null), null);
  assert.equal(jevMultipliers(cands, { [candidateKey(cands[0])]: 1 }), null, 'one ranked candidate is no ranking');
});

test('the engine prepares half a bar early, asks for a ranking, re-prepares when a fresh peer arrives', () => {
  let t = 0;
  const asked = [];
  const e = new Engine({
    agents: ROLES.map((r) => new Agent(r, lib, randomFor('c', r))), now: () => t, audio: { play() {} }, getDirective: dir,
    onCandidates: (phrase, role, prepared, deadline) => asked.push({ phrase, role, at: t, deadline, keys: prepared.keys }),
    getCandidateAdvice: (phrase, role) => {
      const a = asked.find((x) => x.phrase === phrase && x.role === role);
      return a ? { byKey: Object.fromEntries(a.keys.map((k, i) => [k, i === 0 ? 0.9 : 0.02])), source: 'test' } : null;
    },
  });
  e.myRoles = new Set(['drums', 'bass', 'melody']); // chords come from another device
  e.start(structure, 0);
  const parts = [];
  e.onEvent = (ev) => ev.type === 'part' && parts.push(ev);
  for (const end = 6 * 64 * stepMs(structure.bpm); t < end; t += 25) {
    // the chords device announces its part 1.7 bars ahead: after the bass prepared (2 bars), before it chooses (1.5)
    for (let p = 1; p < 9; p++) {
      const at = phraseStartMs(p, 0, structure.bpm) - 1.7 * barMs;
      if (t >= at && t < at + 25) e.setRemotePart(p, 'chords', { notes: [{ step: 0, dur: 16, vel: 0.7, midis: [60, 64, 67] }], d: { level: 1, style: 'pad', register: 0, interaction: 'none', voice: 'keys-piano' }, by: 'chordsdev', why: 'pad' });
    }
    e.tick();
  }
  const roles = new Set(asked.map((a) => a.role));
  assert.ok(roles.has('drums') && roles.has('bass') && !roles.has('melody'), `asked for ${[...roles]}`);
  for (const a of asked.filter((x) => x.phrase > 1)) {
    const ahead = (phraseStartMs(a.phrase, 0, structure.bpm) - a.at) / barMs;
    assert.ok(Math.abs(ahead - (COMPOSE_AHEAD[a.role] + 0.5)) < 0.05, `${a.role} prepared ${ahead.toFixed(2)} bars ahead`);
    assert.ok(Math.abs(a.deadline - barMs / 2) < 30);
  }
  const bass = parts.filter((x) => x.role === 'bass' && x.phrase > 1 && x.part.notes.length);
  assert.ok(bass.length && bass.every((x) => x.part.fresh.includes('chords')), `the bass re-prepared and heard the chords: ${JSON.stringify(bass.map((x) => [x.phrase, x.part.fresh]))}`);
  assert.ok(parts.some((x) => /ranked by test/.test(x.part.source)));
});

test('Jev: one candidate question, decoded back to the candidates, counted in the stats', async () => {
  const prep = new Agent('bass', lib, seededRandom('q')).prepare(ctxFor('bass', 4));
  const { id, question, decode } = buildCandidateQuestion('bass', prep.cands, 4);
  assert.equal(id, 'bass|candidate');
  assert.equal(Object.keys(question.criteria).length, prep.cands.length);
  assert.deepEqual(Object.values(decode), prep.cands.map(candidateKey));
  assert.match(Object.values(question.criteria)[0], /Option 1: .*fits the band \d+%/);
  const jev = new Jev({ library: lib, fetchFn: async (url, { body }) => {
    const q = JSON.parse(body).questions[id];
    const keys = Object.keys(q.criteria);
    return { ok: true, json: async () => ({ source: 'fake', answers: { [id]: Object.fromEntries(keys.map((k, i) => [k, i === 1 ? 0.8 : 0.05])) } }) };
  } });
  await jev.rank(4, 'bass', prep, 5000);
  const r = jev.ranking(4, 'bass');
  assert.equal(r.source, 'fake');
  assert.equal(r.byKey[candidateKey(prep.cands[1])], 0.8);
  assert.equal(jev.stats.asked, 1);
  assert.equal(jev.stats.inTime, 1);
  assert.equal(jev.stats.ranked, 1);
  // a late answer is counted as late and not used
  const slow = new Jev({ library: lib, fetchFn: async () => { await new Promise((d) => setTimeout(d, 60)); return { ok: true, json: async () => ({ answers: {} }) }; } });
  await slow.rank(4, 'bass', prep, 10);
  assert.equal(slow.stats.late, 1);
  assert.equal(slow.ranking(4, 'bass'), null);
});
