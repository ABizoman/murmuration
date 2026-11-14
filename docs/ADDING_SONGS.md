# Adding songs to Murmuration

In song mode the swarm plays a fixed song and builds it up together: one part starts alone, and the others come in
one by one when enough parts are already playing (each agent decides for itself, so the order is a tendency, not a script).
The agents still choose how busy to play, which instrument to use and when to drop out for a breakdown (the director can call it),
but the notes of the song stay exactly as written.

There are two ways to add a song: write it by hand, or convert a MIDI file.

## Where song files go

| folder | for | in git? |
|---|---|---|
| `src/songs/` | public-domain songs and songs you wrote yourself, shipped with the project | yes — also add it to `src/songs/index.js` |
| `songs-local/` | everything else (covers, songs you only have permission to play) | **no** (gitignored); loaded automatically at startup |

Only put a song in `src/songs/` if it is public domain or yours to publish. In the UK/EU a composition is public domain
70 years after the composer's death; in the US, works first published before 1929 (moving forward each January).
A recording or a modern arrangement of an old piece can have its own copyright; writing the notes out from the original score is safe.

## The song file

A song is a JavaScript module exporting one object. Copy `src/songs/ode-to-joy.js` as a starting point.

```js
export default {
  id: 'ode-to-joy',                 // lowercase, dashes; used in the seed "song:ode-to-joy"
  title: 'Ode to Joy',
  composer: 'Ludwig van Beethoven, 1824',
  licence: 'public domain',         // for your own records
  key: 'D',                         // C Db D Eb E F F# G Ab A Bb B
  mode: 'major',                    // major or minor
  bpm: 108,
  progression: ['I', 'V', 'I', 'V', 'I', 'V', 'I', 'I'],   // one chord per bar, 4 or 8 chords
  build: ['melody', 'chords', 'bass', 'drums'],            // who tends to come in first (optional)
  voices: {                                                 // instruments each part may use (optional)
    melody: ['trumpet', 'horn-french', 'voice-oohs'],
    chords: ['keys-piano', 'strings'],
  },
  parts: {
    melody: { medium: `F#4:4 F#4:4 G4:4 A4:4 | A4:4 G4:4 F#4:4 E4:4 | ...` },
    bass:   { sparse: `...`, medium: `...`, busy: `...` },
    chords: { medium: `x:8 x:8` },
    drums:  { medium: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
  },
};
```

### Chords (`progression`)
One Roman numeral per bar, relative to `key` and `mode`: uppercase = major chord, lowercase = minor, `°` = diminished,
`b` in front = flattened root (`bVII`). In a minor key `V` means the major V (with the raised seventh).
Only plain triads: write `V` for a V7, `ii` for a iim7. Melody notes outside the chord still play exactly as written.

The chords matter: the melody and bass are stored relative to them, and the chords part plays them.
If a bar has two chords, pick the one that lasts longer (or double the tempo so each chord gets a bar).

### Melody and bass
Notes with their length in 16th notes, bars separated by `|`:

```
F#4:4 F#4:4 G4:4 A4:4 | F#4:6 E4:2 E4:8
```

- `F#4:4` is F#4 for a quarter note (4 sixteenths). `:2` = eighth, `:8` = half, `:16` = whole bar.
- `.` is a rest: `.:4`. Add `!` for an accent: `D4:4!`.
- Sharps `#`, flats `b`: `C#5`, `Bb3`. Middle C is `C4`.
- Every bar must add up to 16; the compiler tells you which bar doesn't.
- One note at a time per part (no chords inside a melody or bass part).
- The octave you write doesn't matter much: parts are moved by whole octaves into the instrument's range,
  but the shape of the tune is kept exactly.

### Chord rhythm
`x` plays the bar's chord, `.` rests, with the same lengths: `x:4 .:4 x:2 x:2 .:4`. A single bar repeats.

### Drums
One line per drum (`kick`, `snare`, `hat`, `ohat`, `tom1`, `tom2`, `tom3`), one character per 16th:
`x` hit, `X` accented hit, `.` nothing. Bars are separated by `|`; a single bar repeats.

### sparse / medium / busy
Each part can have up to three versions; the agents pick between them as the music builds.
Give at least one. If `sparse` is missing for melody, bass or chords, it is made from the main version (only the notes on beats 1 and 3);
`busy` falls back to `medium`. Keep the recognisable version as `medium`.

Parts can be 1, 2, 4 or 8 bars. With an 8-chord progression, write 8-bar melody and bass parts so every note sits on the chord it was written for.

### Instruments (`voices`)
Any instrument id from `src/voices.js` can be listed for any part, e.g. `strings` for a melody:
`keys-piano keys-epiano guitar-nylon guitar-steel organ choir strings brass-section synth-pad`,
`trumpet sax-alto sax-tenor horn-french trombone guitar-clean guitar-jazz guitar-overdrive voice-oohs synth-lead`,
`bass-electric bass-upright bass-fretless bass-slap bass-tuba synth-bass`,
`kit-acoustic kit-breakbeat kit-linn kit-cr78 kit-techno kit-8 synth-drums`. The first one listed is preferred.

## Converting a MIDI file

If you have the song as MIDI with one track per part (export from a DAW, or record it yourself):

```
node tools/midi-to-song.mjs my-song.mid --id my-song --title "My Song" --composer "Me" \
     --key A --mode minor --bars 4 --from 1 \
     --melody "Lead" --bass "Bass" --chords "Keys" --drums "Drums"
```

- `--melody/--bass/--chords/--drums` match track names (part of the name is enough); leave out parts you don't have.
- `--bars 4` or `8`, `--from` = the bar to start at (pick the loop you want: usually the chorus or the hook).
- Notes are snapped to 16ths; a note across a bar line is split in two. Swung or triplet parts will be approximate.
- The chords are **guessed** from the chords track, bar by bar. Check `progression` in the result.
- It writes `songs-local/<id>.js` and compiles it to check for mistakes. Open it to add `sparse`/`busy` versions, `voices`, and a `build` order.

## Checking a song

1. `npm test` compiles every built-in song and checks it renders exactly what was written.
2. Restart the server (`start.command`), reload the page, pick the song in the **Song** menu, press **Start a song**.
3. Other devices that join get the song automatically (they load it from the same server).

If something is off, the error names the song, the part and the bar. A song file with an error is skipped and the page log says why.
