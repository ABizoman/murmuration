// Offline decision rules. For each of the four choices an agent makes per phrase
// (how busy, which pattern, which register, echo/answer someone), the rules give every option
// a weight from what the other parts did. No network needed: this always works.
//
// Returns { level, style, register, interaction, reasons } where each of the four is
// { option: weight } and reasons are short notes for the screen, each with a test for
// whether the final decision actually followed it.

import { DEFAULT_DIRECTIVE } from './directive.js';

export const ENTRY = { chords: 0, drums: 1, bass: 1, melody: 2 }; // song phrase each role enters at
export const REGISTERS = { drums: [0], bass: [0, 1], chords: [-1, 0, 1], melody: [-1, 0, 1] };
const CENTRE = { bass: 40, chords: 64, melody: 74 }; // typical mean pitch at register 0
const REGISTER_PRIOR = { bass: { 0: 1.5, 1: 0.35 }, chords: { '-1': 0.8, 0: 1.5, 1: 0.6 }, melody: { '-1': 0.45, 0: 1.5, 1: 1 } };
const STYLE_ENERGY = { 'drums/boombap': 0.4, 'drums/four': 0.75, 'bass/roots': 0.35, 'bass/pulse': 0.75, 'chords/pad': 0.3, 'chords/stabs': 0.7 };

// Who naturally imitates or responds to whom.
const AFFINITY = {
  drums: { 'echo:bass': 0.8, 'answer:melody': 0.35 },
  bass: { 'echo:drums': 0.8, 'answer:melody': 0.5, 'echo:melody': 0.3 },
  chords: { 'answer:melody': 0.6, 'echo:melody': 0.4, 'echo:bass': 0.4 },
  melody: { 'answer:bass': 0.6, 'answer:chords': 0.5, 'echo:bass': 0.5, 'answer:drums': 0.2 },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const runLength = (history, key) => {
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
  if (ctx.phrase < ENTRY[role]) {
    level = { 0: 1 };
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
    level[0] = ctx.phrase >= ENTRY[role] + 2 && last?.level > 0 && role !== 'chords' ? 0.03 : 0; // a rare breath
  }

  // ---- 2. Which pattern ---------------------------------------------------------
  const style = {};
  for (const s of library.styles(role)) {
    const e = STYLE_ENERGY[`${role}/${s}`] ?? 0.5;
    style[s] = Math.exp(-((e - dir.energy) ** 2) / 0.12);
  }
  if (last?.style && last.style in style) {
    const held = runLength(history, 'style');
    style[last.style] *= held < 2 ? 3 : held >= 4 ? 0.5 : 1.2;
  }

  // ---- 3. Which register --------------------------------------------------------
  const register = {};
  for (const r of REGISTERS[role]) {
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
  for (const [opt, affinity] of Object.entries(AFFINITY[role] || {})) {
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

  return { level, style, register, interaction, reasons };
}
