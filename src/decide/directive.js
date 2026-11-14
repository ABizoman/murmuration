// A directive is the band's general direction for a section (4 phrases). It only shifts the
// weights in rules.js; it never dictates notes. Shared by the browser and the server.

export const DIRECTIVE_ROLES = ['drums', 'bass', 'chords', 'melody'];
export const DEFAULT_DIRECTIVE = { energy: 0.5, feature: null, drop: null, pair: null, note: '' };

const role = (x) => (DIRECTIVE_ROLES.includes(x) ? x : null);

// Accept anything (an LLM wrote it) and return a safe directive, or null if unusable.
export function sanitiseDirective(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const energy = Number(raw.energy);
  if (!Number.isFinite(energy)) return null;
  let pair = null;
  if (raw.pair && typeof raw.pair === 'object') {
    const who = role(raw.pair.who), whom = role(raw.pair.whom);
    const mode = raw.pair.mode === 'echo' || raw.pair.mode === 'answer' ? raw.pair.mode : null;
    if (who && whom && mode && who !== whom) pair = { who, mode, whom };
  }
  const feature = role(raw.feature);
  let drop = role(raw.drop);
  if (drop === 'chords' || drop === feature) drop = null; // keep the harmony; don't drop the featured part
  return {
    energy: Math.min(1, Math.max(0, energy)),
    feature,
    drop,
    pair,
    note: String(raw.note ?? '').replace(/[<>]/g, '').slice(0, 90),
  };
}

export function describeDirective(d) {
  const bits = [`energy ${Math.round(d.energy * 100)}%`];
  if (d.feature) bits.push(`feature ${d.feature}`);
  if (d.drop) bits.push(`drop ${d.drop}`);
  if (d.pair) bits.push(`${d.pair.who} ${d.pair.mode === 'echo' ? 'echoes' : 'answers'} ${d.pair.whom}`);
  return bits.join(' · ');
}
