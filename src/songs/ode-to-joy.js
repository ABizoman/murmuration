// "Ode to Joy" from Symphony No. 9 — Ludwig van Beethoven, 1824. Public domain.
// The tune comes in first, alone, and the band gathers round it.
export default {
  id: 'ode-to-joy',
  title: 'Ode to Joy',
  composer: 'Ludwig van Beethoven, 1824',
  licence: 'public domain',
  key: 'D',
  mode: 'major',
  bpm: 108,
  progression: ['I', 'V', 'I', 'V', 'I', 'V', 'I', 'I'],
  build: ['melody', 'chords', 'bass', 'drums'],
  voices: {
    melody: ['trumpet', 'horn-french', 'voice-oohs', 'sax-alto'],
    chords: ['keys-piano', 'strings', 'organ', 'choir'],
    bass: ['bass-upright', 'bass-electric'],
    drums: ['kit-acoustic', 'kit-linn'],
  },
  parts: {
    melody: {
      medium: `F#4:4 F#4:4 G4:4 A4:4 | A4:4 G4:4 F#4:4 E4:4 | D4:4 D4:4 E4:4 F#4:4 | F#4:6 E4:2 E4:8 |
               F#4:4 F#4:4 G4:4 A4:4 | A4:4 G4:4 F#4:4 E4:4 | D4:4 D4:4 E4:4 F#4:4 | E4:6 D4:2 D4:8`,
    },
    bass: {
      sparse: `D2:16 | A1:16 | D2:16 | A1:16 | D2:16 | A1:16 | D2:16 | D2:16`,
      medium: `D2:8 A2:8 | A1:8 E2:8 | D2:8 A2:8 | A1:8 E2:8 | D2:8 A2:8 | A1:8 E2:8 | D2:8 A2:8 | D2:8 D2:8`,
      busy: `D2:4 F#2:4 A2:4 F#2:4 | A1:4 C#2:4 E2:4 C#2:4 | D2:4 F#2:4 A2:4 F#2:4 | A1:4 C#2:4 E2:4 C#2:4 |
             D2:4 F#2:4 A2:4 F#2:4 | A1:4 C#2:4 E2:4 C#2:4 | D2:4 F#2:4 A2:4 F#2:4 | D2:4 A1:4 D2:8`,
    },
    chords: {
      sparse: `x:16`,
      medium: `x:8 x:8`,
      busy: `x:4 x:4 x:4 x:4`,
    },
    drums: {
      sparse: { kick: 'x.......x.......' },
      medium: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      busy: { kick: 'x.....x.x.......', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx' },
    },
  },
};
