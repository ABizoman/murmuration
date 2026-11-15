// Offline decision rules. For each of the four choices an agent makes per phrase
// (how busy, which pattern, which register, echo/answer someone) plus the instrument at the start
// of each section, the rules give every option
// a weight from what the other parts did. No network needed: this always works.
//
// Returns { level, style, register, interaction, reasons } where each of the four is
// { option: weight } and reasons are short notes for the screen, each with a test for
// whether the final decision actually followed it.

import { DEFAULT_DIRECTIVE } from './directive.js';
import { VOICES, voiceById, DEFAULT_VOICE } from '../voices.js';
import { familyOf, familyWeight } from '../styles.js';

export const SECTION_PHRASES = 4;
export const VOICE_HOLD_SECTIONS = 2; // an instrument is kept at least this many director sections
const ORDER = ['drums', 'bass', 'chords', 'melody'];
const GROOVE_ROLES = new Set(['drums', 'bass']); // keep their style for the whole section
const GROOVE_ENERGY_JUMP = 0.3; // ...unless the energy moves more than this

export const ENTRY = { chords: 0, drums: 1, bass: 1, melody: 2 }; // song phrase each role enters at
export const REGISTERS = { drums: [0], bass: [0, 1], chords: [-1, 0, 1], melody: [-1, 0, 1] };
const CENTRE = { bass: 40, chords: 64, melody: 74 }; // typical mean pitch at register 0
const REGISTER_PRIOR = { bass: { 0: 1.5, 1: 0.35 }, chords: { '-1': 0.8, 0: 1.5, 1: 0.6 }, melody: { '-1': 0.45, 0: 1.5, 1: 1 } };
const STYLE_ENERGY = { 'drums/boombap': 0.4, 'drums/four': 0.75, 'bass/roots': 0.35, 'bass/pulse': 0.75, 'bass/offbeat': 0.6, 'chords/pad': 0.3, 'chords/stabs': 0.7, 'melody/riff': 0.55 };

// Who naturally imitates or responds to whom.
const AFFINITY = {
  drums: { 'echo:bass': 0.8, 'answer:melody': 0.35 },
  bass: { 'echo:drums': 0.8, 'answer:melody': 0.5, 'echo:melody': 0.3 },
  chords: { 'answer:melody': 0.6, 'echo:melody': 0.4, 'echo:bass': 0.4 },
  melody: { 'answer:bass': 0.6, 'answer:chords': 0.5, 'echo:bass': 0.5, 'answer:drums': 0.2 },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// How many phrases in a row the part has kept the same value for `key`.
export const runLength = (history, key) => {
  let n = 0;
  for (const h of history) {
    if (h[key] !== history[0][key]) break;
    n++;
  }
  return n;
};

export function ruleScores(ctx, library) {
  const { role, peers, last, history } = ctx;
  const dir = ctx.directive || DEFAULT_DIRECTIVE;
  const reasons = [];
  const others = Object.values(peers).filter(Boolean);
  const active = others.filter((p) => p.level > 0 && p.notes.length);

  // ---- 1. How busy --------------------------------------------------------------
  let level;
  const song = ctx.structure?.song;
  if (song && !dir.plan) {
    level = songLevel(ctx, song, dir, active, last, reasons); // a song without sections builds itself up
  } else if (!dir.plan && ctx.phrase < ENTRY[role]) {
    level = { 0: 1 }; // with a form, the intro and verse plans decide who comes in when
    reasons.push({ text: 'waiting for my entry' });
  } else if (dir.drop === role) {
    level = { 0: 5, 1: 1 };
    reasons.push({ text: 'direction: drop out', when: (d) => d.level === 0 });
  } else {
    const wanted = 1 + 2 * dir.energy; // average level the band is aiming for
    let target = wanted;
    if (active.length) {
      const avg = active.reduce((a, p) => a + p.level, 0) / active.length;
      target = clamp(wanted + (wanted - avg), 1, 3);
      if (avg - wanted >= 0.5) reasons.push({ text: 'others are busy → thinning out', when: (d) => d.level < avg });
      else if (wanted - avg >= 0.5) reasons.push({ text: 'others are sparse → filling in', when: (d) => d.level > avg });
    }
    level = {};
    for (const l of [1, 2, 3]) level[l] = Math.exp(-((l - target) ** 2) / 0.7);
    if (role !== 'melody' && peers.melody?.level === 3) {
      level[3] *= 0.3;
      level[1] *= 1.6;
      reasons.push({ text: 'melody is busy → leaving it room', when: (d) => d.level < 3 });
    }
    if (dir.feature === role) {
      level[3] *= 2.2;
      level[1] *= 0.5;
      reasons.push({ text: 'direction: I am featured', when: (d) => d.level >= 2 });
    } else if (dir.feature) {
      level[3] *= 0.45;
      reasons.push({ text: `direction: ${dir.feature} is featured → backing off`, when: (d) => d.level < 3 });
    }
    if (last?.level > 0) {
      level[last.level] *= runLength(history, 'level') >= 3 ? 0.4 : 1.4; // some inertia, then change
    }
    level[0] = ctx.phrase >= ENTRY[role] + 2 && last?.level > 0 && role !== 'chords' ? 0.012 : 0; // a rare breath
  }
  if (dir.plan?.[role]) level = clampToPlan(level, dir.plan[role], dir.energy, reasons); // the form's plan (improvising, or a song with sections)
  // A family can keep a part simple (dance: the melody never goes busy).
  const cap = familyOf(ctx.structure)?.maxLevel?.[role];
  if (cap != null && Object.keys(level).some((l) => Number(l) > cap)) {
    const kept = Object.fromEntries(Object.entries(level).filter(([l]) => Number(l) <= cap));
    level = Object.values(kept).some((w) => w > 0) ? kept : { [cap]: 1 };
  }

  // ---- 2. Which pattern ---------------------------------------------------------
  const family = familyOf(ctx.structure); // null in song mode
  let style = {};
  // A song with sections: the section's own part, nothing else.
  const sectionStyle = song && ctx.structure.sections && dir.section ? `song-${song.id}-${dir.section}` : null;
  for (const s of sectionStyle && library.styles(role).includes(sectionStyle) ? [sectionStyle] : library.styles(role)) {
    const e = STYLE_ENERGY[`${role}/${s}`] ?? library.styleEnergy?.(role, s) ?? 0.5;
    style[s] = (library.styleWeight?.(role, s) ?? 1) * familyWeight(family, 'styles', role, s) * Math.exp(-((e - dir.energy) ** 2) / 0.12);
  }
  if (!sectionStyle && last?.style && last.style in style) {
    // With many styles to choose from, "keep it" has to win most of the time or the groove
    // changes every phrase: make the current style a fixed share of the total.
    const held = runLength(history, 'style');
    const others = Object.entries(style).filter(([k]) => k !== last.style).reduce((a, [, w]) => a + w, 0);
    const share = held < 3 ? 0.8 : held < 6 ? 0.55 : 0.25;
    style[last.style] = Math.max(style[last.style], (others * share) / (1 - share));
    // Groove stability (improvising): the drums and the bass keep their style for the whole
    // section, unless the energy jumps. Only the phrase number and the shared directives decide.
    if (family && GROOVE_ROLES.has(role) && last.level > 0 && ctx.phrase % SECTION_PHRASES !== 0 && !dir.isFirstPhrase) {
      const before = ctx.prevDirective?.energy ?? dir.energy;
      if (Math.abs(dir.energy - before) <= GROOVE_ENERGY_JUMP) {
        style = { [last.style]: 1 };
        reasons.push({ text: 'keeping the groove for the section' });
      }
    }
  }

  // ---- 3. Which register --------------------------------------------------------
  const register = {};
  // A song plays in its own register: 0, or what it asks for per part (register: { melody: 1 }).
  for (const r of song ? [[-1, 0, 1].includes(song.register?.[role]) ? song.register[role] : 0] : REGISTERS[role]) {
    let w = REGISTER_PRIOR[role]?.[r] ?? 1;
    if (role !== 'drums') {
      const centre = CENTRE[role] + 12 * r;
      for (const p of active) {
        if (p.meanPitch == null || p.role === 'drums') continue;
        const dist = Math.abs(centre - p.meanPitch);
        if (dist < 6) {
          w *= 0.2;
          if (r === (last?.register ?? 0)) reasons.push({ text: `${p.role} is in my register → moving`, when: (d) => d.register !== r });
        } else if (dist < 9) w *= 0.65;
      }
      if (last && last.level > 0 && last.register === r) w *= 1.3;
    }
    register[r] = w;
  }

  // ---- 4. Echo or answer someone ------------------------------------------------
  const interaction = { none: last ? 1.2 : 2.4 };
  for (const [opt, affinity] of Object.entries(song && !song.react ? {} : AFFINITY[role] || {})) {
    const [mode, target] = opt.split(':');
    const p = peers[target];
    if (!p || !p.notes.length || p.level === 0) continue;
    let w = affinity * (0.6 + Math.min(p.density, 8) / 8);
    if (last?.interaction === opt) w *= 0.5; // don't do the same trick twice
    if (mode === 'answer' && (p.interaction === `echo:${role}` || p.interaction === `answer:${role}`)) {
      w *= 1.8; // they addressed me: keep the conversation going
      reasons.push({ text: `${target} addressed me → replying`, when: (d) => d.interaction === opt });
    }
    if (dir.pair && dir.pair.who === role && dir.pair.whom === target && dir.pair.mode === mode) {
      w *= 4;
      reasons.push({ text: `direction: ${mode} the ${target}`, when: (d) => d.interaction === opt });
    }
    interaction[opt] = w;
  }

  // ---- 5. Which instrument (only at the start of a section) ----------------------
  const voice = {};
  const current = last?.voice && voiceById[last.voice] ? last.voice : null;
  // A song with sections keeps one instrument per part all the way through: the first it lists.
  // (Every device gets the same answer, however it joined.)
  if (song && ctx.structure.sections) {
    const fixed = song.voices?.[role]?.find((id) => voiceById[id]) ?? DEFAULT_VOICE[role];
    return { level, style, register, interaction, voice: { [fixed]: 1 }, reasons };
  }
  // Improvising: at a section start, at most one part changes instrument, the one that has held its
  // instrument longest (and at least VOICE_HOLD_SECTIONS sections). See voiceTurn().
  const myTurn = !current || song || voiceTurn(ctx) === role;
  if (current && (ctx.phrase % SECTION_PHRASES !== 0 || !myTurn) && (!song?.voices?.[role] || song.voices[role].includes(current))) {
    voice[current] = 1; // keep it until the next section (or until it is my turn)
  } else {
    const held = current ? Math.ceil(runLength(history, 'voice') / SECTION_PHRASES) : 0;
    const taken = active.filter((p) => p.voice && voiceById[p.voice]).map((p) => voiceById[p.voice]);
    const options = song?.voices?.[role]?.map((id) => voiceById[id]).filter(Boolean) ?? VOICES[role] ?? [];
    for (const v of options) {
      let w = (v.weight ?? 1) * familyWeight(family, 'voices', role, v.id) * Math.exp(-((v.energy - dir.energy) ** 2) / 0.15);
      for (const t of taken) if (t.family === v.family) w *= 0.25;
      if (dir.feature === role && v.lead) w *= 1.8;
      if (v.id === current) w *= family ? 0.3 : held >= 2 ? 0.5 : 2.2; // improvising: it is my turn to change
      // the first instrument: the song's own first choice, or the default (the family decides instead)
      if (!current && !family && v.id === (song?.voices?.[role]?.[0] ?? DEFAULT_VOICE[role])) w *= song ? 3 : 1.5;
      voice[v.id] = w;
    }
    const clash = taken.find((t) => current && voiceById[current]?.family === t.family);
    if (clash) reasons.push({ text: `${clash.label} is in the same family → changing instrument`, when: (d) => d.voice !== current });
    if (current && held >= 2) reasons.push({ text: 'new section → new instrument', when: (d) => d.voice !== current });
  }

  return { level, style, register, interaction, voice, reasons };
}

// The form's plan for this part in this section (form.js) caps the busyness the rules worked out.
export function clampToPlan(level, plan, energy, reasons = []) {
  const out = { 0: 0, 1: 0, 2: 0, 3: 0, ...level };
  if (plan === 'out') {
    reasons.push({ text: 'section: sitting out' });
    return { 0: 1 };
  }
  if (plan === 'light') {
    out[2] = out[3] = 0;
    out[1] = Math.max(out[1], 0.1);
    out[0] = Math.min(out[0] || 0.02, 0.02);
    reasons.push({ text: 'section: playing light', when: (d) => d.level <= 1 });
  } else if (plan === 'normal') {
    if (energy < 0.6) out[3] = 0;
    if (!(out[1] + out[2] + out[3] > 0)) out[2] = 1;
  } else if (plan === 'full') {
    out[0] = out[1] = 0;
    if (!(out[2] + out[3] > 0)) out[2] = out[3] = 1;
    reasons.push({ text: 'section: everyone in', when: (d) => d.level >= 2 });
  }
  return Object.fromEntries(Object.entries(out).filter(([, w]) => w > 0));
}

// Which role may change instrument at this phrase (a section start), or null. Every device must give
// the same answer, so it reads only what everyone knows: last phrase's part of every role (with its
// `voiceSince`, the phrase its instrument started) and the phrase number. The part that has held its
// instrument longest goes first (counted up to 3 sections). Ties go in role order drums, bass, chords, melody, rotated by one
// place every section, so a part that was offered the turn and kept its instrument does not keep
// the turn for ever.
export function voiceTurn(ctx) {
  if (ctx.phrase % SECTION_PHRASES !== 0) return null;
  const shift = (ctx.phrase / SECTION_PHRASES) % ORDER.length;
  const order = [...ORDER.slice(shift), ...ORDER.slice(0, shift)];
  let best = null, bestHeld = -1;
  for (const r of order) {
    const s = r === ctx.role ? ctx.last : ctx.before?.[r];
    if (!s || s.phrase !== ctx.phrase - 1 || !s.voice) continue;
    const held = ctx.phrase - (Number.isInteger(s.voiceSince) ? s.voiceSince : 0);
    if (held < VOICE_HOLD_SECTIONS * SECTION_PHRASES) continue;
    // Capped, so a part that keeps declining its turn ties with the others and the rotation moves on.
    const rank = Math.min(held, (VOICE_HOLD_SECTIONS + 1) * SECTION_PHRASES);
    if (rank > bestHeld) { best = r; bestHeld = rank; }
  }
  return best;
}

// Song mode: nobody tells the parts when to come in. Each part waits until enough of the parts
// ahead of it in the song's build order are playing, with some randomness, so the swarm builds
// the song up layer by layer on its own. Once in, a part stays (the director can still drop it).
function songLevel(ctx, song, dir, active, last, reasons) {
  const order = song.build?.length ? song.build : ['bass', 'drums', 'chords', 'melody'];
  const rank = Math.max(0, order.indexOf(ctx.role));
  // Count parts that were already playing last phrase, so two parts don't come in together.
  const playing = Object.values(ctx.before || {}).filter((p) => p && p.level > 0 && p.notes.length).length;
  const inNow = last && last.level > 0;
  const ramp = (l) => Math.exp(-((l - (1 + 2 * dir.energy)) ** 2) / 0.9);
  const level = { 1: ramp(1), 2: ramp(2) * 1.3, 3: ramp(3) };
  if (dir.drop === ctx.role) {
    reasons.push({ text: 'direction: drop out', when: (d) => d.level === 0 });
    return { 0: 5, 1: 0.5 };
  }
  if (inNow) {
    level[last.level] *= 1.6; // settle into the part
    level[0] = 0.01;
    return level;
  }
  // Not playing yet: enter once the parts ahead of me are in (or if the wait drags on).
  const ready = playing >= rank;
  const waited = ctx.history.filter((h) => !h.level).length;
  // The first part in the build order always starts alone; later parts can jump the queue a little
  // if the wait drags on, so the order is a tendency, not a script.
  const enter = ready ? 0.75 : rank === 0 ? 1 : playing === 0 ? 0 : Math.min(0.45, 0.04 + 0.06 * waited);
  for (const l of [1, 2, 3]) level[l] *= enter * (l === 1 ? 1.6 : 1); // come in gently
  level[0] = 1 - enter;
  if (ready) reasons.push({ text: `${playing} part${playing === 1 ? ' is' : 's are'} playing → coming in`, when: (d) => d.level > 0 });
  else reasons.push({ text: `waiting for ${rank - playing} more part${rank - playing === 1 ? '' : 's'} before coming in`, when: (d) => d.level === 0 });
  return level;
}
