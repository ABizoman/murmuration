// The engine keeps the shared score for the last few phrases, has the local agents compose their
// parts ahead of the playhead, and sends notes to the audio layer shortly before they are due.
//
// Three horizons before a phrase starts:
//   plan ahead    (2 bars): the context is built and sent to Jev (onPlan)
//   compose ahead (1 bar):  the agents decide, using Jev's answer if it has arrived
//   audio ahead   (150 ms): notes are handed to Web Audio
//
// Only roles in `myRoles` are composed here. Other roles come from the devices that play them
// (setRemotePart). A role in `doubling` is not composed: this device plays the owner's notes.

import { stepMs, phraseStartMs, position, STEPS_PER_PHRASE } from './clock.js';
import { buildContext } from './decide/context.js';
import { DEFAULT_DIRECTIVE } from './decide/directive.js';

const ORDER = ['drums', 'bass', 'chords', 'melody']; // later agents see what earlier ones just decided
const KEEP_PHRASES = 5;

export class Engine {
  constructor({ agents, audio, now, onEvent, onPlan, getAdvice, getDirective, composeAheadBars = 1, planAheadBars = 2, audioAheadMs = 150 }) {
    this.agents = Object.fromEntries(agents.map((a) => [a.role, a]));
    this.roles = ORDER.filter((r) => this.agents[r]);
    this.audio = audio; // { play(role, note, whenMs, durMs) }  whenMs on the same clock as now()
    this.now = now;
    this.onEvent = onEvent || (() => {});
    this.onPlan = onPlan || (() => {});
    this.getAdvice = getAdvice || (() => null);
    this.getDirective = getDirective || (() => DEFAULT_DIRECTIVE);
    this.composeAheadBars = composeAheadBars;
    this.planAheadBars = planAheadBars;
    this.audioAheadMs = audioAheadMs;
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
      directive: this.getDirective(phrase),
    });
  }

  // Make sure every role this device sounds has a part for the phrase.
  ensureParts(phrase) {
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
    for (const role of this.roles) {
      if (!this.myRoles.has(role) || entry.local[role]) continue;
      if (this.doubling.has(role)) {
        const theirs = this.remote.get(phrase)?.[role];
        if (theirs) entry.local[role] = { ...theirs, doubled: true, why: `doubling ${theirs.by ?? 'the owner'}: ${theirs.why}` };
        continue;
      }
      const announced = this.remote.get(phrase)?.[role];
      if (announced && announced.by) {
        // Taking a part over: play what the previous player already announced for this phrase.
        entry.local[role] = { ...announced, why: `${announced.why} (taken over from ${announced.by})` };
        continue;
      }
      const part = this.agents[role].compose(this.context(phrase, role), this.getAdvice(phrase, role));
      entry.local[role] = part;
      const startsInMs = phraseStartMs(phrase, this.startMs, this.structure.bpm) - this.now();
      this.onEvent({ type: 'part', phrase, role, part, startsInMs });
    }
    return entry;
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

    this.ensureParts(cur); // at the start, when joining mid-song, or when a role was just taken over
    if (!this.planned.has(next) && untilNext <= this.planAheadBars * 16 * sMs) {
      this.planned.add(next);
      const roles = this.roles.filter((r) => this.myRoles.has(r) && !this.doubling.has(r));
      if (roles.length) this.onPlan(next, Object.fromEntries(roles.map((r) => [r, this.context(next, r)])), untilNext - this.composeAheadBars * 16 * sMs);
    }
    if (untilNext <= this.composeAheadBars * 16 * sMs) this.ensureParts(next);

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
          const when = t0 + n.step * sMs;
          if (when > now + this.audioAheadMs) return;
          entry.sent.add(key);
          if (when < now - 20) return; // too late (joined mid-phrase, or tab throttled): skip
          this.audio.play(role, n, when, n.dur * sMs);
        });
      }
    }

    for (const p of this.phrases.keys()) if (p < cur - KEEP_PHRASES) this.phrases.delete(p);
    for (const p of this.remote.keys()) if (p < cur - KEEP_PHRASES) this.remote.delete(p);
    for (const p of this.planned) if (p < cur) this.planned.delete(p);
  }

  position() {
    if (this.startMs == null) return null;
    return position(this.now(), this.startMs, this.structure.bpm);
  }
}

export { STEPS_PER_PHRASE };
