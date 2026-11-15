// Style families: soft preferences that make the improvising band sound like one kind of band.
// (Phase 4b of docs/MUSIC_QUALITY_PLAN.md.)
//
// A family does not ban anything. It multiplies the rules' weights: every style and instrument it
// lists gets its own factor, everything else gets `unlisted` (rare, still possible). It also sets
// the ranges seed.js draws the tempo, mode, progression and swing from. Song mode ignores families:
// a song brings its own key, tempo, chords and instruments.
//
// Every device derives the family from the seed (structure.family), so they all agree.

export const STYLE_FAMILIES = {
  'pop-upbeat': {
    label: 'Upbeat pop',
    bpm: [104, 124],
    majorChance: 0.75,
    swing: [0, 0.06],
    progressions: {
      major: [['I', 'V', 'vi', 'IV'], ['vi', 'IV', 'I', 'V'], ['I', 'vi', 'IV', 'V'], ['IV', 'I', 'V', 'vi']],
      minor: [['i', 'VI', 'III', 'VII'], ['VI', 'VII', 'i', 'i']],
    },
    styles: {
      drums: { 'groove-pop': 3, 'groove-dance': 2, 'groove-rock': 1.5, 'groove-funk': 1, four: 1.5, boombap: 0.5 },
      bass: { pop909: 2, pulse: 2, roots: 1 },
      chords: { pop909: 2, 'drolez-pop': 1.5, stabs: 1.5, pad: 1 },
      melody: { pop909: 2, motif: 1, call: 1 },
    },
    voices: {
      drums: { 'kit-breakbeat': 2, 'kit-acoustic': 1.5, 'kit-linn': 1.5, 'kit-8': 1 },
      bass: { 'bass-electric': 3, 'synth-bass': 2.5, 'bass-slap': 0.4 },
      chords: { 'keys-piano': 2, 'keys-epiano': 2, 'synth-keys': 1.5, 'guitar-steel': 1.5, 'synth-pad': 2, strings: 1 },
      melody: { 'synth-lead': 2, 'synth-pluck': 2.5, 'guitar-clean': 1.5, 'melody-epiano': 1, 'voice-oohs': 0.5 },
    },
    unlisted: 0.05, // weight multiplier for anything not listed (soft, not banned)
  },
};

// Dance: moody, smooth and repetitive, in the spirit of French/Belgian dance-pop. Mostly minor, a
// four-on-the-floor kick with the bass on the off-beats, soft synth sounds, and short melody riffs
// on chord notes that are allowed to repeat (continuity) and never get busy (maxLevel).
STYLE_FAMILIES.dance = {
  label: 'Dance',
  bpm: [118, 124],
  majorChance: 0.15,
  swing: [0, 0.015],
  progressions: {
    minor: [['i', 'VI', 'III', 'VII'], ['i', 'VII', 'VI', 'VII'], ['i', 'iv', 'VI', 'V'], ['i', 'VI', 'VII', 'i']],
    major: [['vi', 'IV', 'I', 'V'], ['I', 'V', 'vi', 'IV']],
  },
  styles: {
    drums: { four: 3, 'groove-dance': 2.5, 'groove-pop': 0.8 },
    bass: { offbeat: 3, pulse: 1.5, roots: 0.8 },
    chords: { pad: 2.5, stabs: 2, 'drolez-pop': 0.6 },
    melody: { riff: 3, motif: 1, call: 0.5, pop909: 0.2 },
  },
  voices: {
    drums: { 'kit-house': 4, 'kit-linn': 1, 'kit-8': 1 },
    bass: { 'synth-bass': 3, 'bass-electric': 0.6 },
    chords: { 'synth-stab': 3, 'synth-pad': 2.5, 'keys-epiano': 1.5, 'synth-keys': 1.5 },
    melody: { 'synth-riff': 3.5, 'synth-pluck': 2, 'synth-lead': 1.5, 'melody-epiano': 1 },
  },
  continuity: { melody: [0.6, 1] }, // fit.js: a riff may repeat itself
  maxLevel: { melody: 2 }, // rules.js: the melody stays simple, even in the chorus
  pump: 'dance', // mix.js PUMP: the kick ducks the bass and chords hard
  unlisted: 0.03,
  unlistedVoices: 0.004, // a trumpet in a dance track: almost never
};

// Improvising uses this family unless the seed asks for another ("<seed>#pop", see seed.js).
export const DEFAULT_FAMILY = 'dance';
export const FAMILY_TAGS = { dance: 'dance', pop: 'pop-upbeat' };

export const familyOf = (structure) => (structure && !structure.song && STYLE_FAMILIES[structure.family]) || null;

// The multipliers for one role ('styles' or 'voices'). 1 everywhere when there is no family.
export function familyWeight(family, kind, role, id) {
  if (!family) return 1;
  return family[kind]?.[role]?.[id] ?? (kind === 'voices' ? family.unlistedVoices : null) ?? family.unlisted ?? 1;
}
