// `npm run qa`: a music QA report, in Node, no browser. Runs the whole band for 40 phrases on
// several seeds with a fixed rng (like ?rng= in the browser) and the real pack library, then prints
// the numbers that tell us whether a change helped: how well the parts fit, how often each part
// changes loop and instrument, and how much the melody repeats itself.
//
//   npm run qa                      print the report
//   npm run qa -- --save A          also write it to docs/qa/A.txt, to compare across steps
//   npm run qa -- --seeds a,b,c     other seeds
//   npm run qa -- --phrases 60

import { writeFileSync, mkdirSync } from 'node:fs';
import { ROLES } from '../src/loops.js';
import { simulateBand, byRole, changes, loopOf, voiceOf, fitStats } from './sim.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const SEEDS = opt('seeds', 'durhack,pop1,pop2,pop3,pop4').split(',');
const PHRASES = Number(opt('phrases', 40));
const RNG = opt('rng', 'qa');
const SAVE = opt('save', null);

const lines = [];
const out = (s = '') => lines.push(s);
const f2 = (x) => (x == null || Number.isNaN(x) ? '  –  ' : x.toFixed(2));
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

out(`Murmuration music QA · ${PHRASES} phrases · rng "${RNG}" · seeds ${SEEDS.join(', ')}`);
out(`(loop/voice changes count only consecutive phrases where the part plays in both)`);

const pooled = Object.fromEntries(ROLES.map((r) => [r, { fit: [], loop: [0, 0], voice: [0, 0], terms: {} }]));
let melodyCont = [];

for (const seed of SEEDS) {
  const t0 = performance.now();
  const { structure, parts } = simulateBand({ seed, rng: RNG, phrases: PHRASES });
  const ms = performance.now() - t0;
  const series = byRole(parts);
  out();
  out(`== ${seed}: ${structure.key} ${structure.mode} · ${structure.bpm} bpm · ${structure.progression.join(' ')}${structure.swing ? ` · swing ${structure.swing}` : ''} (${Math.round(ms)} ms)`);
  out(`${pad('role', 8)}${lpad('fit', 6)}  ${pad('loop changes', 14)}${pad('voice changes', 15)}terms`);
  for (const r of ROLES) {
    const s = series[r];
    const fit = fitStats(s);
    const lc = changes(s, loopOf);
    const vc = changes(s, voiceOf);
    const P = pooled[r];
    P.fit.push(fit.total);
    P.loop[0] += lc.changed; P.loop[1] += lc.pairs;
    P.voice[0] += vc.changed; P.voice[1] += vc.pairs;
    for (const [k, v] of Object.entries(fit.terms)) (P.terms[k] ||= []).push(v);
    if (r === 'melody' && fit.terms.continuity != null) melodyCont.push(fit.terms.continuity);
    const terms = Object.entries(fit.terms).map(([k, v]) => `${k} ${f2(v)}`).join(', ');
    out(`${pad(r, 8)}${lpad(f2(fit.total), 6)}  ${pad(`${lc.changed}/${lc.pairs}`, 14)}${pad(`${vc.changed}/${vc.pairs}`, 15)}${terms}`);
  }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
out();
out(`== all seeds`);
out(`${pad('role', 8)}${lpad('fit', 6)}  ${pad('loop changes', 14)}${pad('voice changes', 15)}terms`);
for (const r of ROLES) {
  const P = pooled[r];
  const terms = Object.entries(P.terms).map(([k, v]) => `${k} ${f2(avg(v))}`).join(', ');
  out(`${pad(r, 8)}${lpad(f2(avg(P.fit)), 6)}  ${pad(`${P.loop[0]}/${P.loop[1]}`, 14)}${pad(`${P.voice[0]}/${P.voice[1]}`, 15)}${terms}`);
}
out(`band fit ${f2(avg(ROLES.flatMap((r) => pooled[r].fit)))} · melody continuity ${f2(avg(melodyCont))}`);

const text = lines.join('\n');
console.log(text);
if (SAVE) {
  mkdirSync(new URL('../docs/qa/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../docs/qa/${SAVE}.txt`, import.meta.url), text + '\n');
  console.log(`\nsaved docs/qa/${SAVE}.txt`);
}
