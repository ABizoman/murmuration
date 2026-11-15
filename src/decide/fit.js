// Does this part actually fit the band? (Phase 3 of docs/MUSIC_QUALITY_PLAN.md)
//
// Until now an agent chose from *summaries* of what the others played (level, mean pitch, density)
// and then played a loop without ever comparing the resulting notes to anything. fitScore() looks
// at the notes themselves: the chords underneath, what the other parts are playing, and what this
// part played last phrase. Every term is 0..1 (1 = good) and the total is their weighted mean, so
// an agent can render several candidate parts and play the one that fits best (see agent.js).
//
// A peer's part counts fully when it is for the phrase being decided and half when it is last
// phrase's (all we have until Phase 6 staggers the decisions).
//
// Pure: no clock, no randomness, no Tone. Everything comes from the arguments.

import { chordAt } from '../render.js';
import { familyOf } from '../styles.js';

export const WEIGHTS = { harmony: 3, bassRoot: 2, clash: 3, register: 2, rhythm: 1.5, shape: 1.5, continuity: 1, drums: 2 };

// Which terms each role is judged on.
export const TERMS = {
  drums: ['rhythm', 'continuity', 'drums'],
  bass: ['harmony', 'bassRoot', 'clash', 'register', 'rhythm', 'shape', 'continuity'],
  chords: ['clash', 'register', 'rhythm', 'continuity'],
  melody: ['harmony', 'clash', 'register', 'rhythm', 'shape', 'continuity'],
};

// How much a position in the bar matters.
export const metric = (step) => {
  const s = ((step % 16) + 16) % 16;
  return s === 0 ? 1 : s === 8 ? 0.8 : s === 4 || s === 12 ? 0.6 : s % 2 === 0 ? 0.35 : 0.2;
};

const PITCHED = ['bass', 'chords', 'melody'];
const SNARE = new Set(['snare', 'clap', 'rim']);
const TOM = new Set(['tom1', 'tom2', 'tom3']);
const WEAK = 0.35; // a step this unimportant can carry a passing note

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pitches = (n) => (Array.isArray(n.midis) ? n.midis : Number.isFinite(n.midi) ? [n.midi] : []);
const pc = (m) => ((m % 12) + 12) % 12;
const barOf = (n) => Math.floor(n.step / 16);
const byStep = (a, b) => a.step - b.step;
const fresh = (peer, ctx) => (peer && peer.phrase === ctx?.phrase ? 1 : 0.5);
const line = (notes) => notes.filter((n) => pitches(n).length).sort(byStep);

export function onsets(notes, pick = () => true) {
  const a = new Array(64).fill(0);
  for (const n of notes) if (pick(n) && n.step >= 0 && n.step < 64) a[n.step] = 1;
  return a;
}

export function jaccard(a, b) {
  let both = 0, either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either ? both / either : null;
}

// 1 inside the target window, falling off linearly outside it.
export const inRange = ([lo, hi], x, slope = 0.3) =>
  x >= lo && x <= hi ? 1 : Math.max(0, 1 - (x < lo ? lo - x : x - hi) / slope);

const percentile = (sorted, q) => sorted[clamp(Math.round(q * (sorted.length - 1)), 0, sorted.length - 1)];

// Where a part sits: the 10th to 90th percentile of its pitches, plus its mean.
export function spread(notes) {
  const p = notes.flatMap(pitches).sort((a, b) => a - b);
  if (!p.length) return null;
  return { lo: percentile(p, 0.1), hi: percentile(p, 0.9), mean: p.reduce((a, b) => a + b, 0) / p.length };
}

// --- the terms --------------------------------------------------------------------------------

// Share of note weight (duration x metric strength) that lands on a chord tone. A non-chord tone on
// a weak step counts too if it steps into a chord tone: that is a passing or neighbour note.
function harmony(notes, structure, phrase) {
  const l = line(notes);
  if (!l.length) return null;
  let good = 0, total = 0;
  for (const [i, n] of l.entries()) {
    const tones = chordAt(structure, phrase, barOf(n)).pcs;
    const w = Math.max(0.25, n.dur) * metric(n.step);
    total += w;
    if (pitches(n).some((m) => tones.includes(pc(m)))) { good += w; continue; }
    const next = l[i + 1];
    if (!next || metric(n.step) > WEAK) continue;
    const nextTones = chordAt(structure, phrase, barOf(next)).pcs;
    const resolves = pitches(next).some((m) => nextTones.includes(pc(m)));
    const stepwise = pitches(n).some((m) => pitches(next).some((o) => Math.abs(m - o) <= 2));
    if (resolves && stepwise) good += w;
  }
  return total ? good / total : null;
}

// Share of bars that start on the root (the fifth gets half credit). Bars the bass sits out don't
// count either way; a bar whose first note is late or wrong does.
function bassRoot(notes, structure, phrase) {
  let bars = 0, credit = 0;
  for (let bar = 0; bar < 4; bar++) {
    const inBar = line(notes).filter((n) => barOf(n) === bar);
    if (!inBar.length) continue;
    bars++;
    if (inBar[0].step % 16 > 2) continue;
    const chord = chordAt(structure, phrase, bar);
    const p = pc(pitches(inBar[0])[0]);
    if (p === chord.pcs[0]) credit += 1;
    else if (p === chord.pcs[2]) credit += 0.5;
  }
  return bars ? credit / bars : null;
}

// Semitones and major sevenths (interval class 1) between notes that sound at the same time, by
// how long they overlap and how strong the beat is. A tritone involving the bass counts half.
//
// One exception the plan does not spell out but the music demands: two notes that both belong to
// the chord are harmony, not a clash. A seventh chord voiced against its own root is interval
// class 1 (F major 7 over an F bass) and sounds like pop, not like a mistake. Without this, a pad
// in four parts is punished for every bar it plays and no candidate can escape it, because all the
// candidates at one register share the same voicing.
function clash(notes, ctx, structure, phrase) {
  const mine = line(notes);
  if (!mine.length) return null;
  let weight = 0, compared = false;
  const tonesAt = (step) => {
    const chord = chordAt(structure, phrase, Math.floor(step / 16));
    return [...chord.pcs, chord.seventhPc];
  };
  for (const r of PITCHED) {
    if (r === ctx.role) continue;
    const peer = ctx.peers?.[r];
    const theirs = peer?.notes?.length ? line(peer.notes) : [];
    if (!theirs.length) continue;
    compared = true;
    const w = fresh(peer, ctx);
    const bass = r === 'bass' || ctx.role === 'bass';
    for (const a of mine) {
      for (const b of theirs) {
        const overlap = Math.min(a.step + a.dur, b.step + b.dur) - Math.max(a.step, b.step);
        if (overlap < 1) continue;
        const m = Math.max(metric(a.step), metric(b.step));
        const tones = tonesAt(Math.max(a.step, b.step));
        for (const pa of pitches(a)) {
          for (const pb of pitches(b)) {
            const d = Math.abs(pa - pb) % 12;
            const ic = Math.min(d, 12 - d);
            if (ic !== 1 && !(ic === 6 && bass)) continue;
            if (tones.includes(pc(pa)) && tones.includes(pc(pb))) continue; // both in the chord
            weight += overlap * m * w * (ic === 1 ? 1 : 0.5);
          }
        }
      }
    }
  }
  return compared ? 1 - Math.min(1, weight / 4) : null;
}

// Parts should own their own range. Overlapping by up to a minor third is fine; past that it costs.
// Two hard rules (the bass under the chords, the melody over them) fail the term outright.
function register(notes, ctx) {
  const mine = spread(notes);
  if (!mine) return null;
  let penalty = 0, w = 0, broken = false;
  for (const r of PITCHED) {
    if (r === ctx.role) continue;
    const peer = ctx.peers?.[r];
    const theirs = peer?.notes?.length ? spread(peer.notes) : null;
    if (!theirs) continue;
    const f = fresh(peer, ctx);
    const overlap = Math.min(mine.hi, theirs.hi) - Math.max(mine.lo, theirs.lo);
    penalty += f * clamp((overlap - 3) / 12, 0, 1);
    w += f;
    // The two hard rules, whichever side of the pair is being scored.
    const pair = { [ctx.role]: mine, [r]: theirs };
    if (pair.bass && pair.chords && pair.bass.hi > pair.chords.lo + 2) broken = true; // bass under the chords
    if (pair.melody && pair.chords && pair.melody.mean < pair.chords.mean + 3) broken = true; // melody over them
  }
  if (!w) return null;
  return broken ? 0 : 1 - penalty / w;
}

const RHYTHM_TARGET = {
  'bass|drums': [0.5, 0.9], 'drums|bass': [0.5, 0.9], // the bass and the kick lock in
  'melody|chords': [0.1, 0.4], 'chords|melody': [0.1, 0.4],
  'melody|bass': [0.1, 0.5], 'bass|melody': [0.1, 0.5],
};
const KICK = (n) => n.drum === 'kick';

// How much this part's onsets coincide with each other part's. Echoing or answering someone moves
// the target for that part: an echo should land together, an answer should stay out of the way.
function rhythm(notes, ctx, d) {
  if (!notes.length) return null;
  let sum = 0, w = 0;
  for (const [r, peer] of Object.entries(ctx.peers || {})) {
    if (r === ctx.role || !peer?.notes?.length) continue;
    const kickPair = (ctx.role === 'bass' && r === 'drums') || (ctx.role === 'drums' && r === 'bass');
    const mine = onsets(notes, kickPair && ctx.role === 'drums' ? KICK : undefined);
    const theirs = onsets(peer.notes, kickPair && r === 'drums' ? KICK : undefined);
    const j = jaccard(mine, theirs);
    if (j == null) continue;
    let target = RHYTHM_TARGET[`${ctx.role}|${r}`] || [0.1, 0.6];
    if (d?.interaction === `answer:${r}`) target = [0, 0.25];
    else if (d?.interaction === `echo:${r}`) target = [0.6, 1];
    const f = fresh(peer, ctx);
    sum += f * inRange(target, j);
    w += f;
  }
  return w ? sum / w : null;
}

// A singable line: not too many big leaps, not stuck on one note, and mostly stepwise.
function shape(notes, role) {
  const l = line(notes).map((n) => pitches(n)[0]);
  if (l.length < 3) return null;
  let leaps = 0, steps = 0, stuck = 0, run = 1;
  for (let i = 1; i < l.length; i++) {
    const d = Math.abs(l[i] - l[i - 1]);
    if (d > 7 && d !== 12) leaps++;
    if (d > 0 && d <= 2) steps++;
    if (d === 0) { if (++run > 4) stuck++; } else run = 1;
  }
  const n = l.length - 1;
  const range = Math.max(...l) - Math.min(...l);
  const share = steps / n;
  let score = 1;
  score -= Math.min(0.5, (leaps / n) * 1.5);
  score -= Math.min(0.3, stuck * 0.1);
  if (role === 'melody' && range > 19) score -= Math.min(0.3, (range - 19) / 24);
  score -= Math.min(0.3, 0.75 * (share < 0.4 ? 0.4 - share : share > 0.8 ? share - 0.8 : 0));
  return clamp(score, 0, 1);
}

const contour = (notes) => {
  const l = line(notes).map((n) => pitches(n)[0]);
  return l.slice(1).map((m, i) => Math.sign(m - l[i]));
};

// How similar to my own last phrase each role should be. A melody should vary; a pop drummer
// repeats the groove exactly, and the bass and chords mostly do (step A5: an identical drum
// phrase used to score 0.17 here, which made the drums swap loop every other phrase).
export const CONTINUITY_TARGET = { drums: [0.8, 1], bass: [0.5, 0.9], chords: [0.5, 0.9], melody: [0.4, 0.75] };

// How alike two parts are: half rhythm, half melodic shape (just rhythm for drums).
export function similarity(notes, ref) {
  const rhythmSim = jaccard(onsets(notes), onsets(ref)) ?? 0;
  const a = contour(notes), b = contour(ref);
  if (!a.length || !b.length) return rhythmSim;
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
  return 0.5 * rhythmSim + 0.5 * (same / Math.max(a.length, b.length));
}

// Similar to my own last phrase, but (for the melody) not identical. In a verse, with the chorus
// hook known (ctx.hookRef: the hook rendered over this phrase), the melody should also be related
// to the hook without copying it, so the verse leads somewhere.
function continuity(notes, ctx) {
  if (!notes.length) return null;
  // The first phrase of a form section (form.js) is meant to change: it is not judged against the
  // last phrase. (A hook section's first phrase plays the hook, which is its own reference.)
  if (ctx.directive?.isFirstPhrase && ctx.directive.section) return null;
  const last = ctx.last || ctx.history?.[0] || null;
  const target = familyOf(ctx.structure)?.continuity?.[ctx.role] ?? CONTINUITY_TARGET[ctx.role] ?? CONTINUITY_TARGET.melody;
  const own = last?.notes?.length ? inRange(ctx.hook ? [0.9, 1] : target, similarity(notes, last.notes)) : null;
  if (!ctx.hook && ctx.hookRef?.length) {
    const toHook = inRange(HOOK_RELATION, similarity(notes, ctx.hookRef));
    return own == null ? toHook : 0.5 * own + 0.5 * toHook;
  }
  return own;
}
export const HOOK_RELATION = [0.4, 0.7]; // a verse melody vs the chorus hook

// Drummer's job: lock the kick to the bass, keep a backbeat once there is any weight, and save
// the fills for the end of the phrase.
function drums(notes, ctx, d) {
  if (!notes.length) return null;
  const parts = [];
  const kicks = notes.filter(KICK).map((n) => n.step);
  const bass = ctx.peers?.bass;
  if (kicks.length && bass?.notes?.length && fresh(bass, ctx) === 1) {
    const steps = new Set(bass.notes.map((n) => n.step));
    const hit = kicks.filter((s) => steps.has(s) || steps.has(s - 1) || steps.has(s + 1)).length;
    parts.push(Math.min(1, hit / kicks.length / 0.5));
  }
  const bars = [0, 1, 2, 3].filter((b) => notes.some((n) => barOf(n) === b));
  if ((d?.level ?? 2) >= 2 && bars.length) {
    const back = bars.filter((b) => notes.some((n) => barOf(n) === b && SNARE.has(n.drum) && (n.step % 16 === 4 || n.step % 16 === 12)));
    parts.push(back.length / bars.length);
  }
  const fills = bars.filter((b) => notes.filter((n) => barOf(n) === b && (SNARE.has(n.drum) || TOM.has(n.drum))).length >= 6);
  if (fills.length) parts.push(fills.every((b) => b === 3) ? 1 : 0.4);
  return mean(parts);
}

// --- the score ---------------------------------------------------------------------------------

// notes: the candidate part. ctx: from decide/context.js. d: the candidate's decision (its
// interaction and level change what counts as a good fit).
export function fitScore(notes, { role, ctx, structure = ctx?.structure, phrase = ctx?.phrase, d = null } = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const want = TERMS[role] || [];
  const terms = {};
  const put = (name, value) => {
    if (want.includes(name) && value != null && Number.isFinite(value)) terms[name] = clamp(value, 0, 1);
  };
  put('harmony', harmony(list, structure, phrase));
  put('bassRoot', bassRoot(list, structure, phrase));
  put('clash', clash(list, ctx, structure, phrase));
  put('register', register(list, ctx));
  put('rhythm', rhythm(list, ctx, d));
  put('shape', shape(list, role));
  put('continuity', continuity(list, ctx));
  put('drums', drums(list, ctx, d));
  let num = 0, den = 0;
  for (const [k, v] of Object.entries(terms)) {
    num += WEIGHTS[k] * v;
    den += WEIGHTS[k];
  }
  return { total: den ? num / den : 0.5, terms };
}

// A short phrase for the screen, e.g. "best of 6: on the chords 94%, no clashes".
export function describeFit(fit, candidates) {
  if (!fit || !candidates) return '';
  const pct = (x) => `${Math.round(x * 100)}%`;
  const t = fit.terms || {};
  const bits = [];
  if (t.harmony != null) bits.push(`on the chords ${pct(t.harmony)}`);
  if (t.clash != null) bits.push(t.clash > 0.95 ? 'no clashes' : `some clash (${pct(1 - t.clash)})`);
  if (t.drums != null) bits.push(`with the bass ${pct(t.drums)}`);
  if (t.register != null && t.register < 0.5) bits.push('crowded register');
  if (t.rhythm != null && !bits.length) bits.push(`rhythm fits ${pct(t.rhythm)}`);
  if (!bits.length) bits.push(`fit ${pct(fit.total)}`);
  return `best of ${candidates}: ${bits.slice(0, 2).join(', ')}`;
}
