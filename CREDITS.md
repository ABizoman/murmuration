# Credits

## Instrument samples (`samples/`)
- **MusyngKite soundfont** (bass, guitars, organ, electric piano, choir, voice, strings, brass, saxophones, horns):
  generated from *Musyng Kite* by gleitz/midi-js-soundfonts — https://github.com/gleitz/midi-js-soundfonts.
  Licensed **CC BY-SA 3.0** (https://creativecommons.org/licenses/by-sa/3.0/). These sample files stay under that licence.
- **Salamander Grand Piano** by Alexander Holm, via the Tone.js audio repo — https://github.com/Tonejs/audio. Licensed **CC BY 3.0**.
- **Drum kits** (acoustic-kit, breakbeat8, LINN, CR78, Techno, Kit8) from the Tone.js audio repo, which took them from
  https://github.com/cwilso/web-audio-samples. No licence is stated for these files; replace them if that matters for your use.

Only a subset of notes is included (every third semitone); Tone.js repitches between them.

## Loop packs (`src/packs/`, built by `tools/build-packs.mjs`)
- **Groove MIDI Dataset** — Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman, Magenta / Google.
  https://magenta.tensorflow.org/datasets/groove. Licensed **CC BY 4.0**. Drum loops are 2-bar windows of the 4/4 beats,
  quantised to 16ths; swung windows that don't fit a 16th grid were left out.
  *Gillick et al., "Learning to Groove with Inverse Sequence Transformations", ICML 2019.*
- **POP909** — Ziyu Wang, Ke Chen, Junyan Jiang, Yiyi Zhang, Maoran Xu, Shuqi Dai, Guxian Bin, Gus Xia (Music X Lab).
  https://github.com/music-x-lab/POP909-Dataset. Licensed **MIT**. Melodies (MELODY track), bass lines (lowest piano notes)
  and comping rhythms (piano chord onsets), each converted to scale degrees against the song's own chord labels.
  *Wang et al., "POP909: A Pop-song Dataset for Music Arrangement Generation", ISMIR 2020.*
- **free-midi-chords** — Ludovic Drolez and contributors. https://github.com/ldrolez/free-midi-chords. Licensed **MIT**.
  Mood-tagged chord progressions and chord rhythm patterns (read from the source as data).
