// Jev client. Jev is a decision model: it reads a state and answers typed questions with
// probabilities. We send the shared score as the state and one "choice" question per decision
// ("how busy should the bass be next phrase?" with the options as criteria). The probabilities come back
// through the laptop's /decide relay (which holds the API key) and are blended into the rules.
//
// If the answer is not back by the deadline, or the relay is unreachable (server killed,
// airplane mode), advice() returns null and the rules decide alone.

import { describePart } from './context.js';
import { describeDirective, DEFAULT_DIRECTIVE } from './directive.js';
import { ruleScores } from './rules.js';
import { QUESTIONS } from './select.js';
import { voiceById } from '../voices.js';

// Each of an agent's four choices is one Jev "choice" question: the options go in `criteria`
// (a safe key and a description each) and Jev returns a probability for every key.
const LEVEL_KEYS = ['rest', 'sparse', 'medium', 'busy'];
const LEVEL_TEXT = ['Stay silent for the whole phrase', 'Play sparsely, leaving a lot of space', 'Play at medium density', 'Play busily, with many notes'];
const REG_KEYS = { '-1': 'low', 0: 'middle', 1: 'high' };
const QUESTION_TEXT = {
  level: (role) => `How busy should the ${role} be in the next phrase?`,
  style: (role) => `Which pattern should the ${role} use in the next phrase?`,
  register: (role) => `Which register should the ${role} play in for the next phrase?`,
  interaction: (role) => `Should the ${role} react to another part in the next phrase?`,
  voice: (role) => `Which instrument should play the ${role} part in the next section?`,
};

// option (as used by rules.js) -> [safe key, description]
function criterion(q, opt) {
  if (q === 'level') return [LEVEL_KEYS[opt], LEVEL_TEXT[opt]];
  if (q === 'style') return [`pattern_${String(opt).replace(/[^a-zA-Z0-9]/g, '_')}`, `The "${opt}" pattern`];
  if (q === 'register') return [REG_KEYS[opt], `Its ${REG_KEYS[opt]} register`];
  if (q === 'voice') return [`voice_${String(opt).replace(/[^a-zA-Z0-9]/g, '_')}`, voiceById[opt]?.label ?? opt];
  if (opt === 'none') return ['none', 'Play its own part without imitating or answering anyone'];
  const [mode, target] = opt.split(':');
  return mode === 'echo'
    ? [`echo_${target}`, `Echo the ${target}: imitate its rhythm or melodic shape`]
    : [`answer_${target}`, `Answer the ${target}: play in the gaps it leaves, like call and response`];
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
    `Song: ${s.key} ${s.mode}, ${s.bpm} bpm, chords ${s.progression.join(' ')}${s.mood ? `, mood: ${s.mood}` : ''}. Deciding phrase ${any.phrase + 1}.`,
    `Direction for this section: ${describeDirective(any.directive || DEFAULT_DIRECTIVE)}.`,
    'What each part played last phrase (rhythm: 16 steps per bar, x = a note starts):',
    ...Object.entries(parts).map(([r, d]) => `- ${r}: ${d}`),
  ].join('\n');
}

// Returns { questions, decode } where decode maps "role|choice" and Jev's key back to the option.
export function buildQuestions(ctxs, library) {
  const questions = {}, decode = {};
  for (const ctx of Object.values(ctxs)) {
    const scores = ruleScores(ctx, library);
    for (const q of QUESTIONS) {
      const opts = Object.keys(scores[q]).filter((o) => scores[q][o] > 0);
      if (opts.length < 2) continue;
      const id = `${ctx.role}|${q}`;
      const criteria = {};
      decode[id] = {};
      for (const o of opts) {
        const [key, text] = criterion(q, o);
        criteria[key] = text;
        decode[id][key] = o;
      }
      questions[id] = { type: 'choice', instructions: QUESTION_TEXT[q](ctx.role), criteria };
    }
  }
  return { questions, decode };
}

// { "bass|level": { busy: 0.7, sparse: 0.1 } } -> { bass: { level: { 3: 0.7, 1: 0.1 } } }
export function groupAnswers(answers, decode) {
  const out = {};
  for (const [id, probs] of Object.entries(answers || {})) {
    const [role, q] = id.split('|');
    if (!decode[id] || !probs || typeof probs !== 'object') continue;
    for (const [key, p] of Object.entries(probs)) {
      const opt = decode[id][key];
      if (opt == null || !Number.isFinite(p)) continue;
      ((out[role] ||= {})[q] ||= {})[opt] = Math.min(1, Math.max(0, p));
    }
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
    const { questions, decode } = buildQuestions(ctxs, this.library);
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
        const grouped = groupAnswers(data.answers, decode);
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
