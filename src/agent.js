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
import { ruleScores, runLength, SECTION_PHRASES } from './decide/rules.js';
import { decide, candidateDecisions, pickCandidate, CONTINUITY_BONUS_BY_ROLE, CONTINUITY_HOLD, QUESTIONS } from './decide/select.js';
import { applyInteraction } from './decide/transform.js';
import { fitScore, describeFit } from './decide/fit.js';
import { humanise } from './feel.js';
import { voiceById, DEFAULT_VOICE } from './voices.js';
import { applyTransitions, endNotes } from './transitions.js';
import { HOOK_ROLES } from './hooks.js';

export const HOOK_BONUS = 2; // bass and chords: the hook is strongly preferred, but a clash can still veto it

const LEVEL_NAMES = ['rest', 'sparse', 'medium', 'busy'];
export const CANDIDATES = 6; // K: how many parts an agent renders and scores before playing one
export const CANDIDATES_LITE = 4; // on a weak device

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export class Agent {
  constructor(role, library, random = Math.random, { candidates = CANDIDATES, feel = true } = {}) {
    this.role = role;
    this.feel = feel; // false (?feel=off): the winner is played straight, for A/B listening only
    this.library = library;
    this.random = random;
    this.candidates = candidates;
    this.auto = true; // false: level and register are pinned by hand
    this.level = 2;
    this.register = 0;
    this.voice = null; // pinned instrument when auto is off
    this.pinVoice = null; // an instrument pinned while everything else stays automatic (?voice=)
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
    const loop = cand.loopId ? this.library.get(cand.loopId) : this.library.find(this.role, d.style, DENSITIES[d.level - 1], { random: this.random, prefer: cand.prefer });
    if (!loop) return { ...cand, notes: [], loop: null, missing: true };
    const base = renderPhrase(loop, { structure: ctx.structure, phrase: ctx.phrase, register: d.register, prevVoicing: this.prevVoicing });
    const env = { role: this.role, level: d.level, register: d.register, structure: ctx.structure, phrase: ctx.phrase };
    return { ...cand, notes: applyInteraction(base.notes, d.interaction, ctx.peers, env), loop, voicing: base.voicing };
  }

  // The coda after the last outro (form.js END_SECTION): one note on the downbeat, same instrument.
  endPart(ctx) {
    const voice = ctx.last?.voice ?? this.voice ?? DEFAULT_VOICE[this.role];
    const kept = ctx.last?.voice === voice && ctx.last.phrase === ctx.phrase - 1;
    const d = { level: 1, style: ctx.last?.style ?? 'end', register: 0, interaction: 'none', voice, voiceSince: kept ? ctx.last.voiceSince ?? ctx.last.phrase : ctx.phrase };
    return { notes: endNotes(this.role, ctx.structure), loop: null, d, p: {}, dist: {}, source: 'form', reasons: [], fit: null, candidates: 1, rank: 1, chance: 1, why: 'the last chord' };
  }

  // In a hook section, the part's hook loop (hooks.js), if this device has it.
  hookLoop(ctx) {
    if (!HOOK_ROLES.includes(this.role) || !ctx.hookEntry) return null;
    return this.library.get?.(ctx.hookEntry.loopId) || null;
  }

  // ctx: from decide/context.js. advice: Jev's answer for this role and phrase, or null.
  compose(ctx, advice = null) {
    if (ctx.directive?.end) return this.endPart(ctx);
    const hookLoop = this.hookLoop(ctx);
    // In a verse, the melody is scored against the hook too (fit.js continuity), so it relates to it.
    if (hookLoop && !ctx.hook && this.role === 'melody') {
      ctx = { ...ctx, hookRef: renderPhrase(hookLoop, { structure: ctx.structure, phrase: ctx.phrase, register: ctx.hookEntry.register }).notes };
    }
    const scores = ruleScores(ctx, this.library);
    // pinVoice (?voice=<role>:<id>) pins only the instrument and leaves the rest automatic.
    const pins = this.auto ? (this.pinVoice ? { voice: this.pinVoice } : null) : { level: this.level, register: this.register, voice: this.voice };
    const { d: sampled, dist, usedJev } = decide(scores, advice?.answers, pins, this.random);
    const source = usedJev ? `rules + ${advice.source}` : 'rules';

    // The first time a hook is played it will be repeated in every chorus: look twice as hard, and
    // take the best fit rather than a sample (below).
    const choosingHook = ctx.hook && HOOK_ROLES.includes(this.role) && !ctx.hookEntry;
    const drawn = candidateDecisions(dist, sampled, {
      pins,
      last: ctx.last,
      prefer: this.lastLoopId,
      k: choosingHook ? this.candidates * 2 : this.candidates,
      random: this.random,
    });
    // A hook section: the hook goes in first, as it was first played.
    if (hookLoop && ctx.hook) {
      const hd = { ...sampled, level: DENSITIES.indexOf(hookLoop.density) + 1, style: hookLoop.style, register: ctx.hookEntry.register, interaction: 'none' };
      drawn.unshift({ d: hd, kind: 'hook', loopId: hookLoop.id });
    }
    const cands = drawn.map((c) => this.renderCandidate(c, ctx));
    for (const c of cands) {
      if (c.notes.length) c.fit = fitScore(c.notes, { role: this.role, ctx, d: c.d });
    }
    // A part with no notes is neither a good nor a bad fit, so it takes the middle of what the
    // others scored: resting stays as likely as the rules think it should be.
    const neutral = median(cands.filter((c) => c.fit).map((c) => c.fit.total)) ?? 0.5;
    // Keep the groove for the section: a candidate that replays exactly last phrase's loop gets a
    // role-specific bonus (step A5), except on the first phrase of a director section, where the
    // band is free to change. Depends only on the phrase number, so every device agrees.
    // Chords and melody only get it while the pattern is still new (held < 3 phrases), as before.
    const held = runLength(ctx.history, 'style');
    const fresh = held < (CONTINUITY_HOLD[this.role] ?? Infinity);
    const newSection = ctx.phrase % SECTION_PHRASES === 0 || !!ctx.directive?.isFirstPhrase;
    const bonus = newSection || !fresh ? 0 : CONTINUITY_BONUS_BY_ROLE[this.role] ?? 0;
    for (const c of cands) {
      c.fit ||= { total: neutral, terms: {} };
      c.bonus = (c.loop && c.loop.id === this.lastLoopId ? bonus : 0) + (c.kind === 'hook' ? HOOK_BONUS : 0);
    }

    const picked = pickCandidate(cands, { dist, random: this.random });
    // The melody's hook wins outright: the chorus is the chorus.
    const hookIndex = cands.findIndex((c) => c.kind === 'hook' && c.notes.length);
    const best = cands.reduce((b, c, i) => (c.notes.length && (b < 0 || c.fit.total > cands[b].fit.total) ? i : b), -1);
    const index = this.role === 'melody' && hookIndex >= 0 ? hookIndex : choosingHook && best >= 0 ? best : picked.index;
    const probs = picked.probs;
    const win = cands[index];
    // The phrase this instrument started, carried in the shared score so every device can tell
    // how long each part has held its instrument (rules.js voiceTurn).
    const kept = ctx.last?.voice === win.d.voice && ctx.last.phrase === ctx.phrase - 1;
    const d = { ...win.d, voiceSince: kept ? ctx.last.voiceSince ?? ctx.last.phrase : ctx.phrase };
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

    // The seams between sections (transitions.js): fills, crash, riser, the breakdown's drop.
    const arranged = applyTransitions(win.notes, { role: this.role, dir: ctx.directive, structure: ctx.structure, phrase: ctx.phrase });
    if (!arranged.length) {
      const why = d.level === 0 ? `resting${reasons[0] ? ` (${reasons[0]})` : ''}` : `no "${d.style}" pattern in my library`;
      return { notes: [], ...meta, why };
    }
    // Last step: the groove. Deterministic from (seed, phrase, role, note), so the device that
    // takes this part over or doubles it plays the same performance, down to the millisecond.
    const notes = !this.feel ? arranged : humanise(arranged, {
      role: this.role,
      phrase: ctx.phrase,
      seed: ctx.structure.seed,
      voice: d.voice,
      bpm: ctx.structure.bpm,
    });

    const bits = [voiceById[d.voice]?.label ?? d.voice, d.style.replace(/^groove-/, '').replace(/^drolez-/, ''), LEVEL_NAMES[d.level]];
    if (d.register) bits.push(d.register > 0 ? 'high' : 'low');
    if (d.interaction !== 'none') bits.push(d.interaction.replace('echo:', 'echoes ').replace('answer:', 'answers '));
    if (win.kind === 'hook') bits.push('the hook');
    if (cands.length > 1) bits.push(describeFit(win.fit, cands.length));
    return { notes, loop: win.loop, ...meta, why: bits.join(' · ') };
  }
}
