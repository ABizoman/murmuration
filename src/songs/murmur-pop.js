// "Murmur" — an original upbeat pop song written for Murmuration (DurHack 2026). Ours to use.
// FIRST DRAFT: the melody, chords and arrangement are a starting point for the team to approve or
// replace before the demo (see docs/ADDING_SONGS.md, "Songs with sections").
//
// A major, 116 bpm, about 2:27 with the final chord. The arrangement is the demo story: the drums
// start alone, then the bass comes in, then the chords (verse), then the melody (pre-chorus).
//
//   intro 1 · intro2 1 · verse 2 · pre 1 · chorus 2 · verse2 2 · pre 1 · chorus 2 · bridge 2 ·
//   finalChorus 2 · outro 1, then one last chord
//
// Chorus hook: a 2-bar figure (C#-C#-C#-B-C#-E, then down to B) answered in bars 3-4 by the same
// rhythm reaching up to F#. Verse: the same rhythm lower and calmer, so the chorus feels like where
// the verse was going. Bass: roots and fifths in the verse, eighth-note pulse with the kick in the
// chorus. Drums: half-time in the verse, four on the floor with snare on 2 and 4 and 16th hats in
// the chorus.

const CHORUS_MELODY = `C#5:2 C#5:2 C#5:2 B4:2 C#5:4 E5:4 | B4:4 G#4:2 E4:2 B4:6 .:2 |
                       C#5:2 C#5:2 C#5:2 B4:2 C#5:4 F#5:4 | E5:4 D5:2 C#5:2 A4:6 .:2`;
const CHORUS_BASS = `A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 E2:2 | E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B1:2 |
                     F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 C#2:2 | D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 E2:2 E2:2`;
const CHORUS_DRUMS = { kick: 'x...x...x...x...', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx' };
const VERSE_BASS = `F#2:6 F#2:2 C#3:4 F#2:4 | D2:6 D2:2 A2:4 D2:4 | A2:6 A2:2 E2:4 A2:4 | E2:6 E2:2 B2:4 E2:4`;
const VERSE_CHORDS = `x:4 .:2 x:4 .:2 x:4`;
const VERSE_DRUMS = { kick: 'x.....x...x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' }; // half-time

export default {
  id: 'murmur-pop',
  title: 'Murmur',
  composer: 'the Murmuration team, 2026 (first draft)',
  licence: 'original, ours',
  key: 'A',
  mode: 'major',
  bpm: 116,
  swing: 0.02,
  build: ['drums', 'bass', 'chords', 'melody'],
  voices: {
    drums: ['kit-breakbeat', 'kit-acoustic', 'kit-linn'],
    bass: ['bass-electric', 'synth-bass'],
    chords: ['keys-piano', 'keys-epiano', 'synth-keys', 'synth-pad'],
    melody: ['synth-pluck', 'synth-lead', 'guitar-clean'],
  },
  sections: {
    intro: {
      progression: ['I', 'V', 'vi', 'IV'],
      parts: {
        drums: { kick: 'x.......x.......', hat: '..x...x...x...x.' },
      },
    },
    intro2: {
      progression: ['I', 'V', 'vi', 'IV'],
      parts: {
        bass: `A2:8 A2:6 E2:2 | E2:8 E2:6 B1:2 | F#2:8 F#2:6 C#2:2 | D2:8 D2:6 E2:2`,
        drums: { kick: 'x.......x.......', hat: 'x.x.x.x.x.x.x.x.' },
      },
    },
    verse: {
      progression: ['vi', 'IV', 'I', 'V'],
      parts: {
        bass: VERSE_BASS,
        chords: VERSE_CHORDS,
        drums: VERSE_DRUMS,
      },
    },
    verse2: {
      progression: ['vi', 'IV', 'I', 'V'],
      parts: {
        melody: `.:2 A4:2 A4:2 B4:2 C#5:4 A4:4 | .:2 F#4:2 F#4:2 A4:2 B4:4 A4:4 |
                 .:2 A4:2 A4:2 B4:2 C#5:4 E5:4 | D5:4 C#5:2 B4:2 B4:8`,
        bass: VERSE_BASS,
        chords: VERSE_CHORDS,
        drums: VERSE_DRUMS,
      },
    },
    pre: {
      progression: ['IV', 'V', 'vi', 'V'],
      parts: {
        melody: `F#4:4 A4:4 D5:4 C#5:4 | B4:4 G#4:4 B4:4 E5:4 | C#5:4 E5:4 F#5:4 E5:4 | E5:4 D5:4 B4:8`,
        bass: `D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 | E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 |
               F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 | E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 E2:2`,
        chords: `x:4 x:4 x:4 x:4`,
        drums: { kick: 'x...x...x...x...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      },
    },
    chorus: {
      progression: ['I', 'V', 'vi', 'IV'],
      hook: true,
      parts: {
        melody: CHORUS_MELODY,
        bass: CHORUS_BASS,
        chords: `x:6 x:6 .:2 x:2`, // pushed: the last hit lands on the "and" of 4
        drums: CHORUS_DRUMS,
      },
    },
    bridge: {
      progression: ['IV', 'vi', 'IV', 'V'],
      parts: {
        melody: `D5:8 C#5:8 | C#5:8 A4:8 | D5:8 F#5:8 | E5:12 .:4`,
        bass: `D2:16 | F#2:16 | D2:16 | E2:16`,
        chords: `x:16`,
        drums: { kick: 'x...............', hat: '..x...x...x...x.' },
      },
    },
    finalChorus: {
      progression: ['I', 'V', 'vi', 'IV'],
      hook: true,
      parts: {
        melody: CHORUS_MELODY,
        bass: CHORUS_BASS,
        chords: `x:6 x:6 .:2 x:2`,
        drums: { ...CHORUS_DRUMS, ohat: '..x...x...x...x.' },
      },
    },
    outro: {
      progression: ['I', 'V', 'vi', 'IV'],
      parts: {
        bass: `A2:16 | E2:16 | F#2:16 | D2:16`,
        chords: `x:16`,
        drums: { kick: 'x.......x.......', hat: 'x.x.x.x.x.x.x.x.' },
      },
    },
  },
  form: [['intro', 1], ['intro2', 1], ['verse', 2], ['pre', 1], ['chorus', 2], ['verse2', 2], ['pre', 1], ['chorus', 2], ['bridge', 2], ['finalChorus', 2], ['outro', 1]],
  end: true,
};
