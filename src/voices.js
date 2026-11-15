// Instrument voices per role. Pure data (no Tone.js) so the rules and tests can use it.
// Each agent picks one voice per section (see decide/rules.js); the audio layer loads the samples.
//
// files: sample note names available on disk (sharps), loaded from /samples/<dir>/<note>.mp3
// energy: 0..1, how much drive the sound has (matched against the section's energy)
// family: parts in the same family clash, so the rules avoid two at once
// lead: a sound that stands out when a part is featured
// gain: dB to even out the sample libraries (measured: mean level at the role's typical notes → -30 dB)
// synth: the name of a synth patch in audio.js (PATCHES) instead of samples

const OCT = (from, to) => {
  const out = [];
  for (let o = from; o <= to; o++) for (const n of ['C', 'D#', 'F#', 'A']) out.push(`${n}${o}`);
  return out;
};

export const VOICES = {
  drums: [
    { id: 'kit-acoustic', label: 'Acoustic kit', kit: 'acoustic-kit', energy: 0.45, family: 'kit', weight: 1.4 },
    { id: 'kit-breakbeat', label: 'Breakbeat kit', kit: 'breakbeat8', energy: 0.6, family: 'kit', weight: 1.2 },
    { id: 'kit-linn', label: 'LinnDrum', kit: 'LINN', energy: 0.6, family: 'kit' },
    { id: 'kit-cr78', label: 'CR-78', kit: 'CR78', energy: 0.3, family: 'kit' },
    { id: 'kit-techno', label: 'Techno kit', kit: 'Techno', energy: 0.9, family: 'kit' },
    { id: 'kit-8', label: 'Kit 8', kit: 'Kit8', energy: 0.5, family: 'kit' },
    { id: 'synth-drums', label: 'Synth drums', synth: 'drums', energy: 0.5, family: 'kit', weight: 0.3 },
  ],
  bass: [
    { id: 'bass-electric', label: 'Electric bass', dir: 'electric_bass_finger', files: OCT(1, 4), energy: 0.5, family: 'bass', release: 0.3, weight: 1.6, gain: -6 },
    { id: 'bass-upright', label: 'Upright bass', dir: 'acoustic_bass', files: OCT(1, 4), energy: 0.3, family: 'bass', release: 0.4, weight: 1.2, gain: 1 },
    { id: 'bass-fretless', label: 'Fretless bass', dir: 'fretless_bass', files: OCT(1, 4), energy: 0.35, family: 'bass', release: 0.4, gain: 1 },
    { id: 'bass-slap', label: 'Slap bass', dir: 'slap_bass_1', files: OCT(1, 4), energy: 0.8, family: 'bass', release: 0.2, gain: 14, weight: 0.5 },
    { id: 'bass-tuba', label: 'Tuba', dir: 'tuba', files: OCT(1, 4), energy: 0.4, family: 'brass', release: 0.3, weight: 0.6, gain: -2 },
    { id: 'synth-bass', label: 'Synth bass', synth: 'bass', energy: 0.65, family: 'synth', weight: 1, gain: -5.5 },
  ],
  chords: [
    { id: 'keys-piano', label: 'Grand piano', dir: 'salamander', files: OCT(2, 6), energy: 0.4, family: 'keys', release: 1.2, weight: 1.6, gain: -5 },
    { id: 'keys-epiano', label: 'Electric piano', dir: 'electric_piano_1', files: OCT(2, 6), energy: 0.4, family: 'keys', release: 0.8, weight: 1.3, gain: 1 },
    { id: 'guitar-nylon', label: 'Nylon guitar', dir: 'acoustic_guitar_nylon', files: OCT(2, 6), energy: 0.3, family: 'guitar', release: 0.8, gain: 9 },
    { id: 'guitar-steel', label: 'Steel guitar', dir: 'acoustic_guitar_steel', files: OCT(2, 6), energy: 0.5, family: 'guitar', release: 0.8, gain: 6 },
    { id: 'organ', label: 'Organ', dir: 'drawbar_organ', files: OCT(2, 6), energy: 0.6, family: 'keys', release: 0.15, gain: 4 },
    { id: 'choir', label: 'Choir (aahs)', dir: 'choir_aahs', files: OCT(2, 6), energy: 0.35, family: 'voice', release: 0.6, gain: 5 },
    { id: 'strings', label: 'String ensemble', dir: 'string_ensemble_1', files: OCT(2, 6), energy: 0.4, family: 'strings', release: 0.6, gain: -1 },
    { id: 'brass-section', label: 'Brass section', dir: 'brass_section', files: OCT(2, 6), energy: 0.85, family: 'brass', release: 0.25, gain: 6 },
    { id: 'synth-pad', label: 'Synth pad', synth: 'pad', energy: 0.45, family: 'synth', weight: 1, gain: 14.5 },
    // a soft FM electric piano: family 'keys', so feel.js strums it like the piano
    { id: 'synth-keys', label: 'Synth keys', synth: 'keys', energy: 0.45, family: 'keys', weight: 1, gain: 17.5 },
  ],
  melody: [
    { id: 'trumpet', label: 'Trumpet', dir: 'trumpet', files: OCT(3, 6), energy: 0.75, family: 'brass', release: 0.2, lead: true, weight: 1.3, gain: 4 },
    { id: 'sax-alto', label: 'Alto sax', dir: 'alto_sax', files: OCT(3, 6), energy: 0.6, family: 'reed', release: 0.25, lead: true, weight: 1.3, gain: 0 },
    { id: 'sax-tenor', label: 'Tenor sax', dir: 'tenor_sax', files: OCT(3, 6), energy: 0.55, family: 'reed', release: 0.25, lead: true, gain: -1 },
    { id: 'horn-french', label: 'French horn', dir: 'french_horn', files: OCT(3, 6), energy: 0.4, family: 'brass', release: 0.3, gain: 4 },
    { id: 'trombone', label: 'Trombone', dir: 'trombone', files: OCT(3, 6), energy: 0.6, family: 'brass', release: 0.25, gain: 4 },
    { id: 'guitar-clean', label: 'Clean electric guitar', dir: 'electric_guitar_clean', files: OCT(3, 6), energy: 0.5, family: 'guitar', release: 0.5, lead: true, weight: 1.2, gain: 10 },
    { id: 'guitar-jazz', label: 'Jazz guitar', dir: 'electric_guitar_jazz', files: OCT(3, 6), energy: 0.35, family: 'guitar', release: 0.5, gain: 3 },
    { id: 'guitar-overdrive', label: 'Overdriven guitar', dir: 'overdriven_guitar', files: OCT(3, 6), energy: 0.9, family: 'guitar', release: 0.3, lead: true, weight: 0.7, gain: 3 },
    { id: 'voice-oohs', label: 'Choir (oohs)', dir: 'voice_oohs', files: OCT(3, 6), energy: 0.3, family: 'voice', release: 0.5, gain: 1 },
    { id: 'synth-lead', label: 'Synth lead', synth: 'lead', energy: 0.6, family: 'synth', lead: true, weight: 1, gain: 12.5 },
    { id: 'synth-pluck', label: 'Synth pluck', synth: 'pluck', energy: 0.6, family: 'synth', lead: true, weight: 1, gain: 18.5 },
    // the chords' electric piano samples, as a melody voice of its own (ids are never shared across roles)
    { id: 'melody-epiano', label: 'Electric piano', dir: 'electric_piano_1', files: OCT(3, 6), energy: 0.4, family: 'keys', release: 0.8, gain: 1 },
  ],
};

export const voiceById = Object.fromEntries(Object.values(VOICES).flat().map((v) => [v.id, v]));
export const DEFAULT_VOICE = { drums: 'kit-acoustic', bass: 'bass-electric', chords: 'keys-piano', melody: 'sax-alto' };
export const DRUM_FILES = ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3'];
