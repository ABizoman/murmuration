// Canon in D — Johann Pachelbel, c. 1680–1706. Public domain.
// Eight chords over a repeating ground bass; every part that joins adds a layer, as in a canon.
export default {
  id: 'canon-in-d',
  title: 'Canon in D',
  composer: 'Johann Pachelbel, c. 1700',
  licence: 'public domain',
  key: 'D',
  mode: 'major',
  bpm: 120,
  progression: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'],
  build: ['bass', 'chords', 'melody', 'drums'],
  voices: {
    bass: ['bass-upright', 'bass-fretless'],
    chords: ['strings', 'keys-piano', 'organ'],
    melody: ['strings', 'voice-oohs', 'horn-french', 'guitar-clean'],
    drums: ['kit-acoustic', 'kit-cr78'],
  },
  parts: {
    bass: {
      sparse: `D3:16 | A2:16 | B2:16 | F#2:16 | G2:16 | D2:16 | G2:16 | A2:16`,
      medium: `D3:8 D3:8 | A2:8 A2:8 | B2:8 B2:8 | F#2:8 F#2:8 | G2:8 G2:8 | D2:8 D2:8 | G2:8 G2:8 | A2:8 A2:8`,
      busy: `D2:4 A2:4 D3:4 A2:4 | A1:4 E2:4 A2:4 E2:4 | B1:4 F#2:4 B2:4 F#2:4 | F#1:4 C#2:4 F#2:4 C#2:4 |
             G1:4 D2:4 G2:4 D2:4 | D2:4 A2:4 D3:4 A2:4 | G1:4 D2:4 G2:4 D2:4 | A1:4 E2:4 A2:4 E2:4`,
    },
    chords: {
      sparse: `x:16`,
      medium: `x:8 x:8`,
      busy: `x:4 x:4 x:4 x:4`,
    },
    melody: {
      sparse: `F#5:16 | E5:16 | D5:16 | C#5:16 | B4:16 | A4:16 | B4:16 | C#5:16`,
      medium: `F#5:8 D5:8 | E5:8 C#5:8 | D5:8 B4:8 | C#5:8 A4:8 | B4:8 G4:8 | A4:8 F#4:8 | B4:8 G4:8 | C#5:8 E5:8`,
      busy: `F#5:2 D5:2 A4:2 D5:2 F#5:2 D5:2 A4:2 D5:2 | E5:2 C#5:2 A4:2 C#5:2 E5:2 C#5:2 A4:2 C#5:2 |
             D5:2 B4:2 F#4:2 B4:2 D5:2 B4:2 F#4:2 B4:2 | C#5:2 A4:2 F#4:2 A4:2 C#5:2 A4:2 F#4:2 A4:2 |
             B4:2 G4:2 D4:2 G4:2 B4:2 G4:2 D4:2 G4:2 | A4:2 F#4:2 D4:2 F#4:2 A4:2 F#4:2 D4:2 F#4:2 |
             B4:2 G4:2 D4:2 G4:2 B4:2 G4:2 D4:2 G4:2 | C#5:2 A4:2 E4:2 A4:2 C#5:2 A4:2 E4:2 A4:2`,
    },
    drums: {
      sparse: { kick: 'x.......x.......' },
      medium: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      busy: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
    },
  },
};
