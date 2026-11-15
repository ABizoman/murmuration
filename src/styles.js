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

export const DEFAULT_FAMILY = 'pop-upbeat';

export const familyOf = (structure) => (structure && !structure.song && STYLE_FAMILIES[structure.family]) || null;

// The multipliers for one role ('styles' or 'voices'). 1 everywhere when there is no family.
export function familyWeight(family, kind, role, id) {
  if (!family) return 1;
  return family[kind]?.[role]?.[id] ?? family.unlisted ?? 1;
}
