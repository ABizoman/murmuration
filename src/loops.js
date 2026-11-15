// Loop library, written relative to the chord so every loop fits any key and chord.
//
// Loop shape:
// {
//   id, role: 'drums'|'bass'|'chords'|'melody', style, density: 'sparse'|'medium'|'busy',
//   bars: 1|2|4|8,
//   voicing: 3|4               (chords only: triad or seventh chord)
//   events: [{ bar, step, dur, vel, deg?, oct?, drum? }]
//     deg: scale degree relative to the chord root (see theory.js), pitched roles only
//     acc: optional semitone offset from that degree, for notes outside the chord and scale
//     drum: 'kick'|'snare'|'hat'|'ohat'
//     chords events have no deg: the voicing is worked out from the chord
// }
//
// Imported MIDI pack loops are converted into this same shape (midi-import.js).

export const ROLES = ['drums', 'bass', 'chords', 'melody'];
export const DENSITIES = ['sparse', 'medium', 'busy'];

// [bar, step, dur, deg, vel]
const P = (rows) => rows.map(([bar, step, dur, deg, vel = 0.75]) => ({ bar, step, dur, deg, vel }));
// [bar, step, dur, vel]
const R = (rows) => rows.map(([bar, step, dur, vel = 0.7]) => ({ bar, step, dur, vel }));
// { kick: [steps], ... } for one bar, optional extra bar-3 fill
function D(hits, { soft = [], bars = 1, fill = null } = {}) {
  const ev = [];
  for (let bar = 0; bar < bars; bar++) {
    const h = bar === bars - 1 && fill ? { ...hits, ...fill } : hits;
    for (const [drum, steps] of Object.entries(h))
      for (const step of steps) ev.push({ bar, step, dur: 1, drum, vel: soft.includes(step) && drum === 'hat' ? 0.45 : 0.85 });
  }
  return ev;
}
const all16 = [...Array(16).keys()];
const eighths = [0, 2, 4, 6, 8, 10, 12, 14];

const L = [];
const add = (role, style, density, bars, events, extra = {}) =>
  L.push({ id: `${role}/${style}/${density}`, role, style, density, bars, events, ...extra });

// --- Drums ------------------------------------------------------------------
add('drums', 'boombap', 'sparse', 1, D({ kick: [0, 10], hat: [0, 4, 8, 12] }));
add('drums', 'boombap', 'medium', 1, D({ kick: [0, 10], snare: [4, 12], hat: eighths }, { soft: [2, 6, 10, 14] }));
add('drums', 'boombap', 'busy', 4,
  D({ kick: [0, 7, 10], snare: [4, 12], hat: all16 }, { soft: all16.filter((s) => s % 2), bars: 4, fill: { snare: [4, 12, 14, 15], kick: [0, 7, 10] } }));

add('drums', 'four', 'sparse', 1, D({ kick: [0, 4, 8, 12] }));
add('drums', 'four', 'medium', 1, D({ kick: [0, 4, 8, 12], snare: [4, 12], ohat: [2, 6, 10, 14] }));
add('drums', 'four', 'busy', 1, D({ kick: [0, 4, 8, 12], snare: [4, 12], ohat: [2, 6, 10, 14], hat: [1, 3, 5, 7, 9, 11, 13, 15] }, { soft: all16 }));

// --- Bass -------------------------------------------------------------------
add('bass', 'roots', 'sparse', 1, P([[0, 0, 14, 0, 0.85]]));
add('bass', 'roots', 'medium', 1, P([[0, 0, 6, 0, 0.9], [0, 8, 4, 0, 0.7], [0, 12, 3, 4, 0.7]]));
add('bass', 'roots', 'busy', 1, P([[0, 0, 3, 0, 0.9], [0, 3, 2, 0, 0.6], [0, 6, 2, 7, 0.7], [0, 8, 3, 0, 0.85], [0, 11, 2, 4, 0.7], [0, 14, 2, -1, 0.6]]));

add('bass', 'pulse', 'sparse', 1, P([[0, 0, 3, 0, 0.85], [0, 8, 3, 0, 0.7]]));
add('bass', 'pulse', 'medium', 1, P(eighths.map((s, i) => [0, s, 1, 0, i % 2 ? 0.55 : 0.85])));
add('bass', 'pulse', 'busy', 1, P(eighths.map((s, i) => [0, s, 1, [0, 7, 0, 7, 0, 7, 4, 2][i], i % 2 ? 0.6 : 0.9])));

// --- Chords -----------------------------------------------------------------
add('chords', 'pad', 'sparse', 1, R([[0, 0, 16, 0.5]]), { voicing: 4 });
add('chords', 'pad', 'medium', 1, R([[0, 0, 8, 0.6], [0, 8, 8, 0.45]]), { voicing: 4 });
add('chords', 'pad', 'busy', 1, R([[0, 0, 6, 0.6], [0, 6, 4, 0.45], [0, 10, 6, 0.55]]), { voicing: 4 });

add('chords', 'stabs', 'sparse', 1, R([[0, 0, 3, 0.75]]), { voicing: 3 });
add('chords', 'stabs', 'medium', 1, R([[0, 0, 3, 0.8], [0, 6, 2, 0.6], [0, 10, 3, 0.7]]), { voicing: 3 });
add('chords', 'stabs', 'busy', 1, R([[0, 0, 2, 0.8], [0, 3, 2, 0.55], [0, 6, 2, 0.7], [0, 10, 2, 0.6], [0, 14, 2, 0.5]]), { voicing: 3 });

// --- Melody (4 bars: question in bars 0-1, answer in bars 2-3) ---------------
add('melody', 'motif', 'sparse', 4, P([
  [0, 0, 6, 4], [0, 8, 6, 2],
  [1, 0, 8, 2],
  [2, 0, 6, 4], [2, 8, 6, 7],
  [3, 0, 12, 4],
]));
add('melody', 'motif', 'medium', 4, P([
  [0, 0, 3, 4], [0, 3, 1, 3, 0.55], [0, 4, 4, 2], [0, 10, 4, 0],
  [1, 0, 3, 2], [1, 4, 2, 4, 0.6], [1, 8, 6, 4],
  [2, 0, 3, 4], [2, 3, 1, 5, 0.55], [2, 4, 4, 7], [2, 10, 4, 4],
  [3, 0, 6, 2], [3, 8, 6, 0],
]));
add('melody', 'motif', 'busy', 4, P([
  ...[0, 2, 4, 7, 4, 2, 4, 5].map((d, i) => [0, i * 2, 2, d, i % 2 ? 0.55 : 0.75]),
  ...[7, 4, 2, 4, 7, 9, 7, 4].map((d, i) => [1, i * 2, 2, d, i % 2 ? 0.55 : 0.75]),
  ...[0, 2, 4, 7, 9, 7, 4, 2].map((d, i) => [2, i * 2, 2, d, i % 2 ? 0.55 : 0.75]),
  [3, 0, 2, 4], [3, 2, 2, 2, 0.6], [3, 4, 10, 0],
]));

add('melody', 'call', 'sparse', 4, P([
  [0, 0, 4, 4], [0, 6, 6, 2],
  [2, 0, 4, 2], [2, 6, 6, 0],
]));
add('melody', 'call', 'medium', 4, P([
  [0, 0, 2, 4], [0, 2, 2, 2, 0.6], [0, 4, 6, 4],
  [1, 8, 4, 2], [1, 12, 4, 1, 0.55],
  [2, 0, 2, 2], [2, 2, 2, 0, 0.6], [2, 4, 6, 2],
  [3, 8, 8, 0],
]));
add('melody', 'call', 'busy', 4, P([
  [0, 0, 1, 4], [0, 2, 1, 5, 0.5], [0, 3, 1, 4, 0.6], [0, 4, 2, 2], [0, 6, 2, 4, 0.6], [0, 8, 4, 7], [0, 12, 2, 4, 0.6], [0, 14, 2, 2, 0.55],
  [1, 0, 6, 4], [1, 8, 2, 2], [1, 10, 2, 1, 0.5], [1, 12, 4, 0],
  [2, 0, 1, 2], [2, 2, 1, 3, 0.5], [2, 3, 1, 2, 0.6], [2, 4, 2, 0], [2, 6, 2, 2, 0.6], [2, 8, 4, 4], [2, 12, 4, 2, 0.6],
  [3, 0, 12, 0],
]));

export function createLibrary({ packs = [], builtins = true } = {}) {
  const loops = [...(builtins ? L : []), ...packs];
  const byStyle = (role, style) => loops.filter((l) => l.role === role && l.style === style);
  return {
    loops,
    add(loop) {
      validateLoop(loop);
      loops.push(loop);
    },
    styles: (role) => [...new Set(loops.filter((l) => l.role === role).map((l) => l.style))],
    get: (id) => loops.find((l) => l.id === id) || null, // the exact loop, for hooks
    // Average energy of a style's loops (pack loops carry one), or null.
    styleEnergy(role, style) {
      const e = byStyle(role, style).map((l) => l.energy).filter((x) => typeof x === 'number');
      return e.length ? e.reduce((a, b) => a + b, 0) / e.length : null;
    },
    styleWeight: (role, style) => byStyle(role, style)[0]?.weight ?? 1,
    // A loop of this style at (or near) this density. Packs have many variants: keep `prefer`
    // most of the time so a part doesn't change groove every phrase, otherwise pick one at random.
    find(role, style, density, { random = Math.random, prefer = null } = {}) {
      const same = byStyle(role, style);
      if (!same.length) return null;
      const dist = (l) => Math.abs(DENSITIES.indexOf(l.density) - DENSITIES.indexOf(density));
      const best = Math.min(...same.map(dist));
      const cands = same.filter((l) => dist(l) === best);
      const kept = cands.find((l) => l.id === prefer);
      if (kept && random() < 0.75) return kept;
      return cands[Math.floor(random() * cands.length)];
    },
  };
}

export function validateLoop(l) {
  const bad = [];
  if (!ROLES.includes(l.role)) bad.push(`role ${l.role}`);
  if (!DENSITIES.includes(l.density)) bad.push(`density ${l.density}`);
  if (![1, 2, 4, 8].includes(l.bars)) bad.push(`bars ${l.bars}`);
  if (!l.events?.length) bad.push('no events');
  for (const e of l.events || [])
    if (e.bar < 0 || e.bar >= l.bars || e.step < 0 || e.step > 15 || !(e.dur > 0)) {
      bad.push(`event out of range ${JSON.stringify(e)}`);
      break;
    }
  if (bad.length) throw new Error(`invalid loop ${l.id}: ${bad.join(', ')}`);
}
