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
import { STYLE_FAMILIES } from '../src/styles.js';
import { SECTION_PHRASES } from '../src/decide/rules.js';

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
const pct = (x) => `${Math.round(x * 100)}%`;
const lpad = (s, n) => String(s).padStart(n);

out(`Murmuration music QA · ${PHRASES} phrases · rng "${RNG}-<seed>" · seeds ${SEEDS.join(', ')}`);
out(`(loop/voice changes count only consecutive phrases where the part plays in both)`);

const pooled = Object.fromEntries(ROLES.map((r) => [r, { fit: [], loop: [0, 0], voice: [0, 0], terms: {} }]));
let melodyCont = [];
const famPooled = { style: [0, 0], voice: [0, 0], worstBoundary: 0, offStyles: {}, offVoices: {} };

for (const seed of SEEDS) {
  const t0 = performance.now();
  // One random stream per seed (like ?rng=<rng>-<seed>), so the seeds are independent runs.
  const { structure, parts } = simulateBand({ seed, rng: `${RNG}-${seed}`, phrases: PHRASES });
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
  // Style family: how much of what played is on the family's lists, and instrument changes per
  // section boundary (at most one part should change at a time).
  const fam = STYLE_FAMILIES[structure.family];
  if (fam) {
    let inStyle = 0, inVoice = 0, n = 0;
    for (const r of ROLES) for (const x of series[r]) {
      if (!x.part.notes.length) continue;
      n++;
      const st = x.part.d.style, vo = x.part.d.voice;
      if (fam.styles[r]?.[st] != null) inStyle++; else famPooled.offStyles[`${r}:${st}`] = (famPooled.offStyles[`${r}:${st}`] || 0) + 1;
      if (fam.voices[r]?.[vo] != null) inVoice++; else famPooled.offVoices[`${r}:${vo}`] = (famPooled.offVoices[`${r}:${vo}`] || 0) + 1;
    }
    famPooled.style[0] += inStyle; famPooled.style[1] += n;
    famPooled.voice[0] += inVoice; famPooled.voice[1] += n;
    const voiceAt = (r, p) => series[r].find((x) => x.phrase === p)?.part.d.voice;
    const perBoundary = [];
    for (let p = SECTION_PHRASES; p < PHRASES; p += SECTION_PHRASES)
      perBoundary.push(ROLES.filter((r) => voiceAt(r, p - 1) && voiceAt(r, p) && voiceAt(r, p - 1) !== voiceAt(r, p)).length);
    famPooled.worstBoundary = Math.max(famPooled.worstBoundary, ...perBoundary);
    out(`family ${structure.family}: styles on the list ${pct(inStyle / n)}, instruments ${pct(inVoice / n)} · instrument changes per section start: ${perBoundary.join(' ')}`);
    out(`instruments: ${ROLES.map((r) => `${r} ${[...new Set(series[r].map((x) => x.part.d.voice))].join('/')}`).join(' · ')}`);
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
if (famPooled.style[1]) {
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  out(`family: styles on the list ${pct(famPooled.style[0] / famPooled.style[1])}, instruments ${pct(famPooled.voice[0] / famPooled.voice[1])} of playing phrases · most instrument changes at one section start: ${famPooled.worstBoundary}`);
  out(`  off-list styles: ${top(famPooled.offStyles)} · off-list instruments: ${top(famPooled.offVoices)}`);
}

const text = lines.join('\n');
console.log(text);
if (SAVE) {
  mkdirSync(new URL('../docs/qa/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../docs/qa/${SAVE}.txt`, import.meta.url), text + '\n');
  console.log(`\nsaved docs/qa/${SAVE}.txt`);
}
