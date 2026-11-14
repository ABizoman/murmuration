// Turn a relative loop into real notes for one phrase, given the structure and the agent's register.

import { parseChord, anchorFor, degreeToMidi, voiceChord } from './theory.js';
import { BARS_PER_PHRASE } from './clock.js';

export function chordAt(structure, phrase, barInPhrase) {
  const p = structure.progression;
  const numeral = p[(phrase * BARS_PER_PHRASE + barInPhrase) % p.length];
  return parseChord(numeral, structure.key, structure.mode);
}

// Returns { notes: [{ step, dur, vel, midi? | midis? | drum? }], voicing } where step is 0..63 in the phrase.
export function renderPhrase(loop, { structure, phrase, register = 0, prevVoicing = null }) {
  const notes = [];
  let voicing = prevVoicing;
  for (let bar = 0; bar < BARS_PER_PHRASE; bar++) {
    const lb = bar % loop.bars;
    const chord = chordAt(structure, phrase, bar);
    const events = loop.events.filter((e) => e.bar === lb);
    if (loop.role === 'chords' && events.length) voicing = voiceChord(chord, loop.voicing || 3, voicing, register);
    const anchor = loop.role === 'bass' || loop.role === 'melody' ? anchorFor(loop.role, chord, register) : null;

    for (const e of events) {
      const base = { step: bar * 16 + e.step, dur: e.dur, vel: e.vel };
      if (loop.role === 'drums') notes.push({ ...base, drum: e.drum });
      else if (loop.role === 'chords') notes.push({ ...base, midis: voicing });
      else notes.push({ ...base, midi: degreeToMidi(e.deg, e.oct, chord, anchor) });
    }
  }
  notes.sort((a, b) => a.step - b.step);
  return { notes, voicing };
}
