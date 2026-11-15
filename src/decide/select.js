// Final selection: a small statistical model. For each of the four choices, the rule weights are
// multiplied by Jev's probabilities (when they arrived in time), then one option is sampled.
// Sampling rather than taking the top option keeps the music from looping, and the probabilities
// are kept so the screen can show how sure the agent was.
//
// Phase 3: instead of playing that one sample, the agent draws several candidate decisions from the
// same distributions (candidateDecisions), renders them, scores them against the band (decide/fit.js)
// and picks one with pickCandidate: likely *and* fitting. The maths lives here so it can be tested
// without an agent.

export const QUESTIONS = ['level', 'style', 'register', 'interaction', 'voice'];
// The instrument is decided once (it only changes at section starts), so it is not searched over.
export const CANDIDATE_QUESTIONS = ['level', 'style', 'register', 'interaction'];
const SHARPEN = 1.4; // >1 makes the likely options more likely
const JEV_FLOOR = 0.03;
export const LAMBDA = 6; // how much the fit counts against the rules' and Jev's opinion
export const TEMPERATURE = 0.35; // softmax temperature: variety, but a strong preference for fit
export const CONTINUITY_BONUS = 0.3; // for carrying on with the same groove, while it is still new
// Per role (step A5): a pop drummer keeps a groove for a section, the melody may move more.
// Given to a candidate that plays exactly the loop this part played last phrase (agent.js).
export const CONTINUITY_BONUS_BY_ROLE = { drums: 0.8, bass: 0.5, chords: 0.4, melody: 0.3 };
// ...for chords and melody only while the pattern has been held fewer phrases than this.
export const CONTINUITY_HOLD = { chords: 3, melody: 3 };
const PRIOR_FLOOR = 1e-6;

export function normalise(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = total > 0 ? v / total : 1 / Object.keys(weights).length;
  return out;
}

export function blend(rule, jev, jevWeight = 1) {
  const keys = Object.keys(rule).filter((k) => rule[k] > 0);
  const w = {};
  const jn = jev ? normalise(Object.fromEntries(keys.map((k) => [k, Math.max(jev[k] ?? 0, JEV_FLOOR)]))) : null;
  for (const k of keys) {
    let v = Math.pow(rule[k], SHARPEN);
    if (jn) v *= Math.pow(jn[k] * keys.length, jevWeight); // uniform Jev answer = no change
    w[k] = v;
  }
  return normalise(w);
}

export function sample(probs, random) {
  let r = random();
  let lastKey = null;
  for (const [k, p] of Object.entries(probs)) {
    lastKey = k;
    if ((r -= p) <= 0) return k;
  }
  return lastKey;
}

const cast = (q, v) => (q === 'level' || q === 'register' ? Number(v) : String(v));
const likeliest = (probs) => Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0];

// Draw up to k distinct candidate decisions from the blended distributions. Always included: the
// most likely option for every question, and (when there is something to carry on from) last
// phrase's level, style and register with its loop preferred. Pins are forced in every candidate.
export function candidateDecisions(dist, base, { pins = null, last = null, prefer = null, k = 6, random = Math.random, tries = 10 } = {}) {
  const out = [];
  const seen = new Set();
  const keyOf = (d) => CANDIDATE_QUESTIONS.map((q) => d[q]).join('|');
  const pin = (q, v) => (pins && pins[q] != null && String(pins[q]) in (dist[q] || {}) ? cast(q, pins[q]) : v);
  // Every candidate prefers the loop we are already playing: library.find() keeps it most of the
  // time, so a candidate changes the *decision* without also swapping pack variant every phrase.
  const add = (d, kind) => {
    const key = keyOf(d);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push({ d, kind, prefer });
    return true;
  };

  const top = { ...base };
  for (const q of CANDIDATE_QUESTIONS) if (dist[q]) top[q] = pin(q, cast(q, likeliest(dist[q])));
  add(top, 'top');

  if (last && last.level > 0) {
    const cont = { ...base };
    for (const q of ['level', 'style', 'register']) {
      if (dist[q] && String(last[q]) in dist[q]) cont[q] = pin(q, cast(q, last[q]));
    }
    add(cont, 'continuity');
  }

  for (let t = 0; out.length < k && t < k + tries; t++) {
    const d = { ...base };
    for (const q of CANDIDATE_QUESTIONS) if (dist[q]) d[q] = pin(q, cast(q, sample(dist[q], random)));
    add(d, 'sampled');
  }
  return out;
}

// How likely the rules and Jev thought this combination was.
export function candidatePrior(d, dist) {
  let p = 1;
  for (const q of CANDIDATE_QUESTIONS) if (dist[q]) p *= dist[q][String(d[q])] ?? PRIOR_FLOOR;
  return Math.max(p, PRIOR_FLOOR);
}

// logit = log(prior) + lambda * fit (+ a bonus), then softmax at a low temperature.
// candidates: [{ d, fit: { total }, bonus? }]. Returns the index chosen and the probabilities.
// `extra` (optional, one number per candidate) multiplies the softmax weights: Jev's ranking (3d).
export function pickCandidate(candidates, { dist, random = Math.random, lambda = LAMBDA, temperature = TEMPERATURE, extra = null } = {}) {
  const logits = candidates.map((c) => Math.log(candidatePrior(c.d, dist)) + lambda * (c.fit?.total ?? 0.5) + (c.bonus || 0));
  const top = Math.max(...logits);
  const weights = logits.map((l, i) => Math.exp((l - top) / temperature) * (extra?.[i] ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const probs = weights.map((w) => w / total);
  let r = random();
  let index = probs.length - 1;
  for (let i = 0; i < probs.length; i++) {
    if ((r -= probs[i]) <= 0) { index = i; break; }
  }
  return { index, probs, logits };
}

// scores: from rules.js. advice: { level: {opt: p}, ... } from Jev, or null. pins: { level?, register? } set by hand.
export function decide(scores, advice, pins, random) {
  const d = {}, p = {}, dist = {};
  let usedJev = false;
  for (const q of QUESTIONS) {
    if (!scores[q] || !Object.keys(scores[q]).length) continue;
    const jev = advice?.[q] && Object.keys(scores[q]).length > 1 ? advice[q] : null;
    dist[q] = blend(scores[q], jev);
    if (jev) usedJev = true;
    let choice;
    if (pins && pins[q] != null && String(pins[q]) in scores[q]) choice = String(pins[q]);
    else choice = sample(dist[q], random);
    d[q] = q === 'level' || q === 'register' ? Number(choice) : choice;
    p[q] = dist[q][choice] ?? 1;
  }
  return { d, p, dist, usedJev };
}

// A candidate's identity: the loop it renders and the decision. Used to match Jev's ranking (3d) to
// candidates that were prepared again after a peer's part arrived.
export const candidateKey = (c) => `${c.loop?.id ?? 'rest'}|${c.d.level}|${c.d.register}|${c.d.interaction}`;

// Jev's probabilities over candidates -> one weight multiplier each: max(p, floor) x K, normalised
// over the candidates Jev ranked (the same floor and normalisation idea as blend()). Candidates Jev
// never saw get 1 (no opinion).
export function jevMultipliers(cands, byKey) {
  if (!byKey) return null;
  const keys = cands.map(candidateKey);
  const seen = keys.filter((k) => Number.isFinite(byKey[k]));
  if (seen.length < 2) return null;
  const total = seen.reduce((a, k) => a + Math.max(byKey[k], JEV_FLOOR), 0);
  return keys.map((k) => (Number.isFinite(byKey[k]) ? (Math.max(byKey[k], JEV_FLOOR) / total) * seen.length : 1));
}
