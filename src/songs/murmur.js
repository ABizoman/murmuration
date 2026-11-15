// "Murmur" — an original dance-pop song written for Murmuration (DurHack 2026). Ours to use.
// FIRST DRAFT for the team to approve or change. Moody, smooth and repetitive: a minor key, a
// four-on-the-floor kick, the bass bouncing on the off-beats, soft synths, and a hook of a few
// chord notes that keeps coming back. (The earlier, brighter pop draft is still there as murmur-pop.)
//
// A minor, 120 bpm, about 2:22 with the final chord. Chords i - VI - III - VII (Am F C G) all the
// way through, except the breakdown. The arrangement is the demo story: drums alone, then the bass,
// then the chords, then the melody.
//
//   intro 1 · intro2 1 · verse 2 · pre 1 · chorus 2 · verse2 2 · pre 1 · chorus 2 · breakdown 2 ·
//   finalChorus 2 · outro 1, then one last chord
//
// Hook (chorus): the same one-bar rhythm on every chord — two quick notes, a gap, a note, a gap, two
// more — climbing A-C-E over Am, A-C-F over F, G-C-E over C, G-B-D over G. Only notes of the chord
// underneath, so nothing rubs. Verse: the same idea with fewer notes, lower.

const PROG = ['i', 'VI', 'III', 'VII'];
const HOOK = `A4:2 C5:2 .:2 E5:2 .:4 D5:2 C5:2 | A4:2 C5:2 .:2 F5:2 .:4 C5:4 |
              G4:2 C5:2 .:2 E5:2 .:4 D5:2 C5:2 | G4:2 B4:2 .:2 D5:2 .:4 B4:4`;
const OFFBEAT_BASS = `.:2 A2:2 .:2 A2:2 .:2 A2:2 .:2 A2:2 | .:2 F2:2 .:2 F2:2 .:2 F2:2 .:2 F2:2 |
                      .:2 C3:2 .:2 C3:2 .:2 C3:2 .:2 C3:2 | .:2 G2:2 .:2 G2:2 .:2 G2:2 .:2 G2:2`;
const BOUNCE_BASS = `.:2 A2:2 .:2 A3:2 .:2 A2:2 .:2 A3:2 | .:2 F2:2 .:2 F3:2 .:2 F2:2 .:2 F3:2 |
                     .:2 C3:2 .:2 C4:2 .:2 C3:2 .:2 C4:2 | .:2 G2:2 .:2 G3:2 .:2 G2:2 .:2 G3:2`;
const FOUR = { kick: 'x...x...x...x...', ohat: '..x...x...x...x.' };
const CHORUS_DRUMS = { kick: 'x...x...x...x...', snare: '....X.......X...', ohat: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' };
const CHORUS_CHORDS = `x:3 x:3 x:2 .:2 x:3 x:3`; // short, syncopated stabs

export default {
  id: 'murmur',
  title: 'Murmur',
  composer: 'the Murmuration team, 2026 (first draft)',
  licence: 'original, ours',
  key: 'A',
  mode: 'minor',
  bpm: 120,
  build: ['drums', 'bass', 'chords', 'melody'],
  voices: {
    drums: ['kit-linn', 'kit-8'],
    bass: ['synth-bass', 'bass-electric'],
    chords: ['synth-pad', 'keys-epiano'],
    melody: ['synth-pluck', 'synth-lead'],
  },
  sections: {
    intro: { progression: PROG, parts: { drums: { kick: 'x...x...x...x...' } } },
    intro2: { progression: PROG, parts: { bass: OFFBEAT_BASS, drums: FOUR } },
    verse: { progression: PROG, parts: { bass: OFFBEAT_BASS, chords: `x:16`, drums: FOUR } },
    pre: {
      progression: PROG,
      parts: {
        melody: `.:4 E4:2 .:2 A4:4 .:4 | .:4 F4:2 .:2 A4:4 .:4 | .:4 E4:2 .:2 G4:4 .:4 | .:4 D4:2 .:2 G4:2 B4:2 .:4`,
        bass: OFFBEAT_BASS,
        chords: `x:8 x:8`,
        drums: { ...FOUR, snare: '........X.......' },
      },
    },
    chorus: { progression: PROG, hook: true, parts: { melody: HOOK, bass: BOUNCE_BASS, chords: CHORUS_CHORDS, drums: CHORUS_DRUMS } },
    verse2: {
      progression: PROG,
      parts: {
        melody: `.:4 E4:2 .:2 A4:4 .:4 | .:4 F4:2 .:2 A4:4 .:4 | .:4 E4:2 .:2 G4:4 .:4 | .:4 D4:2 .:2 G4:4 .:4`,
        bass: OFFBEAT_BASS,
        chords: `x:16`,
        drums: FOUR,
      },
    },
    breakdown: {
      progression: ['VI', 'VII', 'i', 'i'],
      parts: {
        melody: `A4:8 C5:8 | B4:8 D5:8 | C5:8 E5:8 | E5:12 .:4`,
        chords: `x:16`,
      },
    },
    finalChorus: { progression: PROG, hook: true, parts: { melody: HOOK, bass: BOUNCE_BASS, chords: CHORUS_CHORDS, drums: { ...CHORUS_DRUMS, hat: 'xxxxxxxxxxxxxxxx' } } },
    outro: { progression: PROG, parts: { bass: OFFBEAT_BASS, chords: `x:16`, drums: FOUR } },
  },
  form: [['intro', 1], ['intro2', 1], ['verse', 2], ['pre', 1], ['chorus', 2], ['verse2', 2], ['pre', 1], ['chorus', 2], ['breakdown', 2], ['finalChorus', 2], ['outro', 1]],
  end: true,
};
