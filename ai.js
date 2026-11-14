// AI relays for the signalling server. Keys stay on the laptop; phones only talk to these routes.
//
//   POST /decide  { state, questions }  -> { answers: { id: probability }, source }
//   POST /direct  { state }             -> { directive, source }
//
// Environment:
//   JEV_API_KEY        use the real Jev model (optional JEV_URL, default TypeSafe's endpoint)
//   GEMINI_API_KEY     use Gemini as the director LLM (optional DIRECTOR_MODEL)
// Without a key, each route answers with a clearly labelled stand-in so the rest of the system
// (deadlines, blending, voting) can be built and demonstrated before API access is sorted out.

import { sanitiseDirective, DIRECTIVE_ROLES } from './src/decide/directive.js';

const JEV_URL = process.env.JEV_URL || 'https://api.typesafe.ai/v1/systemone';
const DIRECTOR_MODEL = process.env.DIRECTOR_MODEL || 'gemini-3.8-flash';

export const aiStatus = () => ({
  jev: process.env.JEV_API_KEY ? 'jev' : 'stand-in',
  director: process.env.GEMINI_API_KEY ? DIRECTOR_MODEL : 'stand-in',
});

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 4294967296;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- /decide -------------------------------------------------------------------------------

// Jev answers can be a bare number, a boolean, or an object: accept the common shapes.
function probability(a) {
  if (typeof a === 'number') return a;
  if (typeof a === 'boolean') return a ? 0.9 : 0.1;
  if (a && typeof a === 'object') {
    for (const k of ['probability', 'p', 'score', 'value', 'answer']) {
      if (typeof a[k] === 'number') return a[k];
      if (typeof a[k] === 'boolean') return a[k] ? 0.9 : 0.1;
    }
  }
  return null;
}

async function decideReal(state, questions) {
  // NOTE: written from public descriptions of the API (state + named typed questions in,
  // answers keyed by question name out). Check the field names against TypeSafe's docs with
  // your first real key: only this function needs to change.
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.JEV_API_KEY}` },
    body: JSON.stringify({ state, questions }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Jev answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const answers = {};
  for (const [id, a] of Object.entries(data.answers || {})) {
    const p = probability(a);
    if (p != null) answers[id] = p;
  }
  if (!Object.keys(answers).length) throw new Error('Jev answer had no usable probabilities');
  return { answers, source: 'jev' };
}

// Stand-in: NOT a model. It gives every option a repeatable pseudo-random preference that changes
// with the state, leaning slightly toward echo/answer, so you can hear and see the blend working.
async function decideStandIn(state, questions) {
  await sleep(120 + Math.random() * 380); // Jev-like latency
  const answers = {};
  for (const id of Object.keys(questions)) {
    const [, q, opt] = id.split('|');
    let p = 0.15 + 0.7 * hash(`${state.length}:${state.slice(-400)}:${id}`);
    if (q === 'interaction' && opt !== 'none') p = Math.min(0.95, p * 1.3);
    answers[id] = p;
  }
  return { answers, source: 'jev stand-in' };
}

export async function decide({ state, questions }) {
  if (typeof state !== 'string' || !questions || typeof questions !== 'object') throw new Error('bad request');
  if (process.env.JEV_API_KEY) return decideReal(state.slice(0, 20000), questions);
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
async function directReal(state) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({
      model: DIRECTOR_MODEL,
      input: `${DIRECTOR_SYSTEM}\n\n${state.slice(0, 8000)}`,
      response_format: { type: 'text', mime_type: 'application/json', schema: DIRECTIVE_SCHEMA },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = geminiText(await res.json());
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const directive = sanitiseDirective(JSON.parse(json));
  if (!directive) throw new Error('Gemini answer was not a usable directive');
  return { directive, source: DIRECTOR_MODEL };
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
