// Turns a typed instruction ("less drums", "go higher", "let it decide") into changes to this
// device's agents. Rule-based, so it works offline. Pure: no DOM, testable in Node.
//
// An instruction only pins an agent's level (how busy) and register (how high). Pattern choice and
// echo/answer stay with the agent's own decision rules.

import { REGISTERS } from '../decide/rules.js';

export const LEVEL_NAMES = ['resting', 'sparse', 'medium', 'busy'];
const ROLES = ['drums', 'bass', 'chords', 'melody', 'pad', 'arp', 'perc'];

const ROLE_WORDS = {
  drums: ['drum', 'drums', 'beat', 'beats', 'kick', 'snare', 'hats', 'hihat', 'groove'],
  bass: ['bass', 'bassline', 'low end'],
  chords: ['chord', 'chords', 'keys', 'harmony', 'piano'],
  melody: ['melody', 'lead', 'tune', 'topline', 'top line'],
  pad: ['pad', 'pads', 'strings', 'atmosphere'],
  arp: ['arp', 'arpeggio', 'arpeggios', 'sparkle'],
  perc: ['perc', 'shaker', 'tambourine', 'shakers'],
};

const has = (t, words) => words.some((w) => t.includes(` ${w} `));

// text: what the user typed. agents: { role: { auto, level, register } }. mine: roles this device plays.
// An agent on auto writes its decided level and register back onto itself, so agents[role].level is
// what that part is playing now: "less" and "more" step from there.
// Returns { changes: [{ role, set }], stop, understood, summary }.
export function parseInstruction(text, agents, mine = []) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const named = ROLES.filter((r) => has(t, ROLE_WORDS[r]));
  const everyone = has(t, ['everything', 'everyone', 'all', 'band', 'whole band']);
  const targets = named.length ? named : everyone ? ROLES : mine.length ? mine : ROLES;

  if (!named.length && has(t, ['stop', 'pause', 'silence', 'leave'])) {
    return { changes: [], stop: true, understood: true, summary: 'Stopping.' };
  }

  let level = null;
  let register = null;
  let auto = false;

  if (has(t, ['let it decide', 'your call', 'decide', 'auto', 'free', 'improvise', 'surprise me', 'up to you'])) auto = true;
  else if (has(t, ['some', 'bit', 'little', 'less', 'fewer', 'quieter', 'calm', 'calmer', 'softer', 'simpler', 'sparser', 'gentle', 'chill', 'down a notch'])) level = (l) => Math.max(1, Math.min(l, 3) - 1);
  else if (has(t, ['drop', 'mute', 'remove', 'kill', 'without', 'take out', 'cut', 'no', 'break', 'rest', 'stop', 'sit out'])) level = () => 0;
  else if (has(t, ['bring back', 'back in', 'come back', 'back', 'return'])) level = () => 2;
  else if (has(t, ['more', 'busier', 'louder', 'build', 'intense', 'harder', 'add', 'energy', 'faster', 'crazier', 'go off'])) level = (l) => Math.min(3, Math.max(l, 0) + 1);
  else if (has(t, ['steady', 'medium', 'normal', 'chill out'])) level = () => 2;

  if (has(t, ['higher', 'high', 'up an octave', 'brighter'])) register = 1;
  else if (has(t, ['lower', 'deeper', 'darker', 'down an octave'])) register = -1;

  // A bare role name ("melody") means "play it".
  if (!auto && level === null && register === null && named.length) level = () => 2;

  if (!auto && level === null && register === null) {
    return { changes: [], stop: false, understood: false, summary: 'I didn\u2019t catch that. Try \u201Cbusier\u201D, \u201Ctake out the drums\u201D, \u201Cgo higher\u201D or \u201Clet it decide\u201D.' };
  }

  const changes = targets.map((role) => {
    const a = agents[role] || { auto: true, level: 2, register: 0 };
    if (auto) return { role, set: { auto: true } };
    const set = { auto: false, level: a.level, register: a.register };
    if (level) set.level = level(a.level);
    if (register !== null) {
      const allowed = REGISTERS[role];
      const wanted = (a.register || 0) + register;
      set.register = allowed.includes(wanted) ? wanted : allowed.includes(register) ? register : a.register;
    }
    return { role, set };
  });

  const bits = changes.map(({ role, set }) => {
    if (set.auto) return `${role}: deciding for itself`;
    const reg = set.register > 0 ? ', high' : set.register < 0 ? ', low' : '';
    const stuck = register !== null && REGISTERS[role].length === 1 ? ' (no register to move)' : '';
    return `${role}: ${LEVEL_NAMES[set.level]}${reg}${stuck}`;
  });
  return { changes, stop: false, understood: true, summary: bits.join(' \u00B7 ') };
}