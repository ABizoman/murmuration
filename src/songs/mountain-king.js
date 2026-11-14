// "In the Hall of the Mountain King" from Peer Gynt — Edvard Grieg, 1875. Public domain.
// The theme starts low and alone, and the band builds around it.
export default {
  id: 'mountain-king',
  title: 'In the Hall of the Mountain King',
  composer: 'Edvard Grieg, 1875',
  licence: 'public domain',
  key: 'B',
  mode: 'minor',
  bpm: 126,
  progression: ['i', 'V', 'i', 'III'],
  build: ['bass', 'drums', 'chords', 'melody'], // who comes in first
  voices: {
    bass: ['bass-upright', 'bass-tuba', 'bass-electric'],
    drums: ['kit-acoustic', 'kit-breakbeat'],
    chords: ['strings', 'brass-section', 'organ'],
    melody: ['horn-french', 'trombone', 'trumpet', 'strings'],
  },
  parts: {
    melody: {
      medium: `B4:2 C#5:2 D5:2 E5:2 F#5:2 D5:2 F#5:4 |
               E#5:2 C#5:2 E#5:4 E5:2 C5:2 E5:4 |
               B4:2 C#5:2 D5:2 E5:2 F#5:2 D5:2 F#5:2 B5:2 |
               A5:2 F#5:2 D5:2 F#5:2 A5:8`,
    },
    bass: {
      sparse: `B1:4 B1:4 B1:4 B1:4 | B1:4 B1:4 B1:4 B1:4 | B1:4 B1:4 B1:4 B1:4 | B1:4 B1:4 B1:4 B1:4`,
      medium: `B1:2 C#2:2 D2:2 E2:2 F#2:2 D2:2 F#2:4 |
               E#2:2 C#2:2 E#2:4 E2:2 C2:2 E2:4 |
               B1:2 C#2:2 D2:2 E2:2 F#2:2 D2:2 F#2:2 B2:2 |
               A2:2 F#2:2 D2:2 F#2:2 A2:8`,
    },
    chords: {
      sparse: `.:4 x:2 .:6 x:2 .:2`,
      medium: `x:2 .:2 x:2 .:2 x:2 .:2 x:2 .:2`,
      busy: `x:1 .:1 x:1 .:1 x:1 .:1 x:1 .:1 x:1 .:1 x:1 .:1 x:1 .:1 x:1 .:1`,
    },
    drums: {
      sparse: { kick: 'x...x...x...x...' },
      medium: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      busy: {
        kick: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x.',
        snare: '....X.......X... | ....X.......X... | ....X.......X... | ....X...x.x.XXXX',
        hat: 'xxxxxxxxxxxxxxxx | xxxxxxxxxxxxxxxx | xxxxxxxxxxxxxxxx | xxxxxxxx........',
      },
    },
  },
};
