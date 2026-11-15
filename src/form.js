// The form: an improvised song is a pop song, not an endless jam (Phase 5 of
// docs/MUSIC_QUALITY_PLAN.md). Pure and shared: every device derives the same form from the
// structure and the same section from the phrase number, so nothing about it is gossiped.
//
//   intro 1 · verse 2 · pre 1 · chorus 2 · verse2 2 · chorus 2 · breakdown 1 · finalChorus 2 · outro 1
//
// (numbers are phrases of 4 bars). After the outro the form loops back to verse2, or, when the
// song should end after one pass (structure.end), one "end" phrase follows and the song stops.
//
// Each section says how loud the band should be (`energy`), how much each part plays (`plan`:
// 'out' | 'light' | 'normal' | 'full'), whether it is a hook section (the chorus repeats its hook),
// and which transitions lead into it (`transitionIn`: 'fill', 'crash', 'riser').
//
// formDirective() turns (form, phrase, the director's directive) into the directive the rules read:
// the form leads, the director nudges.

import { DEFAULT_DIRECTIVE } from './decide/directive.js';
import { ROLES } from './loops.js';

// plan(core band, then the extra layers): the pad comes in with the verse, the arp and the perc
// build through the pre-chorus and fill the choruses; the breakdown keeps only the pad's air.
const plan = (drums, bass, chords, melody, pad = 'out', arp = 'out', perc = 'out') => ({ drums, bass, chords, melody, pad, arp, perc });

export const POP_FORM = [
  { name: 'intro', phrases: 1, energy: 0.3, plan: plan('light', 'out', 'normal', 'out'), hook: false, transitionIn: [] },
  { name: 'verse', phrases: 2, energy: 0.45, plan: plan('normal', 'normal', 'normal', 'normal', 'light'), hook: false, transitionIn: [] },
  { name: 'pre', phrases: 1, energy: 0.65, plan: plan('normal', 'normal', 'normal', 'light', 'normal', 'light', 'light'), hook: false, transitionIn: ['fill'] },
  { name: 'chorus', phrases: 2, energy: 0.9, plan: plan('full', 'full', 'full', 'full', 'normal', 'full', 'full'), hook: true, transitionIn: ['fill', 'crash', 'riser'] },
  { name: 'verse2', phrases: 2, energy: 0.5, plan: plan('normal', 'normal', 'normal', 'normal', 'normal', 'out', 'light'), hook: false, transitionIn: ['fill', 'crash'] },
  { name: 'chorus', phrases: 2, energy: 0.95, plan: plan('full', 'full', 'full', 'full', 'normal', 'full', 'full'), hook: true, transitionIn: ['fill', 'crash', 'riser'] },
  { name: 'breakdown', phrases: 1, energy: 0.35, plan: plan('out', 'out', 'normal', 'light', 'normal'), hook: false, transitionIn: [], dropLastBar: true },
  { name: 'finalChorus', phrases: 2, energy: 1, plan: plan('full', 'full', 'full', 'full', 'normal', 'full', 'full'), hook: true, transitionIn: ['fill', 'crash', 'riser'] },
  { name: 'outro', phrases: 1, energy: 0.3, plan: plan('light', 'out', 'light', 'out', 'light'), hook: false, transitionIn: [] },
];
const LOOP_FROM = 'verse2'; // where the form goes back to after the outro

// The one-phrase coda when the song ends: every part plays one last note on the downbeat.
export const END_SECTION = { name: 'end', phrases: 1, energy: 0.3, plan: plan('normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'out'), hook: false, transitionIn: ['crash'], end: true };

// A song's own form (songs/format.js `sections` + `form`), as the same kind of object as the pop
// form. Each entry of the song's form is one section here, so the transitions can depend on what
// came before. Defaults by section name, all overridable per section in the song:
//   energy  intro 0.35, verse 0.5, pre 0.65, chorus 0.9, finalChorus 1, bridge/breakdown 0.4, outro 0.3
//   plan    a part the section gives notes to plays ('full' in a hook section, else 'normal'),
//           any other part sits out
//   transitionIn  hook sections: fill + crash + riser; a verse after a hook: fill + crash;
//           pre: fill; the first section and everything else: none
const ENERGY_BY_NAME = { intro: 0.35, verse: 0.5, pre: 0.65, chorus: 0.9, finalChorus: 1, bridge: 0.4, breakdown: 0.4, outro: 0.3 };
const baseName = (name) => name.replace(/\d+$/, '');
export function songForm(song) {
  const defs = song.compiledSections;
  if (!defs || !song.form) return null;
  const sections = song.form.map(([name, phrases], i) => {
    const d = defs[name];
    const prev = i > 0 ? defs[song.form[i - 1][0]] : null;
    const plan = {};
    for (const r of ROLES) plan[r] = d.plan?.[r] ?? (d.roles.includes(r) ? (d.hook ? 'full' : 'normal') : 'out');
    let transitionIn = d.transitionIn;
    if (!transitionIn) {
      if (i === 0) transitionIn = [];
      else if (d.hook) transitionIn = ['fill', 'crash', 'riser'];
      else if (baseName(name) === 'verse' && prev?.hook) transitionIn = ['fill', 'crash'];
      else if (baseName(name) === 'pre') transitionIn = ['fill'];
      else transitionIn = [];
    }
    return { name, phrases, energy: d.energy ?? ENERGY_BY_NAME[baseName(name)] ?? 0.5, plan, hook: d.hook, transitionIn: [...transitionIn] };
  });
  const starts = [];
  let at = 0;
  for (const sec of sections) { starts.push(at); at += sec.phrases; }
  const loopIndex = Math.max(0, song.loopFrom ? song.form.findIndex(([n]) => n === song.loopFrom) : Math.min(1, sections.length - 1));
  return { sections, starts, length: at, loopIndex, loopStart: starts[loopIndex], end: !!song.end };
}

// The upbeat-pop form when improvising; a song's own form if it has sections (seed.js puts it on
// the structure); null for a song without sections.
export function formFromStructure(structure) {
  if (structure?.form) return structure.end && !structure.form.end ? { ...structure.form, end: true } : structure.form;
  if (!structure || structure.song) return null;
  const sections = POP_FORM.map((s) => ({ ...s, plan: { ...s.plan }, transitionIn: [...s.transitionIn] }));
  const starts = [];
  let at = 0;
  for (const s of sections) { starts.push(at); at += s.phrases; }
  const loopIndex = sections.findIndex((s) => s.name === LOOP_FROM);
  return { sections, starts, length: at, loopIndex, loopStart: starts[loopIndex], end: !!structure.end };
}

// Where a phrase sits in the form. Pure function of (form, phrase).
//   { section, index, phraseInSection, isFirstPhrase, isLastPhrase, pass, ended }
// pass counts trips through the loop (0 the first time). With form.end, the phrase after the first
// outro is the END_SECTION and every later phrase is `ended` (nothing plays).
export function sectionAt(form, phrase) {
  if (!form || phrase < 0) return null;
  let p = phrase;
  let pass = 0;
  if (p >= form.length) {
    if (form.end) {
      const ended = p > form.length;
      return { section: END_SECTION, index: form.sections.length, phraseInSection: 0, isFirstPhrase: true, isLastPhrase: true, pass: 0, ended };
    }
    const loopLen = form.length - form.loopStart;
    pass = 1 + Math.floor((p - form.length) / loopLen);
    p = form.loopStart + ((p - form.length) % loopLen);
  }
  let index = form.starts.length - 1;
  while (form.starts[index] > p) index--;
  const section = form.sections[index];
  const phraseInSection = p - form.starts[index];
  return { section, index, phraseInSection, isFirstPhrase: phraseInSection === 0, isLastPhrase: phraseInSection === section.phrases - 1, pass, ended: false };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// The directive for a phrase: the form's section, nudged by the director's directive.
export function formDirective(form, phrase, director = DEFAULT_DIRECTIVE) {
  const at = sectionAt(form, phrase);
  if (!at) return director || DEFAULT_DIRECTIVE;
  const dir = director || DEFAULT_DIRECTIVE;
  const { section } = at;
  const next = sectionAt(form, phrase + 1);
  const sitting = (role) => role && section.plan[role] === 'out';
  const energy = clamp(section.energy + 0.4 * ((dir.energy ?? 0.5) - 0.5), 0, 1);
  const feature = sitting(dir.feature) ? null : dir.feature ?? null;
  const pair = dir.pair && !sitting(dir.pair.who) && !sitting(dir.pair.whom) ? dir.pair : null;
  const drop = dir.drop && section.plan[dir.drop] === 'normal' ? dir.drop : null;
  return {
    energy,
    feature,
    drop,
    pair,
    note: dir.note ?? '',
    plan: { ...section.plan },
    section: section.name,
    hook: !!section.hook,
    sectionIndex: at.index,
    phraseInSection: at.phraseInSection,
    isFirstPhrase: at.isFirstPhrase,
    isLastPhrase: at.isLastPhrase,
    pass: at.pass,
    transitionIn: at.isFirstPhrase && !at.ended ? [...section.transitionIn] : [],
    // what leads into the next section (fills and risers go in this phrase's last bar)
    nextTransitionIn: at.isLastPhrase && next && !next.ended ? [...next.section.transitionIn] : [],
    nextSection: at.isLastPhrase && next ? next.section.name : null,
    nextHook: !!(at.isLastPhrase && next && !next.ended && next.section.hook),
    nextPlan: at.isLastPhrase && next && !next.ended ? { ...next.section.plan } : null,
    // the build-up (transitions.js): the last phrase of a section that leads into a hook section
    // (pre -> chorus, verse2 -> chorus, breakdown -> finalChorus) sweeps open and drops out
    buildUp: !!(at.isLastPhrase && !section.hook && !at.ended && next && !next.ended && next.section.hook),
    dropLastBar: !!(section.dropLastBar && at.isLastPhrase),
    end: !!section.end,
    ended: !!at.ended,
  };
}

// One line for the director LLM and the screen: "chorus (2 of 2) → verse2".
export function describeSection(form, phrase) {
  const at = sectionAt(form, phrase);
  if (!at) return '';
  if (at.ended) return 'the song has ended';
  const s = at.section;
  return `${s.name}${s.phrases > 1 ? ` (${at.phraseInSection + 1} of ${s.phrases})` : ''}${s.hook ? ', a hook section' : ''}`;
}
