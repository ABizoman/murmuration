// Turn a relative loop into real notes for one phrase, given the structure and the agent's register.

import { parseChord, anchorFor, degreeToMidi, voiceChord } from './theory.js';
import { BARS_PER_PHRASE } from './clock.js';
import { sectionAt } from './form.js';

// The chord under a bar. A song with sections (structure.sections, structure.form) uses the current
// section's own progression, counted from the section's start; the coda is the tonic. Pure in
// (structure, phrase, bar): render, fit, transform and both screens call it.
export function chordAt(structure, phrase, barInPhrase) {
  if (structure.sections && structure.form) {
    const at = sectionAt(structure.form, phrase);
    const prog = at && structure.sections[at.section.name]?.progression;
    if (!prog) return parseChord(structure.mode === 'minor' ? 'i' : 'I', structure.key, structure.mode);
    return parseChord(prog[(at.phraseInSection * BARS_PER_PHRASE + barInPhrase) % prog.length], structure.key, structure.mode);
  }
  const p = structure.progression;
  const numeral = p[(phrase * BARS_PER_PHRASE + barInPhrase) % p.length];
  return parseChord(numeral, structure.key, structure.mode);
}

// Which phrase of its loop a phrase is: songs with sections count from the section's start, so an
// 8-bar part starts at its beginning whatever phrase the section starts on.
export function loopPhrase(structure, phrase) {
  if (!structure.form || !structure.sections) return phrase;
  return sectionAt(structure.form, phrase)?.phraseInSection ?? phrase;
}

// Returns { notes: [{ step, dur, vel, midi? | midis? | drum? }], voicing } where step is 0..63 in the phrase.
export function renderPhrase(loop, { structure, phrase, register = 0, prevVoicing = null, fold = true }) {
  const notes = [];
  let voicing = prevVoicing;
  const local = loopPhrase(structure, phrase);
  for (let bar = 0; bar < BARS_PER_PHRASE; bar++) {
    const lb = (local * BARS_PER_PHRASE + bar) % loop.bars; // 8-bar loops span two phrases
    const chord = chordAt(structure, phrase, bar);
    const events = loop.events.filter((e) => e.bar === lb);
    if (loop.role === 'chords' && events.length) voicing = voiceChord(chord, loop.voicing || 3, voicing, register);
    const anchor = loop.role === 'bass' || loop.role === 'melody' ? anchorFor(loop.role, chord, register) : null;

    for (const e of events) {
      const base = { step: bar * 16 + e.step, dur: e.dur, vel: e.vel };
      if (loop.role === 'drums') notes.push({ ...base, drum: e.drum });
      else if (loop.role === 'chords') notes.push({ ...base, midis: voicing });
      else {
        let midi = degreeToMidi(e.deg, e.oct, chord, anchor) + (e.acc || 0);
        // keep pack lines that wander far from the anchor in a playable range
        if (fold && loop.role === 'bass') while (midi < 28) midi += 12;
        if (fold) while (midi > 100) midi -= 12;
        notes.push({ ...base, midi });
      }
    }
  }
  notes.sort((a, b) => a.step - b.step);
  return { notes, voicing };
}
