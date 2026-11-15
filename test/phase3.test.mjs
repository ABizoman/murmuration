import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, ROLES } from '../src/loops.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { renderPhrase } from '../src/render.js';
import { parseChord } from '../src/theory.js';
import { summarise } from '../src/decide/context.js';
import { ruleScores, REGISTERS } from '../src/decide/rules.js';
import { blend, decide, normalise } from '../src/decide/select.js';
import { echo, answer } from '../src/decide/transform.js';
import { buildQuestions, buildState, groupAnswers, Jev } from '../src/decide/jev.js';
import { Director } from '../src/decide/director.js';
import { sanitiseDirective } from '../src/decide/directive.js';
import { stepMs } from '../src/clock.js';

const lib = createLibrary();
const structure = { key: 'A', mode: 'minor', bpm: 100, progression: ['i', 'VI', 'III', 'VII'] };
const rng = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function part(id, { phrase = 4, register = 0, level, interaction = 'none' } = {}) {
  const loop = lib.loops.find((l) => l.id === id);
  const lv = level ?? ['sparse', 'medium', 'busy'].indexOf(loop.density) + 1;
  const { notes } = renderPhrase(loop, { structure, phrase, register });
  return summarise({ notes, d: { level: lv, style: loop.style, register, interaction }, by: 'x' }, loop.role, phrase);
}
const ctxFor = (role, peers, extra = {}) => ({ role, phrase: 5, structure, peers, last: null, history: [], directive: null, ...extra });
const top = (w) => Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];

test('rule: if the melody is busy, the others go sparse', () => {
  const busy = ruleScores(ctxFor('chords', { melody: part('melody/call/busy'), drums: part('drums/four/busy'), bass: part('bass/pulse/busy') }), lib);
  const quiet = ruleScores(ctxFor('chords', { melody: part('melody/call/sparse'), drums: part('drums/four/sparse'), bass: part('bass/roots/sparse') }), lib);
  assert.equal(top(busy.level), '1');
  assert.equal(top(quiet.level), '3');
  assert.ok(busy.reasons.some((r) => r.text.includes('melody is busy')));
});

test('rule: avoid the register someone else is in', () => {
  // chords pushed up an octave sit where the melody normally is
  const s = ruleScores(ctxFor('melody', { chords: part('chords/pad/medium', { register: 1 }) }), lib);
  assert.ok(s.register[0] < s.register[1], `melody should move up: ${JSON.stringify(s.register)}`);
  const free = ruleScores(ctxFor('melody', { chords: part('chords/pad/medium', { register: 0 }) }), lib);
  assert.equal(top(free.register), '0');
});

test('rule: direction shifts the weights (feature, drop, pair)', () => {
  const peers = { bass: part('bass/pulse/medium'), chords: part('chords/pad/medium'), drums: part('drums/four/medium') };
  const base = ruleScores(ctxFor('melody', peers), lib);
  const feat = ruleScores(ctxFor('melody', peers, { directive: sanitiseDirective({ energy: 0.5, feature: 'melody', pair: { who: 'melody', mode: 'answer', whom: 'bass' } }) }), lib);
  assert.ok(normalise(feat.level)[3] > normalise(base.level)[3]);
  assert.equal(top(feat.interaction), 'answer:bass');
  const drop = ruleScores(ctxFor('drums', peers, { directive: sanitiseDirective({ energy: 0.3, drop: 'drums' }) }), lib);
  assert.equal(top(drop.level), '0');
});

test('rule: a part that was addressed tends to reply', () => {
  const plain = ruleScores(ctxFor('melody', { bass: part('bass/pulse/medium') }), lib);
  const addressed = ruleScores(ctxFor('melody', { bass: part('bass/pulse/medium', { interaction: 'echo:melody' }) }), lib);
  assert.ok(addressed.interaction['answer:bass'] > plain.interaction['answer:bass'] * 1.5);
});

test('selector: Jev shifts the odds, a uniform Jev answer changes nothing, pins win', () => {
  const rule = { a: 1, b: 1, c: 0 };
  assert.deepEqual(blend(rule, null), { a: 0.5, b: 0.5 });
  assert.deepEqual(blend(rule, { a: 0.4, b: 0.4 }), { a: 0.5, b: 0.5 });
  const pushed = blend(rule, { a: 0.9, b: 0.1 });
  assert.ok(pushed.a > 0.85 && !('c' in pushed));
  const scores = { level: { 1: 1, 2: 1, 3: 1 }, style: { x: 1 }, register: { 0: 1, 1: 1 }, interaction: { none: 1 }, voice: { piano: 1 } };
  const r = decide(scores, null, { level: 3, register: 1 }, rng(3));
  assert.equal(r.d.level, 3);
  assert.equal(r.d.register, 1);
  assert.equal(r.usedJev, false);
  let busy = 0;
  const stream = rng(9);
  for (let i = 0; i < 400; i++) busy += decide(scores, { level: { 1: 0.05, 2: 0.05, 3: 0.9 } }, null, stream).d.level === 3;
  assert.ok(busy > 320, `Jev's favourite picked ${busy}/400`);
});

test('echo: rhythm echo lands on the target onsets; contour echo copies the shape in my register', () => {
  const bassP = part('bass/pulse/busy');
  const env = { role: 'drums', level: 2, register: 0, structure, phrase: 5 };
  const drumBase = renderPhrase(lib.loops.find((l) => l.id === 'drums/boombap/medium'), { structure, phrase: 5 }).notes;
  const kicks = echo(drumBase, bassP, env).filter((n) => n.drum === 'kick');
  assert.ok(kicks.length > 0 && kicks.every((k) => bassP.onsets[k.step] === 1), 'kick follows the bass');
  assert.ok(kicks.length <= 16, 'thinned to the level');

  const melEnv = { role: 'melody', level: 3, register: 0, structure, phrase: 5 };
  const melBase = renderPhrase(lib.loops.find((l) => l.id === 'melody/motif/busy'), { structure, phrase: 5 }).notes;
  const canon = echo(melBase, bassP, melEnv);
  assert.deepEqual(canon.map((n) => n.step), bassP.notes.map((n) => n.step), 'same rhythm');
  const dir = (list) => list.slice(1).map((n, i) => Math.sign(n.midi - list[i].midi));
  const same = dir(canon.slice(0, 8)).filter((d, i) => d === dir(bassP.notes.slice(0, 8))[i]).length;
  assert.ok(same >= 6, 'same contour within the bar');
  assert.ok(canon.every((n) => n.midi >= 55 && n.midi <= 96), 'in the melody register');
});

test('answer: plays in the gaps the other part leaves', () => {
  const call = part('melody/call/medium'); // busy in bars 1 and 3 first halves, then space
  const env = { role: 'bass', level: 3, register: 0, structure, phrase: 5 };
  const bassBase = renderPhrase(lib.loops.find((l) => l.id === 'bass/roots/busy'), { structure, phrase: 5 }).notes;
  const out = answer(bassBase, call, env);
  const counts = new Array(8).fill(0);
  for (const n of call.notes) counts[Math.floor(n.step / 8)]++;
  const busiest = counts.indexOf(Math.max(...counts));
  assert.ok(out.length < bassBase.length);
  assert.ok(out.filter((n) => Math.floor(n.step / 8) === busiest).every((n) => n.step % 16 === 0), 'only downbeats under the call');
});

test('every echo/answer pairing gives valid notes in range', () => {
  const env0 = { structure, phrase: 5 };
  for (const mine of lib.loops) for (const theirs of lib.loops) {
    if (mine.role === theirs.role) continue;
    const target = part(theirs.id);
    for (const register of REGISTERS[mine.role]) for (const fn of [echo, answer]) {
      const level = ['sparse', 'medium', 'busy'].indexOf(mine.density) + 1;
      const base = renderPhrase(mine, { structure, phrase: 5, register }).notes;
      const out = fn(base, target, { ...env0, role: mine.role, level, register });
      assert.ok(out.length > 0, `${fn.name} ${mine.id} <- ${theirs.id}`);
      for (const n of out) {
        assert.ok(Number.isInteger(n.step) && n.step >= 0 && n.step < 64 && n.dur > 0, `${fn.name} ${mine.id} <- ${theirs.id} ${JSON.stringify(n)}`);
        if (mine.role === 'drums') assert.ok(n.drum);
        if (n.midi != null) assert.ok(n.midi >= 21 && n.midi <= 108, `${fn.name} ${mine.id} <- ${theirs.id} midi ${n.midi}`);
        if (mine.role === 'chords') assert.ok(n.midis?.length >= 3);
      }
    }
  }
});

test('Jev questions: one choice question per decision, answers decoded back to options', () => {
  const peers = { bass: part('bass/pulse/medium'), chords: part('chords/pad/medium'), drums: part('drums/four/medium') };
  const ctxs = { melody: ctxFor('melody', peers) };
  const { questions: q, decode } = buildQuestions(ctxs, lib);
  assert.deepEqual(Object.keys(q).sort(), ['melody|interaction', 'melody|level', 'melody|register', 'melody|style', 'melody|voice']);
  assert.equal(decode['melody|voice'].voice_trumpet, 'trumpet');
  assert.ok(Object.values(q).every((x) => x.type === 'choice' && x.instructions.endsWith('?') && Object.keys(x.criteria).length >= 2));
  assert.ok(Object.values(q).flatMap((x) => Object.keys(x.criteria)).every((k) => /^[a-z0-9_]+$/i.test(k)), 'safe option keys');
  assert.equal(decode['melody|interaction'].answer_bass, 'answer:bass');
  assert.equal(decode['melody|level'].busy, '3');
  const state = buildState(ctxs);
  assert.ok(state.includes('A minor') && state.includes('- bass:') && state.includes('x'));
  const g = groupAnswers({ 'melody|level': { busy: 0.8, bogus: 1 }, 'melody|interaction': { answer_bass: 0.6 }, 'melody|register': { high: NaN }, nope: { a: 1 } }, decode);
  assert.deepEqual(g, { melody: { level: { 3: 0.8 }, interaction: { 'answer:bass': 0.6 } } });
});

test('Jev client: in-time answers are used, late or failed ones fall back to rules', async () => {
  const peers = { bass: part('bass/pulse/medium') };
  const ctxs = { melody: ctxFor('melody', peers) };
  const reply = (ms, ok = true) => async () => {
    await new Promise((r) => setTimeout(r, ms));
    if (!ok) throw new Error('offline');
    return { ok: true, json: async () => ({ answers: { 'melody|level': { busy: 0.9, sparse: 0.1 } }, source: 'jev stand-in' }) };
  };
  const fast = new Jev({ library: lib, fetchFn: reply(5) });
  await fast.plan(6, ctxs, 300);
  assert.equal(fast.advice(6, 'melody').answers.level[3], 0.9);
  assert.equal(fast.stats.inTime, 1);

  const slow = new Jev({ library: lib, fetchFn: reply(120) });
  await slow.plan(6, ctxs, 40);
  assert.equal(slow.advice(6, 'melody'), null);
  assert.equal(slow.stats.late, 1);

  const dead = new Jev({ library: lib, fetchFn: reply(1, false) });
  await dead.plan(6, ctxs, 300);
  assert.equal(dead.advice(6, 'melody'), null);
  assert.equal(dead.stats.failed, 1);
  await dead.plan(7, ctxs, 300);
  assert.equal(dead.stats.asked, 1, 'backs off after a failure');
});

test('director: three devices converge on one proposal by majority, with no leader', async () => {
  const ids = ['aa', 'bb', 'cc'];
  const net = [];
  let clock = 1000;
  const mk = (id, delay) => new Director({
    id, now: () => clock++, liveCount: () => 3, maxDelayMs: 0,
    publish: (body) => net.push({ from: id, body }),
    request: async () => { await new Promise((r) => setTimeout(r, delay)); return { directive: { energy: id === 'aa' ? 0.9 : 0.2, feature: 'bass', note: id }, source: 'llm' }; },
  });
  const d = { aa: mk('aa', 30), bb: mk('bb', 5), cc: mk('cc', 60) };
  const pump = () => {
    while (net.length) {
      const { from, body } = net.shift();
      for (const id of ids) if (id !== from) body.type === 'proposal' ? d[id].onProposal(body) : d[id].onEndorse(body, from);
    }
  };
  for (const id of ids) d[id].maybePropose(2, () => 'state'); // third phrase of section 0
  for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 10)); pump(); }
  const adopted = ids.map((id) => d[id].current(4)?.pid);
  assert.deepEqual(adopted, ['bb:1', 'bb:1', 'bb:1'], 'the earliest proposal wins everywhere');
  assert.equal(d.aa.directiveFor(3).energy, 0.5, 'not before its section');
  assert.equal(d.aa.directiveFor(4).energy, 0.2);
  assert.equal(d.cc.directiveFor(9).energy, 0.2, 'kept until a newer one is adopted');
});

test('director: garbage from an LLM is rejected or clamped', () => {
  assert.equal(sanitiseDirective('hello'), null);
  assert.equal(sanitiseDirective({ energy: 'lots' }), null);
  const d = sanitiseDirective({ energy: 7, feature: 'kazoo', drop: 'chords', pair: { who: 'bass', mode: 'fight', whom: 'drums' }, note: '<script>x</script>' });
  assert.deepEqual({ ...d, note: undefined }, { energy: 1, feature: null, drop: null, pair: null, note: undefined });
  assert.ok(!d.note.includes('<'));
});

function simulate({ phrases = 40, seed = 7, directive = null, advice = null, library = lib }) {
  let t = 0;
  const rand = rng(seed);
  const parts = [];
  const e = new Engine({
    agents: ROLES.map((r) => new Agent(r, library, rand)), now: () => t, audio: { play() {} },
    onEvent: (ev) => parts.push(ev), getDirective: () => directive, getAdvice: advice || (() => null),
  });
  e.start(structure, 0);
  const end = phrases * 64 * stepMs(structure.bpm);
  for (t = 0; t < end; t += 50) e.tick();
  return parts;
}

test('simulation: 40 phrases of four agents reacting to each other stay valid and varied', () => {
  const parts = simulate({});
  assert.ok(parts.length >= 150);
  for (const { part: p, role } of parts) {
    for (const n of p.notes) {
      assert.ok(n.step >= 0 && n.step < 64 && n.dur > 0);
      if (n.midi != null) assert.ok(n.midi >= (role === 'bass' ? 26 : 45) && n.midi <= (role === 'bass' ? 70 : 98), `${role} ${n.midi} ${p.why}`);
    }
  }
  const late = parts.filter((x) => x.phrase >= 3);
  const interactions = late.filter((x) => x.part.d.interaction !== 'none');
  assert.ok(interactions.length / late.length > 0.15 && interactions.length / late.length < 0.85, `interaction share ${interactions.length}/${late.length}`);
  assert.ok(new Set(late.map((x) => `${x.role}:${x.part.d.interaction}`)).size >= 5, 'several kinds of echo/answer happen');
  // The drums keep their groove for a section (step A5), so with no direction they may hold one
  // level throughout: they still change pattern. The test below checks they follow the energy.
  for (const r of ROLES) {
    const mine = late.filter((x) => x.role === r);
    if (r === 'drums') assert.ok(new Set(mine.map((x) => x.part.loop?.id)).size >= 2, 'drums change pattern');
    else assert.ok(new Set(mine.map((x) => x.part.d.level)).size >= 2, `${r} changes busyness`);
  }
  // balance: the band's average level stays near the middle
  const avg = late.reduce((a, x) => a + x.part.d.level, 0) / late.length;
  assert.ok(avg > 1.5 && avg < 2.5, `average level ${avg}`);
});

test('simulation: energy direction and Jev advice both move the band', () => {
  const mean = (parts) => { const l = parts.filter((x) => x.phrase >= 3); return l.reduce((a, x) => a + x.part.d.level, 0) / l.length; };
  const low = mean(simulate({ directive: sanitiseDirective({ energy: 0.1 }) }));
  const high = mean(simulate({ directive: sanitiseDirective({ energy: 0.95 }) }));
  assert.ok(high - low > 0.6, `energy 0.95 → ${high.toFixed(2)}, energy 0.1 → ${low.toFixed(2)}`);
  const share = (parts) => { const l = parts.filter((x) => x.phrase >= 3 && x.role === 'melody'); return l.filter((x) => x.part.d.interaction === 'answer:bass').length / l.length; };
  const nudged = simulate({ advice: (p, role) => (role === 'melody' ? { source: 'jev', answers: { interaction: { 'answer:bass': 0.9, none: 0.1 } } } : null) });
  assert.ok(share(nudged) > share(simulate({})) + 0.25, `with Jev ${share(nudged).toFixed(2)} vs rules ${share(simulate({})).toFixed(2)}`);
  assert.ok(nudged.some((x) => x.part.source === 'rules + jev'));
});

test('instruments: chosen per section, families avoid each other, every voice has its samples on disk', async () => {
  const fs = await import('node:fs');
  const { VOICES, voiceById } = await import('../src/voices.js');
  for (const [role, list] of Object.entries(VOICES)) for (const v of list) {
    if (v.synth) continue;
    const files = v.kit ? ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3'].map((f) => `samples/kits/${v.kit}/${f}.mp3`) : v.files.map((n) => `samples/${v.dir}/${n.replace('#', 's')}.mp3`);
    for (const f of files) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `${role}/${v.id}: ${f}`);
  }
  const parts = simulate({ phrases: 33, seed: 11 });
  const voiceOf = (role, phrase) => parts.find((x) => x.role === role && x.phrase === phrase)?.part.d.voice;
  for (const r of ROLES) for (let ph = 1; ph < 32; ph++) {
    const a = voiceOf(r, ph - 1), b = voiceOf(r, ph);
    if (a && b && ph % 4 !== 0) assert.equal(b, a, `${r} changed instrument mid-section at phrase ${ph}`);
  }
  assert.ok(new Set(parts.map((x) => x.part.d.voice)).size >= 8, 'a range of instruments gets used');
  let clashes = 0, total = 0;
  for (let ph = 4; ph < 32; ph++) {
    const fams = ['chords', 'melody'].map((r) => voiceById[voiceOf(r, ph)]?.family);
    if (fams[0] && fams[1]) { total++; clashes += fams[0] === fams[1]; }
  }
  assert.ok(clashes / total < 0.2, `chords and melody share a family ${clashes}/${total}`);
  const synthShare = parts.filter((x) => voiceById[x.part.d.voice]?.synth).length / parts.length;
  assert.ok(synthShare < 0.15, `synth voices ${synthShare}`);
});

test('takeover: a device that gains a role continues the announced part, then decides from that history', () => {
  let t = 0;
  const e = new Engine({ agents: ROLES.map((r) => new Agent(r, lib, rng(5))), now: () => t, audio: { play() {} } });
  e.myRoles = new Set(['chords']);
  e.start(structure, 0);
  const theirs = part('bass/pulse/busy', { phrase: 3 });
  e.setRemotePart(3, 'bass', { notes: theirs.notes, d: { level: 3, style: 'pulse', register: 0, interaction: 'none' }, by: 'zz', why: 'pulse · busy' });
  e.ensureParts(3);
  assert.equal(e.lookup(3, 'bass').by, 'zz');
  e.myRoles = new Set(['chords', 'bass']); // zz vanished, I cover bass
  const entry = e.ensureParts(3);
  assert.deepEqual(entry.local.bass.notes, theirs.notes, 'same notes for the current phrase');
  const next = e.ensureParts(4).local.bass;
  assert.equal(e.context(4, 'bass').last.style, 'pulse', 'history comes from the shared score');
  assert.ok(next.d);
});

test('drums keep a groove inside a section and change busyness when the energy changes', () => {
  // energy 0.15 for two sections, then 0.95: the drums should be lighter first, busier after
  let t = 0;
  const rand = rng(11);
  const parts = [];
  const e = new Engine({
    agents: ROLES.map((r) => new Agent(r, lib, rand)), now: () => t, audio: { play() {} },
    onEvent: (ev) => parts.push(ev),
    getDirective: (p) => sanitiseDirective({ energy: p < 8 ? 0.15 : 0.95 }),
  });
  e.start(structure, 0);
  for (t = 0; t < 16 * 64 * stepMs(structure.bpm); t += 50) e.tick();
  const drums = parts.filter((x) => x.role === 'drums' && x.phrase >= 2 && x.phrase < 16);
  const lvl = (lo, hi) => drums.filter((x) => x.phrase >= lo && x.phrase < hi).map((x) => x.part.d.level);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(mean(lvl(9, 16)) > mean(lvl(2, 8)) + 0.5, `levels ${lvl(2, 8)} -> ${lvl(9, 16)}`);
  // inside a section (not its first phrase) the loop rarely changes
  const inside = drums.filter((x) => x.phrase % 4 !== 0);
  const prev = new Map(drums.map((x) => [x.phrase, x.part.loop?.id]));
  const changed = inside.filter((x) => prev.has(x.phrase - 1) && prev.get(x.phrase - 1) !== x.part.loop?.id).length;
  assert.ok(changed <= 3, `drums changed loop ${changed} times inside sections`);
});

test('packs: every loop is valid and renders in range in any key', async () => {
  const { PACK_LOOPS, PACK_PROGRESSIONS } = await import('../src/packs.js');
  const { validateLoop } = await import('../src/loops.js');
  assert.ok(PACK_LOOPS.length > 1000);
  const counts = {};
  for (const l of PACK_LOOPS) { validateLoop(l); counts[l.role] = (counts[l.role] || 0) + 1; }
  for (const r of ROLES) assert.ok(counts[r] > 50, `${r}: ${counts[r]}`);
  for (const [key, mode, progression] of [['E', 'minor', ['i', 'VI', 'III', 'VII']], ['Bb', 'major', ['I', 'V', 'vi', 'IV']], ['F#', 'minor', ['i', 'iv', 'v', 'i']]]) {
    const s = { key, mode, bpm: 90, progression };
    for (const l of PACK_LOOPS) {
      for (const register of l.role === 'drums' ? [0] : [0, 1]) {
        const { notes } = renderPhrase(l, { structure: s, phrase: 0, register });
        assert.ok(notes.length > 0, l.id);
        for (const n of notes) {
          assert.ok(n.step >= 0 && n.step < 64 && n.dur >= 1, `${l.id} ${JSON.stringify(n)}`);
          if (n.midi != null) assert.ok(n.midi >= 24 && n.midi <= 100, `${l.id} ${key} reg ${register}: ${n.midi}`);
          if (l.role === 'drums') assert.ok(['kick', 'snare', 'hat', 'ohat', 'tom1', 'tom2', 'tom3'].includes(n.drum), n.drum);
        }
      }
    }
  }
  for (const mode of ['major', 'minor']) for (const p of PACK_PROGRESSIONS[mode]) {
    assert.ok([4, 8].includes(p.chords.length) && p.mood, JSON.stringify(p));
    for (const c of p.chords) parseChord(c, 'D', mode);
  }
});

test('packs: a band using them stays valid, uses them, and keeps a groove for a while', async () => {
  const { PACK_LOOPS } = await import('../src/packs.js');
  const library = createLibrary({ packs: PACK_LOOPS });
  const parts = simulate({ phrases: 40, seed: 3, library });
  const late = parts.filter((x) => x.phrase >= 3 && x.part.loop);
  const fromPacks = late.filter((x) => /groove-|pop909|drolez-/.test(x.part.loop.style)).length / late.length;
  assert.ok(fromPacks > 0.5, `pack share ${fromPacks}`);
  for (const r of ROLES) assert.ok(new Set(late.filter((x) => x.role === r).map((x) => x.part.loop.id)).size >= 3, `${r} varies`);
  const drums = late.filter((x) => x.role === 'drums').map((x) => x.part.loop.id);
  const changes = drums.slice(1).filter((id, i) => id !== drums[i]).length;
  assert.ok(changes < drums.length * 0.7, `drum loop changed ${changes} times in ${drums.length} phrases`);
  for (const { part: p, role } of parts) for (const n of p.notes) if (n.midi != null) assert.ok(n.midi >= 24 && n.midi <= 100, `${role} ${n.midi}`);
});
