// Step E (Phase 7) of docs/MUSIC_QUALITY_HANDOFF.md: songs with sections, the two demo songs and
// the demo preset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileSong } from '../src/songs/format.js';
import { SONGS } from '../src/songs/index.js';
import { structureFromSeed } from '../src/seed.js';
import { chordAt, renderPhrase } from '../src/render.js';
import { formFromStructure, sectionAt, formDirective } from '../src/form.js';
import { ROLES } from '../src/loops.js';
import { simulateBand, byRole } from '../tools/sim.mjs';

const tiny = (extra = {}) => ({
  id: 'tiny', title: 'Tiny', key: 'C', mode: 'major', bpm: 120,
  sections: {
    a: { progression: ['I', 'V', 'vi', 'IV'], parts: { melody: 'C4:4 D4:4 E4:4 G4:4', drums: { kick: 'x...x...x...x...' } } },
    b: { progression: ['vi', 'IV', 'I', 'V'], hook: true, parts: { melody: 'A4:8 G4:8', bass: 'A2:16', chords: 'x:8 x:8', drums: { kick: 'x...x...x...x...' } } },
  },
  form: [['a', 1], ['b', 2]],
  ...extra,
});

test('sections compile to one style per section; a missing role rests; errors stay helpful', () => {
  const song = compileSong(tiny());
  const styles = new Set(song.loops.map((l) => l.style));
  assert.deepEqual([...styles].sort(), ['song-tiny-a', 'song-tiny-b']);
  assert.ok(!song.loops.some((l) => l.style === 'song-tiny-a' && l.role === 'bass'), 'no bass in section a');
  assert.deepEqual(song.progression, ['I', 'V', 'vi', 'IV'], 'defaults to the first section');
  // every density of a section part is the part as written (no thinning)
  const mel = song.loops.filter((l) => l.style === 'song-tiny-b' && l.role === 'melody');
  assert.equal(mel.length, 3);
  assert.deepEqual(mel[0].events, mel[2].events);
  assert.throws(() => compileSong(tiny({ sections: { a: { progression: ['I', 'V', 'vi', 'IV'], parts: { melody: 'C4:4 D4:4 E4:4' } } }, form: [['a', 1]] })), /tiny: a melody \(sparse\), bar 1: adds up to 12 sixteenths instead of 16/);
  assert.throws(() => compileSong(tiny({ form: [['a', 1], ['nope', 1]] })), /uses section "nope"/);
  assert.throws(() => compileSong(tiny({ form: undefined })), /needs a "form"/);
  assert.throws(() => compileSong(tiny({ sections: { a: { progression: ['I'], parts: {} } }, form: [['a', 1]] })), /progression of 4 or 8/);
  assert.throws(() => compileSong(tiny({ sections: { a: { progression: ['I', 'V', 'I', 'V'], parts: { flute: 'C4:16' } } }, form: [['a', 1]] })), /unknown part "flute"/);
});

test('chordAt uses the section progression, counted from the section start; the coda is the tonic', () => {
  const s = structureFromSeed('song:murmur-pop');
  const numeral = (p, b) => chordAt(s, p, b);
  const I = chordAt({ key: 'A', mode: 'major', progression: ['I'] }, 0, 0);
  const vi = chordAt({ key: 'A', mode: 'major', progression: ['vi'] }, 0, 0);
  assert.deepEqual(numeral(0, 0), I, 'intro starts on I');
  assert.deepEqual(numeral(2, 0), vi, 'the verse starts on vi');
  assert.deepEqual(numeral(3, 0), vi, 'and so does its second phrase');
  assert.deepEqual(numeral(5, 0), I, 'chorus on I');
  const end = formFromStructure(s).length;
  assert.equal(sectionAt(formFromStructure(s), end).section.name, 'end');
  assert.deepEqual(numeral(end, 0), I, 'the last chord is the tonic');
  // pure
  assert.deepEqual(numeral(9, 2), numeral(9, 2));
});

test('an 8-bar part starts at its section start, whatever phrase that is', () => {
  const s = structureFromSeed('song:ode-to-joy-pop');
  const loop = SONGS['ode-to-joy-pop'].loops.find((l) => l.style === 'song-ode-to-joy-pop-verse2' && l.role === 'melody');
  const f = formFromStructure(s);
  const verse2 = f.starts[f.sections.findIndex((x) => x.name === 'verse2')];
  assert.equal(verse2 % 2, 1, 'verse2 starts on an odd phrase, the case that used to break');
  const first = renderPhrase(loop, { structure: s, phrase: verse2, register: 1 }).notes;
  const second = renderPhrase(loop, { structure: s, phrase: verse2 + 1, register: 1 }).notes;
  assert.equal(first.at(-1).dur, 8, 'bar 4 of the theme: E held');
  assert.equal(second.at(-1).midi - first.at(-1).midi, -2, 'bar 8: down to D, the end of the theme');
});

test('the demo songs: forms, lengths and instruments as planned', () => {
  for (const [id, minS, maxS] of [['murmur', 130, 150], ['murmur-pop', 135, 155], ['ode-to-joy-pop', 100, 125]]) {
    const s = structureFromSeed(`song:${id}`);
    const f = formFromStructure(s);
    assert.ok(f && f.end, `${id} ends`);
    const seconds = ((f.length * 16 + 12) * 60) / s.bpm; // + three bars of the final chord
    assert.ok(seconds > minS && seconds < maxS, `${id} lasts ${seconds.toFixed(0)} s`);
    for (const r of ['drums', 'bass', 'chords', 'melody']) assert.ok(SONGS[id].voices[r].length, `${id} ${r} voices`);
  }
  // Murmur builds up as the demo story: drums, then bass, then chords, then the melody
  for (const id of ['murmur', 'murmur-pop']) {
    const f = formFromStructure(structureFromSeed(`song:${id}`));
    const firstIn = (r) => f.sections.findIndex((x) => x.plan[r] !== 'out');
    assert.ok(firstIn('drums') < firstIn('bass') && firstIn('bass') < firstIn('chords') && firstIn('chords') < firstIn('melody'), id);
  }
  const f = formFromStructure(structureFromSeed('song:murmur-pop'));
  // the director is not part of a song's directive (main.js passes the default): the form leads
  const d = formDirective(f, 5);
  assert.equal(d.section, 'chorus');
  assert.equal(d.hook, true);
});

test('murmur-pop on four devices, start to end: sections in order, the right parts, one instrument each, a clean ending', () => {
  const { parts, events, directive, form } = simulateBand({ seed: 'song:murmur-pop', rng: 'demo', phrases: 22, devices: 4 });
  const series = byRole(parts);
  const last = form.length; // the coda phrase
  assert.ok(!parts.some((x) => x.phrase > last), 'nothing after the coda');
  assert.ok(events.some((e) => e.type === 'end' && e.phrase === last), 'the end is announced on the coda');
  for (const { phrase, role, part } of parts) {
    const d = directive(phrase);
    if (d.end) { assert.ok(part.notes.every((n) => n.step === 0)); continue; }
    if (d.plan[role] === 'out') assert.equal(part.notes.length, 0, `${role} should rest in the ${d.section} (phrase ${phrase})`);
    else assert.ok(part.notes.length > 0, `${role} should play in the ${d.section} (phrase ${phrase})`);
    if (part.notes.length && !d.end) assert.equal(part.d.style, `song-murmur-pop-${d.section}`);
  }
  for (const r of Object.keys(SONGS['murmur-pop'].voices)) {
    const voices = new Set(series[r].map((x) => x.part.d.voice));
    assert.deepEqual([...voices], [SONGS['murmur-pop'].voices[r][0]], `${r} keeps its first instrument`);
  }
  const names = [];
  for (let p = 0; p <= last; p++) if (directive(p).isFirstPhrase) names.push(directive(p).section);
  assert.deepEqual(names, [...SONGS['murmur-pop'].form.map(([n]) => n), 'end']);
});

test('old songs without sections are unchanged', () => {
  for (const id of ['ode-to-joy', 'canon-in-d', 'mountain-king']) {
    const s = structureFromSeed(`song:${id}`);
    assert.equal(s.form, undefined);
    assert.equal(formFromStructure(s), null);
    assert.ok(SONGS[id].loops.every((l) => l.style === `song-${id}`));
  }
});

test('the demo preset: a Menu button and ?demo= in main.js', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="demoStart"/);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /params\.get\('demo'\)/);
  assert.match(main, /\?\? \(DEMO \? 'demo' : null\)/, 'the demo is reproducible by default');
});

test('?part=: a device can ask for a part; it gets it if nobody owns it, and the rest follow the usual order', async () => {
  const { nextClaim } = await import('../src/swarm/roles.js');
  const claims = [];
  claims.push({ id: 'laptop', role: nextClaim('laptop', claims, 'drums'), ts: 0 });
  assert.equal(claims[0].role, 'drums', 'the speaker laptop takes the drums');
  for (const [i, id] of ['p1', 'p2', 'p3'].entries()) claims.push({ id, role: nextClaim(id, claims), ts: i + 1 });
  assert.deepEqual(claims.map((c) => c.role), ['drums', 'chords', 'bass', 'melody']);
  // asking for a part someone already owns: the usual order instead
  assert.equal(nextClaim('late', [{ id: 'laptop', role: 'drums', ts: 0 }], 'drums'), 'chords');
  // keeping what you have beats a preference
  assert.equal(nextClaim('p1', [{ id: 'p1', role: 'bass', ts: 0 }], 'melody'), 'bass');
});

test('Murmur (dance): minor, the melody only uses notes of the chord under it', async () => {
  const { chordAt } = await import('../src/render.js');
  const s = structureFromSeed('song:murmur');
  assert.equal(s.mode, 'minor');
  const { parts } = simulateBand({ seed: 'song:murmur', rng: 'demo', phrases: 18, devices: 4 });
  let notes = 0, outside = 0;
  for (const { phrase, role, part } of parts) {
    if (role !== 'melody') continue;
    for (const n of part.notes) {
      notes++;
      const c = chordAt(s, phrase, Math.floor(n.step / 16));
      if (!c.pcs.includes(n.midi % 12)) outside++;
    }
  }
  assert.ok(notes > 50);
  assert.ok(outside / notes < 0.12, `${outside}/${notes} melody notes outside the chord`);
});
