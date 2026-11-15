// Clock and grid. Position is a pure function of (now, startMs, bpm), so any device that agrees on
// startMs and bpm (and has a synced clock) is at the same phrase/bar/step.

export const STEPS_PER_BAR = 16;
export const BARS_PER_PHRASE = 4;
export const STEPS_PER_PHRASE = STEPS_PER_BAR * BARS_PER_PHRASE;

// Local clock in epoch milliseconds. Phase 2 adds a per-device offset here.
export const localNow = () => performance.timeOrigin + performance.now();

export const stepMs = (bpm) => 60000 / bpm / 4;
// Swing is part of the grid: how far behind the odd 16ths sit, as a fraction of a 16th.
// Shared through the structure (see seed.js) and applied at playback (see feel.js).
export const MAX_SWING = 0.3;

export function position(nowMs, startMs, bpm) {
  const s = (nowMs - startMs) / stepMs(bpm);
  const abs = Math.floor(s);
  return {
    stepFloat: s,
    phrase: Math.floor(abs / STEPS_PER_PHRASE),
    bar: Math.floor(abs / STEPS_PER_BAR) % BARS_PER_PHRASE,
    step: ((abs % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR,
  };
}

export const phraseStartMs = (phrase, startMs, bpm) => startMs + phrase * STEPS_PER_PHRASE * stepMs(bpm);
