// The engine keeps the shared score for the last few phrases, has the local agents compose their
// parts ahead of the playhead, and sends notes to the audio layer shortly before they are due.
//
// Horizons before a phrase starts, per role (Phase 6: staggered decisions):
//   plan ahead    (compose + 1 bar): the context is built and sent to Jev (onPlan, per group)
//   compose ahead (drums and chords 2 bars, bass 1.5, melody 1): the agent decides, using Jev's
//                  answer if it has arrived. Because the bass decides after the drums and chords,
//                  and the melody after all three, each one hears the others' *next* phrase.
//   candidates    (compose + 0.5 bar, roles composing >= 1.5 bars ahead, when onCandidates is
//                  given): the agent prepares its candidates and Jev is asked to rank them; at the
//                  compose horizon the agent finishes, with Jev's ranking if it came back in time
//   audio ahead   (150 ms): notes are handed to Web Audio
//
// Only roles in `myRoles` are composed here. Other roles come from the devices that play them
// (setRemotePart). A role in `doubling` is not composed: this device plays the owner's notes.
//
// A note sounds at `step + swingOffset(step) + nudge` sixteenths into the phrase: the swing comes
// from the shared structure and the nudge was baked into the note by feel.js at compose time, so
// every device that plays this part puts the note in exactly the same place.

import { stepMs, phraseStartMs, position, STEPS_PER_PHRASE } from './clock.js';
import { buildContext } from './decide/context.js';
import { swingOffset } from './feel.js';
import { DEFAULT_DIRECTIVE } from './decide/directive.js';
import { HookBook, HOOK_ROLES } from './hooks.js';
import { candidateKey } from './decide/select.js';

// Later agents see what earlier ones just decided (on one device, in the same tick).
const ORDER = ['drums', 'perc', 'bass', 'chords', 'pad', 'melody', 'arp'];
const KEEP_PHRASES = 5;
// The arp decides last, after the melody, so on its own phone it still hears the melody's phrase.
export const COMPOSE_AHEAD = { drums: 2, chords: 2, pad: 2, perc: 1.5, bass: 1.5, melody: 1, arp: 0.75 }; // bars
const CANDIDATE_LEAD = 0.5; // bars between preparing the candidates and choosing one
const CANDIDATE_MIN_AHEAD = 1.5; // only roles composing at least this far ahead ask Jev to rank

export class Engine {
  constructor({ agents, audio, now, onEvent, onPlan, getAdvice, getDirective, composeAhead = COMPOSE_AHEAD, composeAheadBars = null, planAheadBars = null, audioAheadMs = 150, swing = true, hooks = null, id = 'local', onCandidates = null, getCandidateAdvice = null }) {
    this.agents = Object.fromEntries(agents.map((a) => [a.role, a]));
    this.roles = ORDER.filter((r) => this.agents[r]);
    this.audio = audio; // { play(role, note, whenMs, durMs, voiceId, stepMs) }  whenMs on the same clock as now()
    this.now = now;
    this.onEvent = onEvent || (() => {});
    this.onPlan = onPlan || (() => {});
    this.getAdvice = getAdvice || (() => null);
    this.getDirective = getDirective || (() => DEFAULT_DIRECTIVE);
    // composeAheadBars (one number for every role) is the old option, still accepted.
    this.composeAhead = Object.fromEntries(ORDER.map((r) => [r, composeAheadBars ?? composeAhead[r] ?? 1]));
    this.planAhead = Object.fromEntries(ORDER.map((r) => [r, planAheadBars ?? this.composeAhead[r] + 1]));
    this.composeAheadBars = Math.max(...Object.values(this.composeAhead)); // the longest, for old callers
    this.onCandidates = onCandidates; // (phrase, role, prepared, deadlineMs): ask Jev to rank
    this.getCandidateAdvice = getCandidateAdvice || (() => null);
    this.prepared = new Map(); // "phrase|role" -> prepared candidates waiting for Jev
    this.audioAheadMs = audioAheadMs;
    // false (?feel=off): the shared swing is ignored on this device. A/B listening on one device only:
    // with several devices playing together, the device with it off would be out of time.
    this.swing = swing;
    this.hooks = hooks || new HookBook(); // shared with main.js, which records the swarm's hooks
    this.id = id;
    this.ended = false;
    this.myRoles = new Set(this.roles);
    this.doubling = new Set();
    this.phrases = new Map(); // phrase -> { local: { role: part }, sent: Set }
    this.remote = new Map(); // phrase -> { role: part }
    this.planned = new Set();
    this.structure = null;
    this.startMs = null;
  }

  start(structure, startMs) {
    this.structure = structure;
    this.startMs = startMs;
    this.phrases.clear();
    this.remote.clear();
    this.planned.clear();
    this.prepared.clear();
    this.ended = false;
    for (const a of Object.values(this.agents)) a.reset();
  }

  stop() {
    this.startMs = null;
  }

  setRemotePart(phrase, role, part) {
    if (!this.remote.has(phrase)) this.remote.set(phrase, {});
    this.remote.get(phrase)[role] = part;
  }

  // The part known for a role in a phrase, whoever plays it.
  lookup(phrase, role) {
    const local = this.phrases.get(phrase)?.local[role];
    const remote = this.remote.get(phrase)?.[role];
    if (this.myRoles.has(role) && !this.doubling.has(role)) return local || remote || null;
    return remote || local || null;
  }

  partsFor(phrase) {
    if (!this.phrases.has(phrase)) return null;
    const out = {};
    for (const role of this.roles) out[role] = this.lookup(phrase, role) || { notes: [], why: 'waiting for the device playing it', pending: true };
    return out;
  }

  context(phrase, role) {
    return buildContext({
      role,
      phrase,
      structure: this.structure,
      roles: this.roles,
      lookup: (p, r) => this.lookup(p, r),
      hookEntry: this.hooks.get(role),
      directive: this.getDirective(phrase),
      prevDirective: phrase > 0 ? this.getDirective(phrase - 1) : null,
    });
  }

  entryFor(phrase) {
    let entry = this.phrases.get(phrase);
    if (!entry) {
      entry = { phrase, local: {}, sent: new Set() };
      this.phrases.set(phrase, entry);
    }
    for (const role of Object.keys(entry.local)) {
      const stale = !this.myRoles.has(role) || (this.doubling.has(role) && !entry.local[role].doubled);
      if (!stale) continue;
      delete entry.local[role]; // handed over to another device
      for (const k of [...entry.sent]) if (k.startsWith(`${role}:`)) entry.sent.delete(k);
    }
    return entry;
  }

  // Make sure every role this device sounds has a part for the phrase (the current phrase when
  // joining mid-song or after a takeover; tests).
  ensureParts(phrase) {
    const entry = this.entryFor(phrase);
    for (const role of this.roles) this.ensurePart(phrase, role, entry);
    return entry;
  }

  // One role's part for the phrase: doubled, taken over, or composed here.
  ensurePart(phrase, role, entry = this.entryFor(phrase)) {
    if (!this.myRoles.has(role) || entry.local[role]) return entry.local[role] || null;
    if (this.doubling.has(role)) {
      const theirs = this.remote.get(phrase)?.[role];
      if (theirs) entry.local[role] = { ...theirs, doubled: true, why: `doubling ${theirs.by ?? 'the owner'}: ${theirs.why}` };
      return entry.local[role] || null;
    }
    const announced = this.remote.get(phrase)?.[role];
    if (announced && announced.by) {
      // Taking a part over: play what the previous player already announced for this phrase.
      entry.local[role] = { ...announced, why: `${announced.why} (taken over from ${announced.by})` };
      return entry.local[role];
    }
    const agent = this.agents[role];
    const key = `${phrase}|${role}`;
    let ctx = this.context(phrase, role);
    let part;
    const prepared = this.prepared.get(key);
    if (prepared && agent.finish) {
      this.prepared.delete(key);
      // A peer's part for this phrase arrived after the candidates were prepared: prepare again
      // (cheap), so the choice hears it. Jev's ranking still applies to candidates that match.
      let p = prepared;
      if (freshPeers(ctx) > freshPeers(prepared.ctx)) p = agent.prepare(ctx, this.getAdvice(phrase, role));
      part = agent.finish(p, { jev: this.getCandidateAdvice(phrase, role) });
      ctx = p.ctx || ctx;
    } else {
      part = agent.compose(ctx, this.getAdvice(phrase, role));
    }
    entry.local[role] = part;
    // The first phrase of the first hook section: what this part played becomes its hook.
    const dir = ctx.directive;
    if (dir?.hook && dir.isFirstPhrase && HOOK_ROLES.includes(role) && part.loop && !this.hooks.get(role)) {
      const hook = { role, loopId: part.loop.id, register: part.d.register ?? 0, phrase, by: this.id };
      if (this.hooks.record(hook)) this.onEvent({ type: 'hook', hook });
    }
    const startsInMs = phraseStartMs(phrase, this.startMs, this.structure.bpm) - this.now();
    this.onEvent({ type: 'part', phrase, role, part, startsInMs });
    return part;
  }

  // Prepare a role's candidates early and ask Jev to rank them (Phase 3d).
  prepareCandidates(phrase, role, deadlineMs) {
    const key = `${phrase}|${role}`;
    const agent = this.agents[role];
    if (this.prepared.has(key) || !agent.prepare || this.phrases.get(phrase)?.local[role]) return;
    const prepared = agent.prepare(this.context(phrase, role), this.getAdvice(phrase, role));
    if (prepared.final) return; // nothing to choose (the coda)
    prepared.keys = prepared.cands.map(candidateKey);
    this.prepared.set(key, prepared);
    this.onCandidates?.(phrase, role, prepared, deadlineMs);
  }

  // Call often (every ~25 ms).
  tick() {
    if (this.startMs == null) return;
    const now = this.now();
    const { bpm } = this.structure;
    const sMs = stepMs(bpm);
    const cur = Math.max(0, position(now, this.startMs, bpm).phrase);
    const next = cur + 1;
    const untilNext = phraseStartMs(next, this.startMs, bpm) - now;

    // The end of a song that ends (form.js): after the coda's chord has rung for three bars, stop.
    const here = this.getDirective(cur);
    if (here?.ended || (here?.end && now - phraseStartMs(cur, this.startMs, bpm) >= 48 * sMs)) {
      if (!this.ended) {
        this.ended = true;
        this.onEvent({ type: 'end', phrase: cur });
      }
      return this.stop();
    }
    const nextEnded = !!this.getDirective(next)?.ended;

    this.ensureParts(cur); // at the start, when joining mid-song, or when a role was just taken over
    if (!nextEnded) {
      const barMs = 16 * sMs;
      const live = (r) => this.myRoles.has(r) && !this.doubling.has(r) && this.agents[r];
      // Roles that decide at the same horizon are planned together (drums + chords, bass, melody).
      const horizons = [...new Set(this.roles.filter(live).map((r) => this.composeAhead[r]))].sort((a, b) => b - a);
      horizons.forEach((ahead) => {
        const roles = this.roles.filter((r) => live(r) && this.composeAhead[r] === ahead);
        const key = `${next}|${ahead}`;
        if (!this.planned.has(key) && untilNext <= Math.max(...roles.map((r) => this.planAhead[r])) * barMs) {
          this.planned.add(key);
          this.onPlan(next, Object.fromEntries(roles.map((r) => [r, this.context(next, r)])), untilNext - ahead * barMs, roles);
        }
      });
      const entry = this.entryFor(next);
      for (const role of this.roles) {
        if (!this.myRoles.has(role)) continue;
        if (this.doubling.has(role)) { this.ensurePart(next, role, entry); continue; } // copy the owner's part as soon as it is announced
        const ahead = this.composeAhead[role];
        if (this.onCandidates && ahead >= CANDIDATE_MIN_AHEAD && untilNext <= (ahead + CANDIDATE_LEAD) * barMs && untilNext > ahead * barMs)
          this.prepareCandidates(next, role, untilNext - ahead * barMs);
        if (untilNext <= ahead * barMs) this.ensurePart(next, role, entry);
      }
    }

    // Notes reach Web Audio at least audioAheadMs before they sound, and 100 ms more than the
    // device's output latency (bigger audio buffers mean a later speaker; see audio.js).
    // minAheadMs: main.js asks for more while the page is in the background, where the browser
    // and Windows slow the page down and a late tick would otherwise lose notes.
    const ahead = Math.max(this.audioAheadMs, (this.audio.latencyMs?.() || 0) + 100, this.audio.minAheadMs?.() || 0);
    for (const p of [cur, next]) {
      const entry = this.phrases.get(p);
      if (!entry) continue;
      const t0 = phraseStartMs(p, this.startMs, bpm);
      for (const role of this.myRoles) {
        const part = entry.local[role];
        if (!part) continue;
        part.notes.forEach((n, i) => {
          const key = `${role}:${i}`;
          if (entry.sent.has(key)) return;
          const when = t0 + (n.step + (this.swing ? swingOffset(n.step, this.structure.swing) : 0) + (n.nudge || 0)) * sMs;
          if (when > now + ahead) return;
          entry.sent.add(key);
          if (when < now - 20) return; // too late (joined mid-phrase, or tab throttled): skip
          this.audio.play(role, n, when, n.dur * sMs, part.d?.voice, sMs);
        });
      }
    }

    for (const p of this.phrases.keys()) if (p < cur - KEEP_PHRASES) this.phrases.delete(p);
    for (const p of this.remote.keys()) if (p < cur - KEEP_PHRASES) this.remote.delete(p);
    for (const k of this.planned) if (parseInt(k, 10) < cur) this.planned.delete(k);
    for (const k of this.prepared.keys()) if (parseInt(k, 10) < cur) this.prepared.delete(k);
  }

  // For the screen: "drums + chords 2 bars ahead · bass 1.5 · melody 1".
  horizonText() {
    const by = new Map();
    for (const r of this.roles) by.set(this.composeAhead[r], [...(by.get(this.composeAhead[r]) || []), r]);
    return [...by].sort((a, b) => b[0] - a[0]).map(([bars, roles]) => `${roles.join(' + ')} ${bars}`).join(' · ') + ' bars ahead';
  }

  position() {
    if (this.startMs == null) return null;
    return position(this.now(), this.startMs, this.structure.bpm);
  }
}

// How many peers' parts in a context are for the phrase being decided (not last phrase's).
const freshPeers = (ctx) => Object.values(ctx?.peers || {}).filter((p) => p && p.phrase === ctx.phrase).length;

export { STEPS_PER_PHRASE };
