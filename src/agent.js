// An agent owns one role. For every phrase it makes four decisions from the shared score:
// how busy, which pattern, which register, and whether to echo or answer another part.
//
//   rules.js   -> a weight for every option (always available, works offline)
//   Jev        -> probabilities for the same options, if they arrived before the deadline
//   select.js  -> blends the two and samples the final choice
//   transform.js -> turns "echo/answer X" into notes
//
// The agent keeps almost no state: its history is read from the shared score, so a device that
// takes a part over carries on from what the previous player did.

import { DENSITIES } from './loops.js';
import { renderPhrase } from './render.js';
import { ruleScores } from './decide/rules.js';
import { decide } from './decide/select.js';
import { applyInteraction } from './decide/transform.js';
import { voiceById } from './voices.js';

const LEVEL_NAMES = ['rest', 'sparse', 'medium', 'busy'];

export class Agent {
  constructor(role, library, random = Math.random) {
    this.role = role;
    this.library = library;
    this.random = random;
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

  // ctx: from decide/context.js. advice: Jev's answer for this role and phrase, or null.
  compose(ctx, advice = null) {
    const scores = ruleScores(ctx, this.library);
    const pins = this.auto ? null : { level: this.level, register: this.register, voice: this.voice };
    const { d, p, dist, usedJev } = decide(scores, advice?.answers, pins, this.random);
    const source = usedJev ? `rules + ${advice.source}` : 'rules';
    if (this.auto) {
      this.level = d.level;
      this.register = d.register;
      this.voice = d.voice;
    }
    const reasons = scores.reasons.filter((r) => !r.when || r.when(d)).map((r) => r.text);
    const meta = { d, p, dist, source, reasons };

    if (d.level === 0) return { notes: [], ...meta, why: `resting${reasons[0] ? ` (${reasons[0]})` : ''}` };
    const loop = this.library.find(this.role, d.style, DENSITIES[d.level - 1], { random: this.random, prefer: this.lastLoopId });
    if (loop) this.lastLoopId = loop.id;
    if (!loop) return { notes: [], ...meta, why: `no "${d.style}" pattern in my library` };

    const env = { role: this.role, level: d.level, register: d.register, structure: ctx.structure, phrase: ctx.phrase };
    const base = renderPhrase(loop, { structure: ctx.structure, phrase: ctx.phrase, register: d.register, prevVoicing: this.prevVoicing });
    this.prevVoicing = base.voicing;
    const notes = applyInteraction(base.notes, d.interaction, ctx.peers, env);

    const bits = [voiceById[d.voice]?.label ?? d.voice, d.style.replace(/^groove-/, '').replace(/^drolez-/, ''), LEVEL_NAMES[d.level]];
    if (d.register) bits.push(d.register > 0 ? 'high' : 'low');
    if (d.interaction !== 'none') bits.push(d.interaction.replace('echo:', 'echoes ').replace('answer:', 'answers '));
    return { notes, loop, ...meta, why: bits.join(' · ') };
  }
}
