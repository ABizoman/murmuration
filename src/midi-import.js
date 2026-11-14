// MIDI pack loop -> relative loop (scale degrees against the chord), so pack loops fit any key and chord.
//
// You tell it what the pack file is: role, style, density, and the key/mode and chords (one per bar)
// it was written over. Packs rarely store that reliably, so it comes from the folder/file name or you.

import { parseChord, degreeInterval, anchorFor } from './theory.js';

const GM_DRUMS = { 35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare', 42: 'hat', 44: 'hat', 46: 'ohat' };

// rawNotes: [{ midi, ticks, durationTicks, velocity }] (what @tonejs/midi gives you)
// meta: { id, role, style, density, key, mode, progression: ['i','VI','III','VII'] }
export function toRelativeLoop(rawNotes, ppq, meta) {
  const tps = ppq / 4; // ticks per 16th
  const q = rawNotes.map((n) => ({
    abs: Math.round(n.ticks / tps),
    dur: Math.max(1, Math.round(n.durationTicks / tps)),
    midi: n.midi,
    vel: Math.round(n.velocity * 100) / 100,
  }));
  if (!q.length) throw new Error('no notes');
  const lastStep = Math.max(...q.map((n) => n.abs + 1));
  const bars = [1, 2, 4].find((b) => b * 16 >= lastStep) ?? 4;
  const inLoop = q.filter((n) => n.abs < bars * 16);
  const chordFor = (bar) => parseChord(meta.progression[bar % meta.progression.length], meta.key, meta.mode);
  const base = { id: meta.id, role: meta.role, style: meta.style, density: meta.density, bars };

  if (meta.role === 'drums') {
    const events = inLoop
      .filter((n) => GM_DRUMS[n.midi])
      .map((n) => ({ bar: Math.floor(n.abs / 16), step: n.abs % 16, dur: 1, drum: GM_DRUMS[n.midi], vel: n.vel }));
    return { ...base, events };
  }

  if (meta.role === 'chords') {
    // Keep the rhythm only; the voicing is rebuilt from the current chord.
    const byStep = new Map();
    for (const n of inLoop) {
      const e = byStep.get(n.abs) || { abs: n.abs, dur: 0, vel: 0, size: 0 };
      e.dur = Math.max(e.dur, n.dur);
      e.vel = Math.max(e.vel, n.vel);
      e.size++;
      byStep.set(n.abs, e);
    }
    const hits = [...byStep.values()].sort((a, b) => a.abs - b.abs);
    const sizes = hits.map((h) => h.size).sort((a, b) => a - b);
    const voicing = sizes[Math.floor(sizes.length / 2)] >= 4 ? 4 : 3;
    return {
      ...base,
      voicing,
      events: hits.map((h) => ({ bar: Math.floor(h.abs / 16), step: h.abs % 16, dur: Math.min(h.dur, 16), vel: h.vel })),
    };
  }

  // bass / melody: pitch -> degree + octave relative to the chord root
  let events = inLoop.map((n) => {
    const bar = Math.floor(n.abs / 16);
    const chord = chordFor(bar);
    const semis = (n.midi - chord.rootPc + 120) % 12;
    // exact degree if the note is in the chord/scale, otherwise snap to the nearest one
    let best = 0, bestDist = 99;
    for (let d = 0; d < 7; d++) {
      const iv = degreeInterval(d, chord);
      const dist = Math.min(Math.abs(iv - semis), 12 - Math.abs(iv - semis)) + (d % 2 ? 0.1 : 0); // prefer chord tones on ties
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    const anchor = anchorFor(meta.role, chord, 0);
    const oct = Math.round((n.midi - anchor - degreeInterval(best, chord)) / 12);
    return { bar, step: n.abs % 16, dur: n.dur, deg: best, oct, vel: n.vel };
  });
  // Re-centre so the loop sits in our register for this role, keeping its contour.
  const octs = events.map((e) => e.oct).sort((a, b) => a - b);
  const median = octs[Math.floor(octs.length / 2)];
  events = events.map((e) => ({ ...e, oct: e.oct - median }));
  return { ...base, events };
}

export async function importMidiFile(arrayBuffer, meta) {
  const { Midi } = await import('https://esm.sh/@tonejs/midi@2.0.28');
  const midi = new Midi(arrayBuffer);
  const raw = midi.tracks.flatMap((t) => t.notes);
  return toRelativeLoop(raw, midi.header.ppq, meta);
}
