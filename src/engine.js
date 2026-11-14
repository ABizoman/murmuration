// The engine: composes the next phrase ahead of the playhead and sends notes to the audio layer
// shortly before they are due. Time comes from a clock function (shared swarm time in Phase 2),
// not from Tone.Transport, so every device that agrees on startMs is on the same step.
//
// Two horizons:
//   compose ahead: the next phrase is composed `composeAheadBars` before it starts
//   audio ahead:   notes are handed to Web Audio ~150 ms before they sound
//
// Every local agent composes every phrase (so it is ready to take a part over at any moment),
// but only the roles in `myRoles` make sound here. For other roles, the display shows the part
// announced by the device that plays it (setRemotePart).

import { stepMs, phraseStartMs, position, STEPS_PER_PHRASE } from './clock.js';

export class Engine {
  constructor({ agents, audio, now, onEvent, composeAheadBars = 1, audioAheadMs = 150 }) {
    this.agents = agents;
    this.audio = audio; // { play(role, note, whenMs, durMs) }  whenMs in the same clock as now()
    this.now = now;
    this.onEvent = onEvent || (() => {});
    this.composeAheadBars = composeAheadBars;
    this.audioAheadMs = audioAheadMs;
    this.myRoles = new Set(agents.map((a) => a.role));
    this.phrases = new Map(); // phrase -> { local: {role: part}, composedAtMs, sent: Set }
    this.remote = new Map(); // phrase -> { role: part }
    this.structure = null;
    this.startMs = null;
  }

  start(structure, startMs) {
    this.structure = structure;
    this.startMs = startMs;
    this.phrases.clear();
    this.remote.clear();
    for (const a of this.agents) {
      a.style = null;
      a.prevVoicing = null;
    }
  }

  stop() {
    this.startMs = null;
  }

  setRemotePart(phrase, role, part) {
    if (!this.remote.has(phrase)) this.remote.set(phrase, {});
    this.remote.get(phrase)[role] = part;
  }

  // What to show for each role in a phrase.
  partsFor(phrase) {
    const entry = this.phrases.get(phrase);
    if (!entry) return null;
    const remote = this.remote.get(phrase) || {};
    const out = {};
    for (const role of Object.keys(entry.local)) {
      out[role] = this.myRoles.has(role)
        ? entry.local[role]
        : remote[role] || { notes: [], why: 'waiting for the device playing it', pending: true };
    }
    return out;
  }

  compose(phrase) {
    const local = {};
    for (const a of this.agents) local[a.role] = a.compose(phrase, this.structure);
    const entry = { phrase, local, composedAtMs: this.now(), sent: new Set() };
    this.phrases.set(phrase, entry);
    const startsIn = phraseStartMs(phrase, this.startMs, this.structure.bpm) - entry.composedAtMs;
    this.onEvent({ type: 'composed', phrase, parts: local, mine: new Set(this.myRoles), startsInMs: startsIn });
    return entry;
  }

  // Call often (every ~25 ms).
  tick() {
    if (this.startMs == null) return;
    const now = this.now();
    const { bpm } = this.structure;
    const sMs = stepMs(bpm);
    const cur = Math.max(0, position(now, this.startMs, bpm).phrase);

    if (!this.phrases.has(cur)) this.compose(cur); // at the start, or when joining mid-song
    const next = cur + 1;
    const aheadMs = this.composeAheadBars * 16 * sMs;
    if (!this.phrases.has(next) && phraseStartMs(next, this.startMs, bpm) - now <= aheadMs) this.compose(next);

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

    for (const p of this.phrases.keys()) if (p < cur - 1) this.phrases.delete(p);
    for (const p of this.remote.keys()) if (p < cur - 1) this.remote.delete(p);
  }

  position() {
    if (this.startMs == null) return null;
    return position(this.now(), this.startMs, this.structure.bpm);
  }
}

export { STEPS_PER_PHRASE };
