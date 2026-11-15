// Seed -> structure. Only key, mode, tempo and the default chord progression come from the seed.
// Everything else (what each agent plays, how busy it is) is decided by the agents.

import { KEYS } from './theory.js';
import { PACK_PROGRESSIONS } from './packs.js';
import { songFromSeed } from './songs/index.js';
import { MAX_SWING } from './clock.js';
import { STYLE_FAMILIES, DEFAULT_FAMILY, FAMILY_TAGS, SECTION_PROGRESSIONS } from './styles.js';
import { songForm, formFromStructure } from './form.js';

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRandom(...parts) {
  let a = hash(parts.join('|'));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reproducible runs: with ?rng=<text> every agent samples from a stream fixed by (rng, who), so
// the same seed and rng give the same music on one device and before/after clips are comparable.
export const randomFor = (rng, who) => (rng ? seededRandom(rng, who) : Math.random);

export const PROGRESSIONS = {
  minor: [
    ['i', 'VI', 'III', 'VII'],
    ['i', 'iv', 'VI', 'V'],
    ['i', 'VII', 'VI', 'VII'],
    ['VI', 'VII', 'i', 'i'],
    ['i', 'iv', 'VII', 'III'],
  ],
  major: [
    ['I', 'V', 'vi', 'IV'],
    ['vi', 'IV', 'I', 'V'],
    ['I', 'vi', 'IV', 'V'],
    ['IV', 'I', 'V', 'vi'],
    ['I', 'iii', 'IV', 'V'],
  ],
};

// Swing is shared timing: it must be a plain number in range on every device.
const clampSwing = (x) => Math.min(MAX_SWING, Math.max(0, Number(x) || 0));

// Tags after the seed, carried in the seed so every device that joins knows them:
//   "#end"   the song ends after one pass of the form (form.js) instead of looping
//   "#pop"   improvise in the upbeat-pop style instead of the default (dance); "#dance" is the default
// e.g. "durhack#pop#end". The rest of the music is decided from the plain seed.
export const END_SUFFIX = '#end';
export function parseSeed(seed) {
  const [base, ...tags] = String(seed ?? '').split('#');
  const style = tags.find((t) => FAMILY_TAGS[t]) ?? null;
  return { base, end: tags.includes('end'), style };
}
const joinSeed = ({ base, end, style }) => `${base}${style && style !== 'dance' ? `#${style}` : ''}${end ? END_SUFFIX : ''}`;
export const withEnd = (seed, end) => joinSeed({ ...parseSeed(seed), end: !!end });
export const withStyle = (seed, style) => joinSeed({ ...parseSeed(seed), style: FAMILY_TAGS[style] ? style : null });

export function structureFromSeed(fullSeed) {
  const { base: seed, end, style } = parseSeed(fullSeed);
  let s = structureFromBase(seed, FAMILY_TAGS[style] ?? DEFAULT_FAMILY);
  if (end) s = { ...s, end: true, ...(s.form ? { form: { ...s.form, end: true } } : {}) };
  return s;
}

// Improvising: each section of the pop form gets its own chords (render.js chordAt reads them), so
// the verse, the pre-chorus, the chorus and the breakdown sound like different places. Drawn from
// their own random stream, so nothing else about the seed changes.
function withSectionChords(s) {
  const r = seededRandom(s.seed, 'sections');
  const fam = STYLE_FAMILIES[s.family] || {};
  const lists = { ...SECTION_PROGRESSIONS, ...(fam.sectionProgressions || {}) };
  const pick = (list, avoid) => {
    const options = (list || []).filter((p) => p.join() !== avoid?.join());
    return options.length ? options[Math.floor(r() * options.length)] : avoid;
  };
  const chorus = s.progression;
  const own = fam.progressions?.[s.mode] || PROGRESSIONS[s.mode];
  const verse = pick(own, chorus);
  const pre = pick(lists.pre?.[s.mode], chorus);
  const breakdown = pick(lists.breakdown?.[s.mode], chorus);
  const sections = { intro: chorus, verse, pre, chorus, verse2: verse, breakdown, finalChorus: chorus, outro: chorus };
  const form = formFromStructure({ seed: s.seed });
  return { ...s, form, sections: Object.fromEntries(Object.entries(sections).map(([n, p]) => [n, { progression: p }])) };
}

function structureFromBase(seed, familyName) {
  // "song:<id>" plays a fixed song: its own key, tempo and chords, and the agents build it up.
  const song = songFromSeed(seed);
  if (song) {
    const { id, title, composer, build, voices, react, register } = song;
    const out = { seed, key: song.key, mode: song.mode, bpm: song.bpm, progression: song.progression, swing: clampSwing(song.swing), mood: `${title} (${composer})`, song: { id, title, composer, build, voices, react: !!react, register: register || null } };
    // A song with sections (step E): its form, and each section's chords (render.js chordAt).
    const form = songForm(song);
    if (form) {
      out.form = form;
      out.sections = Object.fromEntries(Object.entries(song.compiledSections).map(([n, sec]) => [n, { progression: sec.progression }]));
      if (song.end) out.end = true;
    }
    return out;
  }
  const r = seededRandom(seed, 'structure');
  const mode = r() < 0.6 ? 'minor' : 'major';
  const key = KEYS[Math.floor(r() * 12)];
  const bpm = 78 + Math.floor(r() * 28); // 78-105
  // The built-in progressions plus the mood-tagged ones from free-midi-chords.
  const list = [...PROGRESSIONS[mode].map((chords) => ({ chords, mood: '' })), ...(PACK_PROGRESSIONS[mode] || [])];
  const pick = list[Math.floor(r() * list.length)];
  // Swing is drawn last on purpose: every seed keeps the key, tempo and progression it had before.
  const swing = clampSwing(Math.round(r() * 60) / 1000); // 0 to 0.06 of a 16th: upbeat pop, not jazz
  const plain = { seed, key, mode, bpm, progression: pick.chords, swing, mood: pick.mood };
  return withSectionChords(withFamily(plain, r, familyName));
}

// The style family (styles.js) re-draws the mode, tempo, progression and swing from its own ranges.
// Its draws come after all the old ones, so the key of every seed is unchanged; the tempo and mode
// of old seeds do change (on purpose: the improvising band now plays upbeat pop).
function withFamily(plain, r, name) {
  const fam = STYLE_FAMILIES[name];
  if (!fam) return plain;
  const mode = r() < fam.majorChance ? 'major' : 'minor';
  const bpm = fam.bpm[0] + Math.floor(r() * (fam.bpm[1] - fam.bpm[0] + 1));
  // The family's own progressions get two thirds of the chance, the mood-tagged pack ones the rest.
  const own = fam.progressions[mode] || [];
  const pack = PACK_PROGRESSIONS[mode] || [];
  const useOwn = own.length && (!pack.length || r() < 2 / 3);
  const list = useOwn ? own.map((chords) => ({ chords, mood: '' })) : pack;
  const pick = list[Math.floor(r() * list.length)];
  const swing = clampSwing(Math.round((fam.swing[0] + r() * (fam.swing[1] - fam.swing[0])) * 1000) / 1000);
  return { ...plain, mode, bpm, progression: pick.chords, swing, mood: pick.mood || fam.label, family: name };
}
