// The engine: composes the next phrase ahead of the playhead and sends notes to the audio layer
// shortly before they are due. Time comes from clock.js, not from Tone.Transport, so later every
// device can share one start time.
//
// Two horizons:
//   compose ahead: the next phrase is composed `composeAheadBars` before it starts
//   audio ahead:   notes are handed to Web Audio ~150 ms before they sound

import { stepMs, phraseStartMs, position, STEPS_PER_PHRASE } from './clock.js';

export class Engine {
  constructor({ agents, audio, now, onEvent, composeAheadBars = 1, audioAheadMs = 150 }) {
    this.agents = agents;
    this.audio = audio; // { play(role, note, whenMs, durMs) }
    this.now = now;
    this.onEvent = onEvent || (() => {});
    this.composeAheadBars = composeAheadBars;
    this.audioAheadMs = audioAheadMs;
    this.myRoles = new Set(agents.map((a) => a.role));
    this.phrases = new Map(); // phrase -> { parts: {role: {notes, why}}, composedAtMs, sent:Set }
    this.structure = null;
    this.startMs = null;
  }

  start(structure, startMs) {
    this.structure = structure;
    this.startMs = startMs;
    this.phrases.clear();
    for (const a of this.agents) {
      a.style = null;
      a.prevVoicing = null;
    }
  }

  stop() {
    this.startMs = null;
  }

  compose(phrase) {
    const parts = {};
    for (const a of this.agents) parts[a.role] = a.compose(phrase, this.structure);
    const entry = { phrase, parts, composedAtMs: this.now(), sent: new Set() };
    this.phrases.set(phrase, entry);
    const startsIn = phraseStartMs(phrase, this.startMs, this.structure.bpm) - entry.composedAtMs;
    this.onEvent({ type: 'composed', phrase, parts, startsInMs: startsIn });
    return entry;
  }

  // Call often (every ~25 ms).
  tick() {
    if (this.startMs == null) return;
    const now = this.now();
    const { bpm } = this.structure;
    const sMs = stepMs(bpm);
    const cur = Math.max(0, position(now, this.startMs, bpm).phrase);

    if (!this.phrases.has(cur)) this.compose(cur); // only happens at the very start
    const next = cur + 1;
    const aheadMs = this.composeAheadBars * 16 * sMs;
    if (!this.phrases.has(next) && phraseStartMs(next, this.startMs, bpm) - now <= aheadMs) this.compose(next);

    for (const p of [cur, next]) {
      const entry = this.phrases.get(p);
      if (!entry) continue;
      const t0 = phraseStartMs(p, this.startMs, bpm);
      for (const [role, part] of Object.entries(entry.parts)) {
        part.notes.forEach((n, i) => {
          const key = `${role}:${i}`;
          if (entry.sent.has(key)) return;
          const when = t0 + n.step * sMs;
          if (when > now + this.audioAheadMs) return;
          entry.sent.add(key);
          if (when < now - 20) return; // too late (tab was throttled): skip rather than play out of time
          if (this.myRoles.has(role)) this.audio.play(role, n, when, n.dur * sMs);
        });
      }
    }

    for (const p of this.phrases.keys()) if (p < cur - 1) this.phrases.delete(p);
  }

  position() {
    if (this.startMs == null) return null;
    return position(this.now(), this.startMs, this.structure.bpm);
  }
}

export { STEPS_PER_PHRASE };
