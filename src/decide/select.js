// Final selection: a small statistical model. For each of the four choices, the rule weights are
// multiplied by Jev's probabilities (when they arrived in time), then one option is sampled.
// Sampling rather than taking the top option keeps the music from looping, and the probabilities
// are kept so the screen can show how sure the agent was.

export const QUESTIONS = ['level', 'style', 'register', 'interaction'];
const SHARPEN = 1.4; // >1 makes the likely options more likely
const JEV_FLOOR = 0.03;
// How much Jev's probabilities count against the rules (1 = equal footing). Jev is often 90%+ sure,
// which at full weight makes it the sole decider and the music repetitive.
export const JEV_WEIGHT = 0.6;

export function normalise(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = total > 0 ? v / total : 1 / Object.keys(weights).length;
  return out;
}

export function blend(rule, jev, jevWeight = JEV_WEIGHT) {
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

// scores: from rules.js. advice: { level: {opt: p}, ... } from Jev, or null. pins: { level?, register? } set by hand.
export function decide(scores, advice, pins, random) {
  const d = {}, p = {}, dist = {};
  let usedJev = false;
  for (const q of QUESTIONS) {
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
