// "Murmur" — an original dance-pop song written for Murmuration (DurHack 2026). Ours to use.
// FIRST DRAFT for the team to approve or change (the brighter pop draft is still there as
// murmur-pop).
//
// Moody house: A minor, 120 bpm, about 2:22 with the final chord. Chords Am - Am - Dm - Em (i i iv
// v; the minor v keeps it dark). Built on three things that repeat:
//   the riff    a syncopated "da-da-da . da-da" line (3+3+2 rhythm) on the riff synth, the song's
//               identity; it runs from the pre-chorus to the end
//   the bass    a groove that moves: root, a push, the octave, and a walk up into the next bar
//   the beat    a synthesised house kit: four-on-the-floor kick, handclap on 2 and 4, open hats
//               on the off-beats, and the kick pumping the bass and the chord stabs
// The arrangement is the demo story: drums alone, then the bass, then the chords (with the pad),
// then the riff, the arpeggio and the shaker; everything in the chorus.
//
//   intro 1 · intro2 1 · verse 2 · pre 1 · chorus 2 · verse2 2 · pre 1 · chorus 2 · breakdown 2 ·
//   finalChorus 2 · outro 1, then one last chord

const PROG = ['i', 'i', 'iv', 'v'];
const RIFF = `A4:3 C5:3 E5:2 .:2 C5:3 A4:3 | A4:3 C5:3 E5:2 .:2 D5:3 C5:3 |
              A4:3 D5:3 F5:2 .:2 D5:3 A4:3 | G4:3 B4:3 E5:2 .:2 D5:3 B4:3`;
const RIFF_HALF = `A4:3 C5:3 E5:2 .:8 | A4:3 C5:3 E5:2 .:8 | A4:3 D5:3 F5:2 .:8 | G4:3 B4:3 E5:2 .:8`;
const GROOVE_BASS = `A1:2 .:1 A1:1 .:2 A2:2 .:2 A1:2 C2:2 E2:2 | A1:2 .:1 A1:1 .:2 A2:2 .:2 G1:2 A1:2 C2:2 |
                     D2:2 .:1 D2:1 .:2 D3:2 .:2 D2:2 F2:2 A2:2 | E2:2 .:1 E2:1 .:2 E3:2 .:2 E2:2 D2:2 B1:2`;
const OFFBEAT_BASS = `.:2 A1:2 .:2 A1:2 .:2 A1:2 .:2 A1:2 | .:2 A1:2 .:2 A1:2 .:2 A1:2 .:2 A1:2 |
                      .:2 D2:2 .:2 D2:2 .:2 D2:2 .:2 D2:2 | .:2 E2:2 .:2 E2:2 .:2 E2:2 .:2 E2:2`;
const OFFBEAT_STABS = `.:2 x:2 .:2 x:2 .:2 x:2 .:2 x:2`;
// The extra layers (a device each in a big swarm): a warm pad, an arpeggio, shaker and tambourine.
const PAD = `x:16`;
const ARP8 = `A4:2 C5:2 E5:2 A5:2 E5:2 C5:2 A4:2 C5:2 | A4:2 C5:2 E5:2 A5:2 E5:2 C5:2 A4:2 C5:2 |
              A4:2 D5:2 F5:2 A5:2 F5:2 D5:2 A4:2 D5:2 | G4:2 B4:2 E5:2 G5:2 E5:2 B4:2 G4:2 B4:2`;
const ARP16 = `A4:1 C5:1 E5:1 A5:1 A4:1 C5:1 E5:1 A5:1 A4:1 C5:1 E5:1 A5:1 A4:1 C5:1 E5:1 A5:1 |
               A4:1 C5:1 E5:1 A5:1 A4:1 C5:1 E5:1 A5:1 A4:1 C5:1 E5:1 A5:1 A4:1 C5:1 E5:1 A5:1 |
               A4:1 D5:1 F5:1 A5:1 A4:1 D5:1 F5:1 A5:1 A4:1 D5:1 F5:1 A5:1 A4:1 D5:1 F5:1 A5:1 |
               G4:1 B4:1 E5:1 G5:1 G4:1 B4:1 E5:1 G5:1 G4:1 B4:1 E5:1 G5:1 G4:1 B4:1 E5:1 G5:1`;
const SHAKER8 = { shaker: 'x.x.x.x.x.x.x.x.' };
const SHAKER16 = { shaker: 'xxxxxxxxxxxxxxxx', tamb: '....x.......x...' };
const KICK = 'x...x...x...x...';
const OHAT = '..x...x...x...x.';
const CHORUS_DRUMS = { kick: KICK, snare: '....X.......X...', ohat: OHAT, hat: 'xx.xxx.xxx.xxx.x' };

export default {
  id: 'murmur',
  title: 'Murmur',
  composer: 'the Murmuration team, 2026 (first draft)',
  licence: 'original, ours',
  key: 'A',
  mode: 'minor',
  bpm: 120,
  swing: 0.03, // a light house shuffle
  pump: 'dance', // the kick ducks the bass and the stabs hard (mix.js PUMP)
  voicing: 3,
  build: ['drums', 'bass', 'chords', 'melody'],
  voices: {
    drums: ['kit-house', 'kit-linn'],
    bass: ['synth-bass', 'bass-electric'],
    chords: ['synth-stab', 'synth-pad'],
    melody: ['synth-riff', 'synth-pluck'],
    pad: ['pad-warm'],
    arp: ['arp-pluck'],
    perc: ['perc-shaker'],
  },
  sections: {
    intro: { progression: PROG, parts: { drums: { kick: KICK, hat: OHAT } } },
    intro2: { progression: PROG, parts: { bass: OFFBEAT_BASS, drums: { kick: KICK, ohat: OHAT } } },
    verse: { progression: PROG, parts: { bass: GROOVE_BASS, chords: `.:2 x:2 .:6 x:2 .:4`, pad: PAD, drums: { kick: KICK, ohat: OHAT } } },
    pre: {
      progression: PROG,
      parts: { melody: RIFF_HALF, bass: GROOVE_BASS, chords: OFFBEAT_STABS, pad: PAD, arp: ARP8, perc: SHAKER8, drums: { kick: KICK, snare: '....x.......x...', ohat: OHAT } },
    },
    chorus: { progression: PROG, hook: true, parts: { melody: RIFF, bass: GROOVE_BASS, chords: OFFBEAT_STABS, pad: PAD, arp: ARP8, perc: SHAKER16, drums: CHORUS_DRUMS } },
    verse2: { progression: PROG, parts: { melody: RIFF_HALF, bass: GROOVE_BASS, chords: `.:2 x:2 .:6 x:2 .:4`, pad: PAD, perc: SHAKER8, drums: { kick: KICK, ohat: OHAT } } },
    breakdown: {
      progression: PROG,
      parts: { melody: `E5:8 C5:8 | E5:8 D5:8 | F5:8 D5:8 | E5:12 .:4`, chords: `x:16`, pad: PAD, arp: ARP8 },
    },
    finalChorus: { progression: PROG, hook: true, parts: { melody: RIFF, bass: GROOVE_BASS, chords: OFFBEAT_STABS, pad: PAD, arp: ARP16, perc: SHAKER16, drums: { ...CHORUS_DRUMS, hat: 'xxxxxxxxxxxxxxxx' } } },
    outro: { progression: PROG, parts: { bass: OFFBEAT_BASS, chords: `.:2 x:2 .:6 x:2 .:4`, pad: PAD, drums: { kick: KICK, ohat: OHAT } } },
  },
  form: [['intro', 1], ['intro2', 1], ['verse', 2], ['pre', 1], ['chorus', 2], ['verse2', 2], ['pre', 1], ['chorus', 2], ['breakdown', 2], ['finalChorus', 2], ['outro', 1]],
  end: true,
};
