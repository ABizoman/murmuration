// Turns a typed instruction ("less drums", "go higher", "play it on piano", "melody answer the
// bass", "build it up") into a command. Rule-based, so it works offline. Pure: no DOM, testable.
//
// A command is { changes: [{ role, set }], song, stop, understood, summary }:
//   set   what to pin on that part's agent: auto (false = level/register pinned), level, register,
//         pinVoice (an instrument id, or null), pinInteraction ('echo:<role>' / 'answer:<role>', or null)
//   song  a change of direction for the whole band: { energy, feature, note } (director.js votes on it)
// main.js applies a command on this device and gossips it, so the device playing a part obeys,
// whoever typed it (applyChanges below). Anything the rules don't understand can go to the AI
// (src/ui/interpret.js), which answers in the same shape.

import { REGISTERS } from '../decide/rules.js';
import { VOICES, voiceById } from '../voices.js';

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
// Where a part is first mentioned (for "the melody answers the bass": who comes first).
const firstAt = (t, role) => Math.min(...ROLE_WORDS[role].map((w) => { const i = t.indexOf(` ${w} `); return i < 0 ? Infinity : i; }));

// ---- instruments ------------------------------------------------------------------------------
// Words people use for instruments -> words in the voices' labels and ids (voices.js).
const SYNONYMS = { saxophone: 'sax', rhodes: 'electric piano', epiano: 'electric piano', wurlitzer: 'electric piano', violin: 'string', violins: 'string', strings: 'string', orchestra: 'string', horns: 'brass', synthesizer: 'synth', synths: 'synth', electronic: 'synth', real: 'acoustic', vocals: 'choir', voices: 'choir', singing: 'choir', guitars: 'guitar', keyboard: 'piano', machine: 'linndrum' };
// label/id words that name the part, not the instrument, so "the bass" never means "a bass voice"
const NOT_INSTRUMENT = new Set(['kit', 'section', 'ensemble', 'aahs', 'oohs', 'bass', 'drums', 'drum', 'keys', 'melody', 'pad', 'arp', 'perc', 'and']);
const words = (str) => String(str).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const voiceWords = (v) => new Set([...words(v.label), ...words(v.id)].map(stem).filter((w) => !NOT_INSTRUMENT.has(w)));
const INSTRUMENT_NAMES = new Set(['piano', 'keys', 'strings']);
const CHANGE_WORDS = ['on', 'switch', 'change', 'use', 'make', 'with', 'sound like', 'into', 'swap', 'turn', 'as a', 'as an', 'instead', 'instrument', 'try', 'to a', 'to an', 'to'];

// The voice of `role` that best matches the instrument words in t (no match: null).
export function matchVoice(t, role) {
  const said = new Set(words(t).flatMap((w) => [stem(w), ...words(SYNONYMS[w] ?? '')]));
  let best = null, bestScore = 0;
  for (const v of VOICES[role] || []) {
    let score = 0;
    for (const w of voiceWords(v)) if (said.has(w)) score += 1;
    if (score > bestScore || (score > 0 && score === bestScore && (v.weight ?? 1) > (best.weight ?? 1))) { best = v; bestScore = score; }
  }
  return best ? { id: best.id, label: best.label, score: bestScore } : null;
}

// ---- pairings and the whole song ----------------------------------------------------------------
const SONG_UP = ['build up', 'build it up', 'go big', 'big finish', 'climax', 'peak', 'hype', 'hype it up', 'turn it up', 'lift it', 'take it higher', 'more energy', 'energy up', 'pump it up', 'party', 'go off'];
const SONG_DOWN = ['bring it down', 'wind down', 'wind it down', 'tone it down', 'breakdown', 'break it down', 'take it down', 'energy down', 'cool it', 'mellow', 'strip it back', 'strip back', 'chill out', 'less energy'];
const FEATURE = ['feature', 'spotlight', 'solo', 'focus on', 'show off', 'highlight', 'lead with'];
const ECHO = ['echo', 'echoes', 'copy', 'copies', 'follow', 'follows', 'mirror', 'mirrors', 'imitate', 'imitates'];
const ANSWER = ['answer', 'answers', 'reply', 'replies', 'respond', 'responds', 'talk to', 'call and response', 'conversation'];
const ALONE = ['stop echoing', 'stop copying', 'stop answering', 'stop following', 'stops echoing', 'stops copying', 'stops answering', 'stops following', 'no echo', 'on its own', 'on their own', 'independent', 'do its own thing'];
const NEXT_VOICE = ['different instrument', 'another instrument', 'new instrument', 'change instrument', 'change the instrument', 'switch instrument', 'other instrument', 'different sound', 'new sound'];

// text: what the user typed. agents: { role: { auto, level, register } }. mine: roles this device plays.
// An agent on auto writes its decided level and register back onto itself, so agents[role].level is
// what that part is playing now: "less" and "more" step from there.
// Returns { changes: [{ role, set }], stop, understood, summary }.
export function parseInstruction(text, agents, mine = []) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let named = ROLES.filter((r) => has(t, ROLE_WORDS[r])).sort((a, b) => firstAt(t, a) - firstAt(t, b));
  // "switch the chords to strings", "arp on e-piano": a part named only by an instrument word
  // (piano, keys, strings) is the instrument, not a second part
  if (named.length > 1 && has(t, CHANGE_WORDS)) {
    const byInstrument = (r) => ROLE_WORDS[r].filter((w) => has(t, [w])).every((w) => INSTRUMENT_NAMES.has(w));
    const kept = named.filter((r) => !byInstrument(r));
    if (kept.length) named = kept;
  }
  const everyone = has(t, ['everything', 'everyone', 'all', 'band', 'whole band']);
  const targets = named.length ? named : everyone ? ROLES : mine.length ? mine : ROLES;
  const extra = extras(t, named, targets, agents, mine);

  if (!named.length && !extra.alone && has(t, ['stop', 'pause', 'silence', 'leave'])) {
    return { changes: [], song: null, stop: true, understood: true, summary: 'Stopping.' };
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

  // An instrument, a pairing or a song-level change: a bare part name doesn't also mean "play it"
  // ("melody answer the bass" is not "play the melody", "strings" is not "play the pad").
  const special = extra.voices.length || extra.pairs.length || extra.alone || extra.song;
  if (extra.alone) level = null; // "stop echoing" is not "stop playing"
  if (special && !auto && register === null && level && !has(t, LEVEL_WORDS)) level = null;

  if (!auto && level === null && register === null && !special) {
    return { changes: [], song: null, stop: false, understood: false, summary: 'I didn\u2019t catch that. Try \u201Cbusier\u201D, \u201Ctake out the drums\u201D, \u201Cplay it on piano\u201D, \u201Cmelody answer the bass\u201D or \u201Cbuild it up\u201D.' };
  }
  if (!auto && level === null && register === null) return finish([], extra);

  const changes = targets.map((role) => {
    const a = agents[role] || { auto: true, level: 2, register: 0 };
    if (auto) return { role, set: { auto: true, pinVoice: null, pinInteraction: null } };
    const set = { auto: false, level: a.level, register: a.register };
    if (level) set.level = level(a.level);
    if (register !== null) {
      const allowed = REGISTERS[role];
      const wanted = (a.register || 0) + register;
      set.register = allowed.includes(wanted) ? wanted : allowed.includes(register) ? register : a.register;
    }
    return { role, set };
  });

  return finish(changes, extra, register);
}

// Every word the level rules react to: if none was said, a part name alone doesn't change levels.
const LEVEL_WORDS = ['some', 'bit', 'little', 'less', 'fewer', 'quieter', 'calm', 'calmer', 'softer', 'simpler', 'sparser', 'gentle', 'chill', 'down a notch',
  'drop', 'mute', 'remove', 'kill', 'without', 'take out', 'cut', 'no', 'break', 'rest', 'stop', 'sit out', 'bring back', 'back in', 'come back', 'back', 'return',
  'more', 'busier', 'louder', 'build', 'intense', 'harder', 'add', 'energy', 'faster', 'crazier', 'go off', 'steady', 'medium', 'normal'];

// Instruments, pairings and song-level changes in the text.
function extras(t, named, targets, agents, mine) {
  const out = { voices: [], pairs: [], alone: false, aloneRoles: [], song: null };
  // "melody answer the bass": the first part named does it to the second
  if (has(t, ALONE)) {
    out.alone = true;
    out.aloneRoles = named.length ? [named[0]] : targets; // "the melody stops copying the bass": the melody
  } else if ((has(t, ECHO) || has(t, ANSWER)) && named.length >= 2) {
    out.pairs.push({ who: named[0], mode: has(t, ANSWER) ? 'answer' : 'echo', whom: named[1] });
  }
  // an instrument: "play it on piano", "switch the chords to strings", "different instrument"
  if (has(t, NEXT_VOICE)) {
    for (const role of named.length ? named : targets) {
      const list = VOICES[role] || [];
      const cur = agents[role]?.pinVoice || agents[role]?.voice;
      const next = list[(list.findIndex((v) => v.id === cur) + 1) % list.length];
      if (next) out.voices.push({ role, id: next.id, label: next.label });
    }
  } else {
    const changing = has(t, CHANGE_WORDS);
    // which parts could take the instrument: the ones named, else mine first, then the rest
    const pool = named.length ? named : [...mine, ...ROLES.filter((r) => !mine.includes(r))];
    let best = null;
    for (const role of pool) {
      const m = matchVoice(t, role);
      if (!m) continue;
      // a word that is also the part's own name ("piano" = chords, "strings" = pad) only counts with
      // a change word ("play it on piano"), or when it names an instrument of another part
      if (named.length && !changing && named.includes(role) && m.score < 2) continue;
      if (named.length) out.voices.push({ role, id: m.id, label: m.label });
      else if (!best || m.score > best.score) best = { role, ...m };
    }
    if (best && (changing || !named.length)) out.voices.push({ role: best.role, id: best.id, label: best.label });
  }
  // the whole song
  const feature = has(t, FEATURE) && named.length ? named[0] : null;
  if (feature) out.song = { energy: 0.75, feature, note: `Spotlight on the ${feature}` };
  else if (!named.length && has(t, SONG_UP)) out.song = { energy: 1, feature: null, note: 'Build it up' };
  else if (!named.length && has(t, SONG_DOWN)) out.song = { energy: 0.15, feature: null, note: 'Bring it down' };
  return out;
}

// Merge the level/register changes with the extras into one command, and describe it.
function finish(changes, extra, register = null) {
  const byRole = new Map(changes.map((c) => [c.role, c]));
  const at = (role) => {
    if (!byRole.has(role)) byRole.set(role, { role, set: {} });
    return byRole.get(role);
  };
  for (const v of extra.voices) at(v.role).set.pinVoice = v.id;
  for (const p of extra.pairs) at(p.who).set.pinInteraction = `${p.mode}:${p.whom}`;
  for (const r of extra.aloneRoles) at(r).set.pinInteraction = null;
  const all = [...byRole.values()].filter((c) => Object.keys(c.set).length);
  return describeCommand({ changes: all, song: extra.song }, register);
}

// { changes, song } -> the full command, with a one-line summary ("melody: on Trumpet · the band:
// building up"); not understood if it changes nothing. Also used for the AI's answers.
export function describeCommand({ changes: all = [], song = null }, register = null) {
  const bits = all.map(({ role, set }) => {
    if (set.auto) return `${role}: deciding for itself`;
    const out = [];
    if (set.level != null) {
      const reg = set.register > 0 ? ', high' : set.register < 0 ? ', low' : '';
      const stuck = register !== null && REGISTERS[role].length === 1 ? ' (no register to move)' : '';
      out.push(`${LEVEL_NAMES[set.level]}${reg}${stuck}`);
    }
    if (set.pinVoice) out.push(`on ${voiceById[set.pinVoice]?.label ?? set.pinVoice}`);
    if (set.pinInteraction) out.push(set.pinInteraction.replace('echo:', 'echoes the ').replace('answer:', 'answers the '));
    else if ('pinInteraction' in set) out.push('on its own');
    return `${role}: ${out.join(', ')}`;
  });
  if (song) bits.push(`the band: ${song.feature ? `spotlight on the ${song.feature}` : song.energy > 0.5 ? 'building up' : 'bringing it down'}`);
  if (!bits.length) return { changes: [], song: null, stop: false, understood: false, summary: 'I didn’t catch that.' };
  return { changes: all, song, stop: false, understood: true, summary: bits.join(' · ') };
}

// A command from another device or from the AI: keep only what is valid.
export function sanitiseCommand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const changes = [];
  for (const c of Array.isArray(raw.changes) ? raw.changes.slice(0, ROLES.length) : []) {
    if (!c || !ROLES.includes(c.role) || !c.set || typeof c.set !== 'object') continue;
    const set = {};
    if (c.set.auto === true) set.auto = true;
    if (c.set.auto === false && Number.isInteger(c.set.level) && c.set.level >= 0 && c.set.level <= 3 && REGISTERS[c.role].includes(c.set.register)) {
      Object.assign(set, { auto: false, level: c.set.level, register: c.set.register });
    }
    if (c.set.pinVoice === null || (typeof c.set.pinVoice === 'string' && (VOICES[c.role] || []).some((v) => v.id === c.set.pinVoice))) set.pinVoice = c.set.pinVoice;
    if (c.set.pinInteraction === null) set.pinInteraction = null;
    else if (typeof c.set.pinInteraction === 'string') {
      const [mode, whom] = c.set.pinInteraction.split(':');
      if ((mode === 'echo' || mode === 'answer') && ROLES.includes(whom) && whom !== c.role) set.pinInteraction = `${mode}:${whom}`;
    }
    if (Object.keys(set).length) changes.push({ role: c.role, set });
  }
  let song = null;
  if (raw.song && typeof raw.song === 'object' && Number.isFinite(Number(raw.song.energy))) {
    song = { energy: Math.min(1, Math.max(0, Number(raw.song.energy))), feature: ROLES.includes(raw.song.feature) ? raw.song.feature : null, note: String(raw.song.note ?? '').replace(/[<>]/g, '').slice(0, 60) };
  }
  return { changes, song, text: String(raw.text ?? '').replace(/[<>]/g, '').slice(0, 120), summary: String(raw.summary ?? '').replace(/[<>]/g, '').slice(0, 200) };
}

// Apply a command's part changes to a set of agents ({ role: agent }). Every device applies every
// command to its own copy of each agent: the one playing the part obeys, and a device that takes
// the part over later already knows what was asked.
export function applyChanges(changes, agents) {
  for (const { role, set } of changes || []) if (agents[role]) Object.assign(agents[role], set);
}
