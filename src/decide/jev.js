// Jev client. Jev is a decision model: it reads a state and answers typed questions with
// probabilities. We send the shared score as the state and, for every option of every choice,
// one yes/no question ("should the bass go busy next phrase?"). The probabilities come back
// through the laptop's /decide relay (which holds the API key) and are blended into the rules.
//
// If the answer is not back by the deadline, or the relay is unreachable (server killed,
// airplane mode), advice() returns null and the rules decide alone.

import { describePart } from './context.js';
import { describeDirective, DEFAULT_DIRECTIVE } from './directive.js';
import { ruleScores } from './rules.js';
import { QUESTIONS } from './select.js';

const LEVEL_NAMES = ['rest for the whole phrase', 'play sparsely', 'play at medium density', 'play busily'];
const REG_NAMES = { '-1': 'low', 0: 'middle', 1: 'high' };

function instruction(role, q, opt) {
  const who = `the ${role}`;
  if (q === 'level') return `For the next phrase, should ${who} ${LEVEL_NAMES[opt]}?`;
  if (q === 'style') return `For the next phrase, should ${who} use the "${opt}" pattern?`;
  if (q === 'register') return `For the next phrase, should ${who} play in its ${REG_NAMES[opt]} register?`;
  if (opt === 'none') return `For the next phrase, should ${who} play its own part without imitating or answering anyone?`;
  const [mode, target] = opt.split(':');
  return mode === 'echo'
    ? `For the next phrase, should ${who} echo the ${target} (imitate its rhythm or melodic shape)?`
    : `For the next phrase, should ${who} answer the ${target} (play in the gaps it leaves, like call and response)?`;
}

export function buildState(ctxs) {
  const any = Object.values(ctxs)[0];
  const s = any.structure;
  const parts = {};
  for (const ctx of Object.values(ctxs)) {
    parts[ctx.role] = describePart(ctx.last);
    for (const [r, p] of Object.entries(ctx.peers)) if (!(r in parts) || parts[r] === 'unknown') parts[r] = describePart(p);
  }
  return [
    'A small band improvises together. Each part decides its next 4-bar phrase from what the others just played.',
    'Good ensemble playing: overall busyness matches the direction, parts leave each other room, registers do not collide, and parts imitate or answer each other now and then without repeating the same trick.',
    `Song: ${s.key} ${s.mode}, ${s.bpm} bpm, chords ${s.progression.join(' ')}. Deciding phrase ${any.phrase + 1}.`,
    `Direction for this section: ${describeDirective(any.directive || DEFAULT_DIRECTIVE)}.`,
    'What each part played last phrase (rhythm: 16 steps per bar, x = a note starts):',
    ...Object.entries(parts).map(([r, d]) => `- ${r}: ${d}`),
  ].join('\n');
}

export function buildQuestions(ctxs, library) {
  const questions = {};
  for (const ctx of Object.values(ctxs)) {
    const scores = ruleScores(ctx, library);
    for (const q of QUESTIONS) {
      const opts = Object.keys(scores[q]).filter((o) => scores[q][o] > 0);
      if (opts.length < 2) continue;
      for (const o of opts) questions[`${ctx.role}|${q}|${o}`] = { type: 'boolean', instructions: instruction(ctx.role, q, o) };
    }
  }
  return questions;
}

// { "bass|level|3": 0.7, ... } -> { bass: { level: { 3: 0.7 } } }
export function groupAnswers(answers) {
  const out = {};
  for (const [id, p] of Object.entries(answers || {})) {
    const [role, q, opt] = id.split('|');
    if (!role || !q || opt == null || !Number.isFinite(p)) continue;
    ((out[role] ||= {})[q] ||= {})[opt] = Math.min(1, Math.max(0, p));
  }
  return out;
}

export class Jev {
  constructor({ library, url = '/decide', fetchFn = (...a) => fetch(...a), onChange = () => {} }) {
    this.library = library;
    this.url = url;
    this.fetchFn = fetchFn;
    this.onChange = onChange;
    this.answers = new Map(); // phrase -> { role: { answers, source } }
    this.stats = { asked: 0, inTime: 0, late: 0, failed: 0, lastMs: null, source: null, state: 'idle' };
    this.pauseUntil = 0;
  }

  // Called 2 bars before the phrase; deadlineMs is how long until the agents compose.
  async plan(phrase, ctxs, deadlineMs) {
    if (Date.now() < this.pauseUntil) return;
    const questions = buildQuestions(ctxs, this.library);
    if (!Object.keys(questions).length) return;
    const body = JSON.stringify({ state: buildState(ctxs), questions });
    const started = Date.now();
    this.stats.asked++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(200, deadlineMs + 2000)); // let slow answers finish so we can count them
    try {
      const res = await this.fetchFn(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal });
      if (!res.ok) throw new Error(`relay answered ${res.status}`);
      const data = await res.json();
      const ms = Date.now() - started;
      this.stats.lastMs = ms;
      this.stats.source = data.source;
      if (ms <= deadlineMs) {
        const grouped = groupAnswers(data.answers);
        this.answers.set(phrase, Object.fromEntries(Object.entries(grouped).map(([role, a]) => [role, { answers: a, source: data.source }])));
        this.stats.inTime++;
        this.stats.state = 'answering';
      } else {
        this.stats.late++;
        this.stats.state = 'too slow';
      }
    } catch (err) {
      this.stats.failed++;
      this.stats.state = 'unreachable';
      this.pauseUntil = Date.now() + 8000; // don't hammer a dead relay
    } finally {
      clearTimeout(timer);
      for (const p of this.answers.keys()) if (p < phrase - 2) this.answers.delete(p);
      this.onChange();
    }
  }

  advice(phrase, role) {
    return this.answers.get(phrase)?.[role] || null;
  }
}
