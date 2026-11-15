// `npm run qa`: a music QA report, in Node, no browser. Runs the whole band for 40 phrases on
// several seeds with a fixed rng (like ?rng= in the browser) and the real pack library, then prints
// the numbers that tell us whether a change helped: how well the parts fit, how often each part
// changes loop and instrument, and how much the melody repeats itself.
//
//   npm run qa                      print the report
//   npm run qa -- --save A          also write it to docs/qa/A.txt, to compare across steps
//   npm run qa -- --seeds a,b,c     other seeds
//   npm run qa -- --phrases 60
//   npm run qa -- --devices 1        one engine plays everything (default: four devices)
//   npm run qa -- --horizons uniform every part decides 1 bar ahead, as before Phase 6

import { writeFileSync, mkdirSync } from 'node:fs';
import { ROLES } from '../src/loops.js';
import { simulateBand, byRole, changes, loopOf, voiceOf, fitStats, ensembleStats, freshStats } from './sim.mjs';
import { STYLE_FAMILIES } from '../src/styles.js';
import { SECTION_PHRASES } from '../src/decide/rules.js';
import { transitionsIn } from '../src/transitions.js';
import { POP_FORM } from '../src/form.js';
import { SONGS } from '../src/songs/index.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const SEEDS = opt('seeds', 'durhack,pop1,pop2,pop3,pop4').split(',');
const PHRASES = Number(opt('phrases', 40));
const RNG = opt('rng', 'qa');
const SAVE = opt('save', null);
// --devices 7 (default): a device per part, gossiping with 60 ms latency, like the demo. --devices 1:
// one engine plays everything. --horizons uniform: every part decides 1 bar ahead (before Phase 6).
const DEVICES = Number(opt('devices', 7));
const UNIFORM = opt('horizons', 'staggered') === 'uniform';

const lines = [];
const out = (s = '') => lines.push(s);
const f2 = (x) => (x == null || Number.isNaN(x) ? '  –  ' : x.toFixed(2));
const pad = (s, n) => String(s).padEnd(n);
const pct = (x) => `${Math.round(x * 100)}%`;
const lpad = (s, n) => String(s).padStart(n);

out(`Murmuration music QA · ${PHRASES} phrases · rng "${RNG}-<seed>" · seeds ${SEEDS.join(', ')}`);
out(`${DEVICES > 1 ? 'a device per part (60 ms gossip)' : 'one device plays everything'} · horizons ${UNIFORM ? 'uniform (1 bar)' : 'staggered (drums + chords 2, bass 1.5, melody 1 bars)'}`);
out(`(loop/voice changes count only consecutive phrases where the part plays in both)`);

const pooled = Object.fromEntries(ROLES.map((r) => [r, { fit: [], loop: [0, 0], voice: [0, 0], terms: {} }]));
let melodyCont = [];
const ensPooled = Object.fromEntries(ROLES.map((r) => [r, { total: [], terms: {}, fresh: {} }]));
const formPooled = { hook: [0, 0], chorusCont: [], fills: [0, 0], crashes: [0, 0], risers: [0, 0], order: true, bad: [] };
const famPooled = { style: [0, 0], voice: [0, 0], worstBoundary: 0, offStyles: {}, offVoices: {} };

for (const seed of SEEDS) {
  const t0 = performance.now();
  // One random stream per seed (like ?rng=<rng>-<seed>), so the seeds are independent runs.
  const { structure, parts, form, directive } = simulateBand({ seed, rng: `${RNG}-${seed}`, phrases: PHRASES, devices: DEVICES, engineOptions: UNIFORM ? { composeAheadBars: 1 } : {} });
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
  // After the fact: each part against what the others really played, and what each decision heard.
  const ens = ensembleStats(series, { structure, directive });
  const fr = freshStats(series);
  for (const r of ROLES) {
    if (ens[r].total != null) ensPooled[r].total.push(ens[r].total);
    for (const [k, v] of Object.entries(ens[r].terms)) (ensPooled[r].terms[k] ||= []).push(v);
    for (const [k, v] of Object.entries(fr[r])) if (v != null) (ensPooled[r].fresh[k] ||= []).push(v);
  }
  // The form: sections in order, the hook in every chorus, transitions at the seams.
  if (form) {
    const at = (p) => directive(p);
    const names = [];
    for (let p = 0; p < PHRASES; p++) { const d = at(p); if (d.ended) break; if (d.isFirstPhrase) names.push(d.section); }
    const part = (r, p) => series[r].find((x) => x.phrase === p)?.part;
    let hookHit = 0, hookAll = 0, fills = 0, fillAll = 0, crashes = 0, crashAll = 0, risers = 0, riserAll = 0;
    const cont = [];
    for (let p = 0; p < PHRASES; p++) {
      const d = at(p);
      const mel = part('melody', p);
      if (d.hook && mel?.notes.length) {
        hookAll++;
        if (/the hook/.test(mel.why) || !mel.why) hookHit++;
        if (!d.isFirstPhrase && mel.fit?.terms?.continuity != null) cont.push(mel.fit.terms.continuity);
      }
      const drums = part('drums', p);
      const tr = drums ? transitionsIn(drums.notes) : { fill: false, crash: false, riser: false };
      if (d.nextTransitionIn.includes('fill') && drums?.notes.some((n) => n.step < 48)) { fillAll++; if (tr.fill) fills++; else formPooled.bad.push(`${seed}: no fill at phrase ${p}`); }
      if (d.transitionIn.includes('crash')) { crashAll++; if (tr.crash) crashes++; else formPooled.bad.push(`${seed}: no crash at phrase ${p}`); }
      if (d.nextTransitionIn.includes('riser')) { riserAll++; if (tr.riser) risers++; else formPooled.bad.push(`${seed}: no riser at phrase ${p}`); }
      if (!d.isFirstPhrase && tr.crash) formPooled.bad.push(`${seed}: crash mid-section at phrase ${p}`);
      if (!d.nextTransitionIn.includes('riser') && tr.riser) formPooled.bad.push(`${seed}: riser in the wrong place at phrase ${p}`);
    }
    // sections in order: as written (the pop form, or the song's own "form"), then round again
    // from the loop point, or (ending songs) one "end" coda and nothing more
    const written = structure.song ? SONGS[structure.song.id].form.map(([name, phrases]) => ({ name, phrases })) : POP_FORM;
    const loopFrom = structure.song ? form.loopIndex : POP_FORM.findIndex((x) => x.name === 'verse2');
    const want = [];
    for (let i = 0, p = 0; p < PHRASES; ) {
      if (i >= written.length) {
        if (form.end) { want.push('end'); break; }
        i = loopFrom;
      }
      want.push(written[i].name); p += written[i].phrases; i++;
    }
    formPooled.order &&= JSON.stringify(names) === JSON.stringify(want);
    // the hook in chorus phrases after the first chorus's first phrase (that one *makes* the hook)
    const firstHook = [...Array(PHRASES).keys()].find((p) => at(p).hook);
    let later = 0, laterHit = 0;
    // a song's hook is written into its sections: compare the notes with the first chorus's
    const tune = (x) => JSON.stringify((x?.notes || []).map((n) => [n.step, n.midi]));
    const firstTune = {};
    for (let p = firstHook; p < PHRASES; p++) if (at(p).hook && part('melody', p)) firstTune[at(p).phraseInSection] ??= tune(part('melody', p));
    for (let p = firstHook + 1; p < PHRASES; p++) {
      const mel = part('melody', p);
      if (!at(p).hook || !mel?.notes.length) continue;
      later++;
      if (structure.song ? tune(mel) === firstTune[at(p).phraseInSection] : /the hook/.test(mel.why)) laterHit++;
    }
    formPooled.hook[0] += laterHit; formPooled.hook[1] += later;
    formPooled.chorusCont.push(...cont);
    formPooled.fills[0] += fills; formPooled.fills[1] += fillAll;
    formPooled.crashes[0] += crashes; formPooled.crashes[1] += crashAll;
    formPooled.risers[0] += risers; formPooled.risers[1] += riserAll;
    out(`form: ${names.join(' ')}`);
    out(`  hook in later chorus phrases ${laterHit}/${later} · chorus melody continuity ${f2(cont.length ? cont.reduce((a, b) => a + b, 0) / cont.length : null)} · fills ${fills}/${fillAll} · crashes ${crashes}/${crashAll} · risers ${risers}/${riserAll}`);
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
out('ensemble (each part scored afterwards against what the others actually played that phrase):');
for (const r of ROLES) {
  const E = ensPooled[r];
  const terms = Object.entries(E.terms).map(([k, v]) => `${k} ${f2(avg(v))}`).join(', ');
  const fresh = Object.entries(E.fresh).map(([k, v]) => `${k} ${pct(avg(v))}`).join(', ');
  out(`  ${pad(r, 8)}${lpad(f2(avg(E.total)), 6)}  ${terms} · heard same-phrase: ${fresh}`);
}
out(`  band ${f2(avg(ROLES.flatMap((r) => ensPooled[r].total)))}`);
if (formPooled.hook[1] || formPooled.fills[1]) {
  const c = formPooled.chorusCont;
  out(`form: sections in order ${formPooled.order ? 'yes' : 'NO'} · hook in later chorus phrases ${pct(formPooled.hook[0] / (formPooled.hook[1] || 1))} · chorus melody continuity ${f2(c.length ? c.reduce((a, b) => a + b, 0) / c.length : null)} · fills ${formPooled.fills[0]}/${formPooled.fills[1]} · crashes ${formPooled.crashes[0]}/${formPooled.crashes[1]} · risers ${formPooled.risers[0]}/${formPooled.risers[1]}`);
  if (formPooled.bad.length) out(`  problems: ${formPooled.bad.slice(0, 8).join('; ')}`);
}
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
