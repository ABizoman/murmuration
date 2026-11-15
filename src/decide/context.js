import { voiceById } from '../voices.js';

// The shared score, as one agent sees it when deciding its next phrase.
// Everything an agent knows comes from parts that were announced (its own or gossiped), so a
// device that takes a part over continues from what the previous player did.

export function summarise(part, role, phrase) {
  if (!part || part.pending) return null;
  const notes = part.notes || [];
  const pitches = notes.flatMap((n) => n.midis || (n.midi != null ? [n.midi] : []));
  const onsets = new Array(64).fill(0);
  for (const n of notes) if (n.step >= 0 && n.step < 64) onsets[n.step] = 1;
  const d = part.d || {};
  return {
    role,
    phrase,
    by: part.by ?? null,
    level: d.level ?? (notes.length ? 2 : 0),
    style: d.style ?? null,
    register: d.register ?? 0,
    interaction: d.interaction ?? 'none',
    voice: d.voice ?? null,
    voiceSince: Number.isInteger(d.voiceSince) ? d.voiceSince : null, // the phrase this instrument started
    density: notes.length / 4, // notes per bar
    meanPitch: pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : null,
    onsets,
    notes,
  };
}

// lookup(phrase, role) -> part or null
export function buildContext({ role, phrase, structure, roles, lookup, directive, prevDirective = null, hookEntry = null }) {
  const peers = {};
  for (const r of roles) {
    if (r === role) continue;
    peers[r] = summarise(lookup(phrase, r), r, phrase) || summarise(lookup(phrase - 1, r), r, phrase - 1);
  }
  const history = [1, 2, 3, 4].map((k) => summarise(lookup(phrase - k, role), role, phrase - k)).filter(Boolean);
  // What the others played last phrase only (not what they just decided for this one).
  const before = {};
  for (const r of roles) if (r !== role) before[r] = summarise(lookup(phrase - 1, r), r, phrase - 1);
  // Hook sections (form.js): fit.js aims for near-identical continuity, agent.js pins the hook loop.
  const hook = !!directive?.hook;
  return { role, phrase, structure, peers, before, last: history[0] || null, history, directive, prevDirective, hook, section: directive?.section ?? null, hookEntry };
}

// 16 characters per bar: x = something starts on that 16th, . = nothing.
export const rhythmString = (s) =>
  [0, 1, 2, 3].map((b) => s.onsets.slice(b * 16, b * 16 + 16).map((v) => (v ? 'x' : '.')).join('')).join('|');

const LEVEL_NAMES = ['resting', 'sparse', 'medium', 'busy'];
const REG_NAMES = { '-1': 'low', 0: 'middle', 1: 'high' };

export function describePart(s) {
  if (!s) return 'unknown';
  if (!s.level || !s.notes.length) return 'resting';
  const inter = s.interaction && s.interaction !== 'none' ? `, ${s.interaction.replace(':', 'ing the ')}` : '';
  const on = s.voice && voiceById[s.voice] ? ` on ${voiceById[s.voice].label}` : '';
  return `${LEVEL_NAMES[s.level]} "${s.style}" pattern${on}, ${REG_NAMES[s.register] ?? 'middle'} register${inter}, rhythm ${rhythmString(s)}`;
}
