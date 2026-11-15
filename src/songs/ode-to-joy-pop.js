// "Ode to Joy" (pop) — Beethoven's public-domain theme from Symphony No. 9 (1824) in a modern
// arrangement for the demo: synth bass, synth pluck melody, piano chords, pop drums with the snare
// on 2 and 4. The classic arrangement is still there as "ode-to-joy".
//
// D major, 120 bpm, about 1:55 with the final chord.
//   intro 1 · verse 2 · chorus 2 · verse2 2 · chorus 2 · breakdown 1 · finalChorus 2 · outro 1
// The theme plays an octave above the classic version (register: melody +1), clear of the piano.
// Verse: the first 8 bars of the theme over a sparse band. Chorus: the same theme with everyone.
// Breakdown: chords only.

const THEME = `F#4:4 F#4:4 G4:4 A4:4 | A4:4 G4:4 F#4:4 E4:4 | D4:4 D4:4 E4:4 F#4:4 | F#4:6 E4:2 E4:8 |
               F#4:4 F#4:4 G4:4 A4:4 | A4:4 G4:4 F#4:4 E4:4 | D4:4 D4:4 E4:4 F#4:4 | E4:6 D4:2 D4:8`;
const THEME_CHORDS = ['I', 'V', 'I', 'V', 'I', 'V', 'I', 'I'];
const PULSE_BASS = `D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 | A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 |
                    D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 | A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 |
                    D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 | A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 |
                    D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 | D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2`;
const POP_DRUMS = { kick: 'x...x...x...x...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..............x.' };
const VERSE = {
  progression: THEME_CHORDS,
  parts: {
    melody: THEME,
    bass: `D2:8 A1:8 | A1:8 E2:8 | D2:8 A1:8 | A1:8 E2:8 | D2:8 A1:8 | A1:8 E2:8 | D2:8 A1:8 | D2:16`,
    chords: `x:8 x:8`,
    drums: { kick: 'x.......x.......', hat: 'x.x.x.x.x.x.x.x.' },
  },
};
const CHORUS = {
  progression: THEME_CHORDS,
  hook: true,
  parts: { melody: THEME, bass: PULSE_BASS, chords: `x:4 x:4 x:4 x:4`, drums: POP_DRUMS },
};

export default {
  id: 'ode-to-joy-pop',
  title: 'Ode to Joy (pop)',
  composer: 'Ludwig van Beethoven, 1824 (arranged for Murmuration)',
  licence: 'public domain (the arrangement is ours)',
  key: 'D',
  mode: 'major',
  bpm: 120,
  build: ['drums', 'bass', 'chords', 'melody'],
  register: { melody: 1 },
  voices: {
    drums: ['kit-breakbeat', 'kit-acoustic'],
    bass: ['synth-bass', 'bass-electric'],
    chords: ['keys-piano', 'keys-epiano'],
    melody: ['synth-pluck', 'synth-lead'],
  },
  sections: {
    intro: {
      progression: ['I', 'V', 'I', 'V'],
      parts: { chords: `x:8 x:8`, drums: { kick: 'x.......x.......', hat: '..x...x...x...x.' } },
    },
    verse: VERSE,
    verse2: VERSE,
    chorus: CHORUS,
    breakdown: { progression: ['IV', 'I', 'V', 'V'], parts: { chords: `x:16` } },
    finalChorus: { ...CHORUS, parts: { ...CHORUS.parts, drums: { ...POP_DRUMS, hat: 'xxxxxxxxxxxxxxxx' } } },
    outro: { progression: ['I', 'V', 'I', 'I'], parts: { chords: `x:16`, bass: `D2:16 | A1:16 | D2:16 | D2:16`, drums: { kick: 'x.......x.......' } } },
  },
  form: [['intro', 1], ['verse', 2], ['chorus', 2], ['verse2', 2], ['chorus', 2], ['breakdown', 1], ['finalChorus', 2], ['outro', 1]],
  end: true,
};
