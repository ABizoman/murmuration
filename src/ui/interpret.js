// Free-text instructions the rules don't understand ("make it feel like a sunset", "funkier") go to
// the AI through the server (POST /instruct). The AI doesn't write a command: it answers six
// multiple-choice questions -- Jev's native format, and easy for Gemini -- and this file turns the
// answers into the same command parseInstruction() makes, so nothing it says can be invalid.
// Pure: no DOM, no fetch.
//
//   target       which part (or this device's parts, the whole band, or the song itself)
//   level        busier / calmer / rest / bring back / no change
//   register     higher / lower / no change
//   instrument   an instrument family (matched to the part's own voices) / no change
//   interaction  echo or answer another part / play on its own / no change
//   song         build up / bring down / spotlight the part / no change

import { ROLES } from '../loops.js';
import { REGISTERS } from '../decide/rules.js';
import { matchVoice, describeCommand } from './instructions.js';

const LABEL = { drums: 'the drums', bass: 'the bass', chords: 'the chords (keys)', melody: 'the melody (lead)', pad: 'the pad', arp: 'the arpeggio', perc: 'the percussion (shaker)' };
export const INSTRUMENTS = ['piano', 'electric piano', 'organ', 'strings', 'choir', 'brass', 'trumpet', 'sax', 'guitar', 'synth', 'pluck', 'acoustic', 'house', 'techno'];

// -> { state, questions, decode }: what to send to /instruct, and how to read the answer.
export function buildInstructQuestions({ text, mine = [], agents = {} }) {
  const now = ROLES.map((r) => `${r}: ${agents[r]?.voice ?? 'not chosen yet'}, level ${agents[r]?.level ?? 2} of 3${mine.includes(r) ? ' (this device plays it)' : ''}`).join('; ');
  const state = `A live band of AI agents (one part per phone) is playing a song. Someone typed this instruction to their agent: "${String(text).slice(0, 200)}". The parts now: ${now}. Interpret the instruction as a musician would: choose what to change. Choose "no change" for anything the instruction doesn't ask for.`;
  const q = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
  const target = { mine: 'the parts this device plays', all: 'every part of the band', song: 'the direction of the whole song (not one part)' };
  for (const r of ROLES) target[r] = LABEL[r];
  const interaction = { none: 'no change', alone: 'stop echoing or answering anyone' };
  for (const mode of ['echo', 'answer']) for (const r of ROLES) interaction[`${mode}_${r}`] = `${mode === 'echo' ? 'echo (copy) the rhythm or tune of' : 'answer (reply to)'} ${LABEL[r]}`;
  const instrument = { same: 'no change' };
  for (const i of INSTRUMENTS) instrument[i.replace(/ /g, '_')] = `switch to ${i}${['acoustic', 'house', 'techno'].includes(i) ? ' drum kit' : ''}`;
  const questions = {
    target: q('Which part is the instruction about?', target),
    level: q('How busy should that part play?', { same: 'no change', busier: 'busier, more notes, more energy', calmer: 'calmer, fewer notes', rest: 'stop playing (rest)', back: 'come back in at a normal level' }),
    register: q('Should that part move up or down in pitch?', { same: 'no change', higher: 'higher, brighter', lower: 'lower, darker' }),
    instrument: q('Should that part change instrument?', instrument),
    interaction: q('Should that part play off another part?', interaction),
    song: q('Should the whole song change direction?', { none: 'no change', build: 'build up, more energy', calm: 'bring it down, calmer, sparser', spotlight: 'put the spotlight on that part' }),
  };
  return { state, questions };
}

const top = (probs) => {
  let best = null, p = -1;
  for (const [k, v] of Object.entries(probs || {})) if (Number.isFinite(v) && v > p) { best = k; p = v; }
  return best;
};

// The AI's answers ({ questionId: { option: probability } }) -> a command, as parseInstruction returns.
export function commandFromAnswers(answers, { agents = {}, mine = [] } = {}) {
  const a = Object.fromEntries(['target', 'level', 'register', 'instrument', 'interaction', 'song'].map((k) => [k, top(answers?.[k])]));
  const roles = a.target === 'all' ? ROLES : a.target === 'mine' ? (mine.length ? mine : ROLES) : ROLES.includes(a.target) ? [a.target] : [];
  const changes = [];
  for (const role of roles) {
    const cur = agents[role] || { level: 2, register: 0 };
    const set = {};
    const lvl = { busier: Math.min(3, Math.max(cur.level ?? 2, 0) + 1), calmer: Math.max(1, Math.min(cur.level ?? 2, 3) - 1), rest: 0, back: 2 }[a.level];
    const step = { higher: 1, lower: -1 }[a.register];
    if (lvl != null || step) {
      const reg = (cur.register || 0) + (step || 0);
      Object.assign(set, { auto: false, level: lvl ?? cur.level ?? 2, register: REGISTERS[role].includes(reg) ? reg : cur.register || 0 });
    }
    if (a.instrument && a.instrument !== 'same') {
      const m = matchVoice(` ${a.instrument.replace(/_/g, ' ')} `, role);
      if (m) set.pinVoice = m.id;
    }
    if (a.interaction === 'alone') set.pinInteraction = null;
    else if (/^(echo|answer)_/.test(a.interaction || '')) {
      const [mode, whom] = a.interaction.split('_');
      if (ROLES.includes(whom) && whom !== role) set.pinInteraction = `${mode}:${whom}`;
    }
    if (Object.keys(set).length) changes.push({ role, set });
  }
  let song = null;
  if (a.song === 'build') song = { energy: 1, feature: null, note: 'Build it up' };
  else if (a.song === 'calm') song = { energy: 0.15, feature: null, note: 'Bring it down' };
  else if (a.song === 'spotlight' && roles.length === 1) song = { energy: 0.75, feature: roles[0], note: `Spotlight on the ${roles[0]}` };
  return describeCommand({ changes, song });
}
