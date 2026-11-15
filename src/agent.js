// An agent owns one role. For every phrase it makes four decisions from the shared score:
// how busy, which pattern, which register, and whether to echo or answer another part.
//
//   rules.js   -> a weight for every option (always available, works offline)
//   Jev        -> probabilities for the same options, if they arrived before the deadline
//   select.js  -> blends the two into a distribution per question
//   ...then, instead of playing one sample of that distribution (Phase 3):
//   select.js  -> draws K candidate decisions from it (always including "the most likely" and
//                 "carry on with what I played last phrase")
//   render.js + transform.js -> turns each candidate into real notes
//   fit.js     -> scores each candidate against the chords, the other parts and my own last phrase
//   select.js  -> picks one: log(prior) + 6 x fit, softmaxed, so it is likely *and* it fits
//   feel.js    -> humanises the winner only
//
// The agent keeps almost no state: its history is read from the shared score, so a device that
// takes a part over carries on from what the previous player did.

import { DENSITIES } from './loops.js';
import { renderPhrase } from './render.js';
import { ruleScores, runLength } from './decide/rules.js';
import { decide, candidateDecisions, pickCandidate, CONTINUITY_BONUS, QUESTIONS } from './decide/select.js';
import { applyInteraction } from './decide/transform.js';
import { fitScore, describeFit } from './decide/fit.js';
import { humanise } from './feel.js';
import { voiceById } from './voices.js';

const LEVEL_NAMES = ['rest', 'sparse', 'medium', 'busy'];
export const CANDIDATES = 6; // K: how many parts an agent renders and scores before playing one
export const CANDIDATES_LITE = 4; // on a weak device

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export class Agent {
  constructor(role, library, random = Math.random, { candidates = CANDIDATES } = {}) {
    this.role = role;
    this.library = library;
    this.random = random;
    this.candidates = candidates;
    this.auto = true; // false: level and register are pinned by hand
    this.level = 2;
    this.register = 0;
    this.voice = null; // pinned instrument when auto is off
    this.prevVoicing = null;
  }

  reset() {
    this.prevVoicing = null;
    this.lastLoopId = null;
  }

  // One candidate decision -> real notes. Nothing here touches the agent's own state: the winner
  // updates it afterwards, so a candidate that loses leaves no trace.
  renderCandidate(cand, ctx) {
    const { d } = cand;
    if (d.level === 0) return { ...cand, notes: [], loop: null };
    const loop = this.library.find(this.role, d.style, DENSITIES[d.level - 1], { random: this.random, prefer: cand.prefer });
    if (!loop) return { ...cand, notes: [], loop: null, missing: true };
    const base = renderPhrase(loop, { structure: ctx.structure, phrase: ctx.phrase, register: d.register, prevVoicing: this.prevVoicing });
    const env = { role: this.role, level: d.level, register: d.register, structure: ctx.structure, phrase: ctx.phrase };
    return { ...cand, notes: applyInteraction(base.notes, d.interaction, ctx.peers, env), loop, voicing: base.voicing };
  }

  // ctx: from decide/context.js. advice: Jev's answer for this role and phrase, or null.
  compose(ctx, advice = null) {
    const scores = ruleScores(ctx, this.library);
    const pins = this.auto ? null : { level: this.level, register: this.register, voice: this.voice };
    const { d: sampled, dist, usedJev } = decide(scores, advice?.answers, pins, this.random);
    const source = usedJev ? `rules + ${advice.source}` : 'rules';

    const drawn = candidateDecisions(dist, sampled, {
      pins,
      last: ctx.last,
      prefer: this.lastLoopId,
      k: this.candidates,
      random: this.random,
    });
    const cands = drawn.map((c) => this.renderCandidate(c, ctx));
    for (const c of cands) {
      if (c.notes.length) c.fit = fitScore(c.notes, { role: this.role, ctx, d: c.d });
    }
    // A part with no notes is neither a good nor a bad fit, so it takes the middle of what the
    // others scored: resting stays as likely as the rules think it should be.
    const neutral = median(cands.filter((c) => c.fit).map((c) => c.fit.total)) ?? 0.5;
    const held = runLength(ctx.history, 'style');
    for (const c of cands) {
      c.fit ||= { total: neutral, terms: {} };
      c.bonus = c.kind === 'continuity' && held < 3 ? CONTINUITY_BONUS : 0; // keep a new groove
    }

    const { index, probs } = pickCandidate(cands, { dist, random: this.random });
    const win = cands[index];
    const d = win.d;
    if (this.auto) {
      this.level = d.level;
      this.register = d.register;
      this.voice = d.voice;
    }
    if (win.voicing) this.prevVoicing = win.voicing;
    if (win.loop) this.lastLoopId = win.loop.id;

    const p = {};
    for (const q of QUESTIONS) if (dist[q]) p[q] = dist[q][String(d[q])] ?? 1;
    const reasons = scores.reasons.filter((r) => !r.when || r.when(d)).map((r) => r.text);
    const rank = 1 + cands.filter((c) => c.fit.total > win.fit.total).length;
    const meta = { d, p, dist, source, reasons, fit: win.fit, candidates: cands.length, rank, chance: probs[index] };

    if (!win.notes.length) {
      const why = d.level === 0 ? `resting${reasons[0] ? ` (${reasons[0]})` : ''}` : `no "${d.style}" pattern in my library`;
      return { notes: [], ...meta, why };
    }
    // Last step: the groove. Deterministic from (seed, phrase, role, note), so the device that
    // takes this part over or doubles it plays the same performance, down to the millisecond.
    const notes = humanise(win.notes, {
      role: this.role,
      phrase: ctx.phrase,
      seed: ctx.structure.seed,
      voice: d.voice,
      bpm: ctx.structure.bpm,
    });

    const bits = [voiceById[d.voice]?.label ?? d.voice, d.style.replace(/^groove-/, '').replace(/^drolez-/, ''), LEVEL_NAMES[d.level]];
    if (d.register) bits.push(d.register > 0 ? 'high' : 'low');
    if (d.interaction !== 'none') bits.push(d.interaction.replace('echo:', 'echoes ').replace('answer:', 'answers '));
    if (cands.length > 1) bits.push(describeFit(win.fit, cands.length));
    return { notes, loop: win.loop, ...meta, why: bits.join(' · ') };
  }
}
