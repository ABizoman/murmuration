// Calls Jev and the director through the same code the server uses (ai.js), with the keys in .env.
// Prints what happened to the terminal and to ai-check.log. Never prints the keys.
//   node tools/check-ai.mjs      (or double-click check-ai.command)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { console.log('No .env file found next to server.js'); }
const { decide, direct, aiStatus } = await import(path.join(root, 'ai.js'));

const lines = [];
const say = (s) => { console.log(s); lines.push(s); fs.writeFileSync(path.join(root, 'ai-check.log'), lines.join('\n') + '\n'); };
say(`${new Date().toISOString()}  using: ${JSON.stringify(aiStatus())}`);

const state = 'A small band improvises. Song: A minor, 90 bpm. Last phrase the melody played busily and the bass played sparsely.';
const questions = {
  'bass|level': { type: 'choice', instructions: 'How busy should the bass be in the next phrase?', criteria: { sparse: 'Play sparsely, leaving a lot of space', medium: 'Play at medium density', busy: 'Play busily, with many notes' } },
  'bass|interaction': { type: 'choice', instructions: 'Should the bass react to another part in the next phrase?', criteria: { none: 'Play its own part', echo_drums: 'Echo the drums', answer_melody: 'Answer the melody' } },
};
let t = Date.now();
try { const r = await decide({ state, questions }); say(`Jev OK in ${Date.now() - t} ms (${r.source}): ${JSON.stringify(r.answers)}`); }
catch (e) { say(`Jev FAILED in ${Date.now() - t} ms: ${e.message}`); }

t = Date.now();
try {
  const r = await direct({ state: 'Song: A minor, 90 bpm. You are setting the direction for section 2 (phrases 5-8).\nCurrent direction: energy 50%.\nPhrase 4:\n- drums: medium "boombap" pattern\n- bass: sparse "roots" pattern\n- chords: medium "pad" pattern\n- melody: busy "call" pattern' });
  say(`Director OK in ${Date.now() - t} ms (${r.source}): ${JSON.stringify(r.directive)}`);
} catch (e) { say(`Director FAILED in ${Date.now() - t} ms: ${e.message}`); }
