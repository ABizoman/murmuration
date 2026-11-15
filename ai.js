// AI relays for the signalling server. Keys stay on the laptop; phones only talk to these routes.
//
//   POST /decide  { state, questions }  -> { answers: { id: { option: probability } }, source }
//   POST /direct  { state }             -> { directive, source }
//   POST /instruct { state, questions } -> { answers, source }  (a typed instruction, as choice
//                                          questions: src/ui/interpret.js; Jev, else Gemini)
//
// Environment:
//   JEV_API_KEY        use the real Jev model: a TypeSafe key, or an OpenRouter key (sk-or-...)
//                      (optional JEV_URL and JEV_MODEL to override)
//   GEMINI_API_KEY     use Gemini as the director LLM (optional DIRECTOR_MODEL)
// Without a key, each route answers with a clearly labelled stand-in so the rest of the system
// (deadlines, blending, voting) can be built and demonstrated before API access is sorted out.

import { sanitiseDirective, DIRECTIVE_ROLES } from './src/decide/directive.js';

// A TypeSafe key goes to TypeSafe; an OpenRouter key (sk-or-...) goes to OpenRouter's
// TypeSafe-compatible System One route, which takes the same questions and answers.
const viaOpenRouter = () => (process.env.JEV_API_KEY || '').trim().startsWith('sk-or-');
const jevUrl = () => process.env.JEV_URL || (viaOpenRouter() ? 'https://openrouter.ai/api/v1/systemone' : 'https://api.typesafe.ai/v1/systemone');
const jevModel = () => process.env.JEV_MODEL || (viaOpenRouter() ? 'typesafe/jev-1.14' : 'jev-latest');
// Tried in order; a model that is overloaded (503), rate-limited (429), gone (404) or slow is skipped.
// Free-tier availability changes by the hour, so this is a list. Override: DIRECTOR_MODELS=a,b,c
const DIRECTOR_MODELS = (process.env.DIRECTOR_MODELS || process.env.DIRECTOR_MODEL || 'gemini-3.5-flash-lite,gemini-3-flash-preview,gemini-3.8-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);
const DIRECTOR_MODEL = DIRECTOR_MODELS[0];
const DIRECTOR_TIMEOUT_MS = Number(process.env.DIRECTOR_TIMEOUT_MS) || 12000; // per model

export const aiStatus = () => ({
  jev: process.env.JEV_API_KEY ? `${jevModel()}${viaOpenRouter() ? ' via OpenRouter' : ''}` : 'stand-in',
  director: process.env.GEMINI_API_KEY ? DIRECTOR_MODELS.join(' → ') : 'stand-in',
});

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 4294967296;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- /decide -------------------------------------------------------------------------------

// One answer -> { key: probability } over the question's criteria.
function choiceProbabilities(a, keys) {
  if (!a || typeof a !== 'object') return null;
  if (a.probabilities && typeof a.probabilities === 'object') {
    const out = {};
    for (const k of keys) if (typeof a.probabilities[k] === 'number') out[k] = a.probabilities[k];
    if (Object.keys(out).length) return out;
  }
  if (typeof a.choice === 'string' && keys.includes(a.choice)) {
    // only the winner and a confidence: spread the rest evenly
    const c = typeof a.confidence === 'number' ? Math.min(0.95, Math.max(0.34, a.confidence)) : 0.6;
    return Object.fromEntries(keys.map((k) => [k, k === a.choice ? c : (1 - c) / Math.max(1, keys.length - 1)]));
  }
  return null;
}

// TypeSafe's Jev API: POST /v1/systemone with a Bearer key, { model, state, questions }.
// Choice questions carry their options in `criteria`; answers come back keyed by question name.
async function decideReal(state, questions) {
  const res = await fetch(jevUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.JEV_API_KEY.trim()}` },
    body: JSON.stringify({ model: jevModel(), state, questions }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Jev answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = data.answers && typeof data.answers === 'object' ? data.answers : data;
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const p = choiceProbabilities(raw[id], Object.keys(q.criteria || {}));
    if (p) answers[id] = p;
  }
  if (!Object.keys(answers).length) throw new Error(`Jev answer had no usable probabilities: ${JSON.stringify(data).slice(0, 200)}`);
  return { answers, source: viaOpenRouter() ? 'jev (OpenRouter)' : 'jev' };
}

// Stand-in: NOT a model. It gives every option a repeatable pseudo-random preference that changes
// with the state, leaning slightly toward echo/answer, so you can hear and see the blend working.
async function decideStandIn(state, questions) {
  await sleep(120 + Math.random() * 380); // Jev-like latency
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const w = {};
    for (const key of Object.keys(q.criteria || {})) {
      w[key] = 0.15 + 0.7 * hash(`${state.length}:${state.slice(-400)}:${id}:${key}`);
      if (id.endsWith('|interaction') && key !== 'none') w[key] *= 1.3;
    }
    const total = Object.values(w).reduce((x, y) => x + y, 0) || 1;
    answers[id] = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total]));
  }
  return { answers, source: 'jev stand-in' };
}

// A rejected key (expired, revoked: 401/403) won't start working mid-demo: after the first refusal
// the stand-in answers instead, so the band keeps getting advice and the log stays quiet.
let jevKeyRejected = false;
export async function decide({ state, questions }) {
  if (typeof state !== 'string' || !questions || typeof questions !== 'object') throw new Error('bad request');
  if (process.env.JEV_API_KEY && !jevKeyRejected) {
    try {
      return await decideReal(state.slice(0, 20000), questions);
    } catch (err) {
      if (!/\b(401|403)\b/.test(String(err.message))) throw err;
      jevKeyRejected = true;
      console.log(`  Jev refused the key (${String(err.message).slice(0, 80)}): using the stand-in from now on. Get a new JEV_API_KEY and restart.`);
    }
  }
  return decideStandIn(state, questions);
}

// ---- /direct -------------------------------------------------------------------------------

const DIRECTOR_SYSTEM = `You are the musical director of a small generative band (drums, bass, chords, melody).
Every 4 phrases you set a general direction. The players decide their own notes; you only steer.
Reply with ONLY a JSON object, no other text:
{"energy": number 0-1, "feature": one of "drums","bass","chords","melody" or null, "drop": one of "drums","bass","melody" or null, "pair": {"who": role, "mode": "echo" or "answer", "whom": role} or null, "note": "one short sentence for the screen"}
Shape the piece over time: build, release, contrast with the previous section. Use "drop" rarely. Do not repeat the previous direction.`;

const DIRECTIVE_SCHEMA = {
  type: 'object',
  properties: {
    energy: { type: 'number' },
    feature: { type: 'string', enum: ['drums', 'bass', 'chords', 'melody', 'none'] },
    drop: { type: 'string', enum: ['drums', 'bass', 'melody', 'none'] },
    pair: {
      type: 'object',
      properties: {
        who: { type: 'string', enum: DIRECTIVE_ROLES },
        mode: { type: 'string', enum: ['echo', 'answer'] },
        whom: { type: 'string', enum: DIRECTIVE_ROLES },
      },
    },
    note: { type: 'string' },
  },
  required: ['energy', 'note'],
};

// Text of a Gemini Interactions API answer: the model_output step's content[].text.
export function geminiText(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const out = steps.filter((s) => s.type === 'model_output').flatMap((s) => s.content || []).map((c) => c.text || '').join('');
  return out || (typeof data?.output_text === 'string' ? data.output_text : '');
}

// Gemini through the Interactions API, as in the AI Studio get-started guide.
async function askGemini(model, state) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY.trim(), 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({
      model,
      input: `${DIRECTOR_SYSTEM}\n\n${state.slice(0, 8000)}`,
      response_format: { type: 'text', mime_type: 'application/json', schema: DIRECTIVE_SCHEMA },
      store: false,
    }),
    signal: AbortSignal.timeout(DIRECTOR_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${model} answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const text = geminiText(await res.json());
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const directive = sanitiseDirective(JSON.parse(json));
  if (!directive) throw new Error(`${model} answer was not a usable directive`);
  return directive;
}

const skipUntil = new Map(); // model -> time before which it is not tried again

async function directReal(state) {
  const errors = [];
  const now = Date.now();
  const order = DIRECTOR_MODELS.filter((m) => (skipUntil.get(m) || 0) <= now);
  for (const model of order.length ? order : DIRECTOR_MODELS) {
    try {
      const directive = await askGemini(model, state);
      return { directive, source: model };
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? `${model} timed out` : err.message;
      errors.push(msg);
      skipUntil.set(model, Date.now() + (/ 404|no longer available/.test(msg) ? 3600e3 : 60e3));
    }
  }
  throw new Error(`no Gemini model answered: ${errors.join(' | ')}`);
}

// Stand-in: NOT an LLM. A fixed energy arc with random features, so proposals and voting can be tested.
const ARC = [0.4, 0.6, 0.85, 0.45, 0.7, 0.95, 0.3];
async function directStandIn(state) {
  await sleep(400 + Math.random() * 1200);
  const section = Number(/section (\d+)/.exec(state)?.[1] || 1);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const energy = Math.min(1, Math.max(0, ARC[section % ARC.length] + (Math.random() - 0.5) * 0.15));
  const feature = Math.random() < 0.6 ? pick(DIRECTIVE_ROLES) : null;
  const who = pick(DIRECTIVE_ROLES);
  const whom = pick(DIRECTIVE_ROLES.filter((r) => r !== who));
  const directive = sanitiseDirective({
    energy,
    feature,
    drop: energy < 0.45 && Math.random() < 0.5 ? 'drums' : null,
    pair: Math.random() < 0.7 ? { who, mode: pick(['echo', 'answer']), whom } : null,
    note: energy > 0.75 ? 'Lift it.' : energy < 0.45 ? 'Pull back and leave space.' : 'Keep it moving.',
  });
  return { directive, source: 'director stand-in' };
}

export async function direct({ state }) {
  if (typeof state !== 'string') throw new Error('bad request');
  if (process.env.GEMINI_API_KEY) return directReal(state);
  return directStandIn(state);
}

// ---- /instruct -----------------------------------------------------------------------------
// A typed instruction the rules didn't understand, as choice questions (src/ui/interpret.js).
// Jev answers choice questions natively; Gemini picks one option per question as JSON. No key (or
// both refuse): an error, and the phone says it didn't catch that -- never a random stand-in.
async function instructGemini(state, questions) {
  const ids = Object.keys(questions);
  const schema = { type: 'object', properties: Object.fromEntries(ids.map((id) => [id, { type: 'string', enum: Object.keys(questions[id].criteria) }])), required: ids };
  const lines = ids.map((id) => `${id}: ${questions[id].instructions}\n${Object.entries(questions[id].criteria).map(([k, v]) => `  ${k} = ${v}`).join('\n')}`);
  const input = `${state}\n\nAnswer every question with exactly one option key. Reply with ONLY a JSON object {question: option key}.\n\n${lines.join('\n\n')}`;
  const errors = [];
  for (const model of DIRECTOR_MODELS) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY.trim(), 'Api-Revision': '2026-05-20' },
        body: JSON.stringify({ model, input, response_format: { type: 'text', mime_type: 'application/json', schema }, store: false }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${model} answered ${res.status}`);
      const text = geminiText(await res.json());
      const picked = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const answers = {};
      for (const id of ids) if (picked[id] in questions[id].criteria) answers[id] = { [picked[id]]: 1 };
      if (Object.keys(answers).length) return { answers, source: model };
      throw new Error(`${model}: no usable answer`);
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(`Gemini: ${errors.join(' | ')}`);
}

export async function instruct({ state, questions }) {
  if (typeof state !== 'string' || !questions || typeof questions !== 'object') throw new Error('bad request');
  const errors = [];
  if (process.env.JEV_API_KEY && !jevKeyRejected) {
    try {
      return await decideReal(state.slice(0, 20000), questions);
    } catch (err) {
      errors.push(err.message);
      if (/\b(401|403)\b/.test(String(err.message))) jevKeyRejected = true;
    }
  }
  if (process.env.GEMINI_API_KEY) {
    try {
      return await instructGemini(state.slice(0, 8000), questions);
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.length ? errors.join(' | ').slice(0, 300) : 'no AI key (set JEV_API_KEY or GEMINI_API_KEY)');
}
