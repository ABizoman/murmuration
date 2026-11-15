// Song format: a song is a fixed score the agents build up together.
// Written as text so it is easy to read and edit; compiled into the same chord-relative loops as
// everything else (through midi-import.js), so the key, instruments and arrangement stay flexible
// while the notes of the theme stay exact. See docs/ADDING_SONGS.md.
//
// Melodic parts (bass, melody):  'B3:2 C#4:2 D4:2 E4:2 F#4:2 D4:2 F#4:4 | ...'
//   NOTE:LENGTH, length in 16th notes, '.' is a rest ('.:4'), '|' separates bars.
//   Every bar must add up to 16. Add '!' for an accent (B3:2!).
// Chord rhythm (chords):         'x:4 x:4 .:8 | ...'   x = play the bar's chord
// Drums:                         { kick: 'x...x...x...x... | ...', snare: '....x.......x...', hat: ..., ohat, tom1, tom2, tom3 }
//   one character per 16th, x = hit, X = accented hit, '.' = nothing. A single bar repeats over the loop.

import { toRelativeLoop } from '../midi-import.js';
import { DENSITIES } from '../loops.js';
import { renderPhrase } from '../render.js';

const NOTE = /^([A-G])(#|b)?(-?\d)$/;
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteToMidi(name) {
  const m = NOTE.exec(name);
  if (!m) throw new Error(`"${name}" is not a note (use e.g. C4, F#3, Bb2)`);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

// '...' -> [{ bar, step, dur, midi | hit, accent }]
export function parseLine(text, where) {
  const bars = text.split('|').map((b) => b.trim()).filter((b, i, all) => b.length || i < all.length - 1);
  const out = [];
  bars.forEach((bar, b) => {
    let step = 0;
    for (const tok of bar.split(/\s+/).filter(Boolean)) {
      const m = /^([^:]+):(\d+)(!?)$/.exec(tok);
      if (!m) throw new Error(`${where}, bar ${b + 1}: can't read "${tok}" (expected NOTE:LENGTH)`);
      const [, what, len, accent] = m;
      const dur = Number(len);
      if (what !== '.') out.push({ bar: b, step, dur, accent: !!accent, ...(what === 'x' ? { hit: true } : { midi: noteToMidi(what) }) });
      step += dur;
    }
    if (step !== 16) throw new Error(`${where}, bar ${b + 1}: adds up to ${step} sixteenths instead of 16`);
  });
  return { events: out, bars: bars.length };
}

function parseDrums(lines, where) {
  const out = [];
  let bars = 1;
  for (const [drum, text] of Object.entries(lines)) {
    const patterns = text.split('|').map((b) => b.replace(/\s+/g, ''));
    bars = Math.max(bars, patterns.length);
    patterns.forEach((p, b) => {
      if (p.length !== 16) throw new Error(`${where} ${drum}, bar ${b + 1}: needs 16 characters, has ${p.length}`);
      [...p].forEach((c, step) => {
        if (c === 'x' || c === 'X') out.push({ bar: b, step, dur: 1, drum, vel: c === 'X' ? 0.95 : 0.75 });
      });
    });
  }
  return { events: out, bars };
}

const velocity = (e) => (e.accent ? 0.95 : e.step % 4 === 0 ? 0.8 : 0.65);

// Fewer notes, same shape: keep notes on beats 1 and 3 and let them ring. Used when a song gives
// only one version of a part.
function thinned(events) {
  const keep = events.filter((e) => e.step % 8 === 0);
  return keep.map((e, i) => {
    const next = keep[i + 1];
    const end = next && next.bar === e.bar ? next.step : 16;
    return { ...e, dur: Math.max(e.dur, end - e.step) };
  });
}

function compilePart(song, role, density, spec, section = null) {
  const style = section ? `song-${song.id}-${section.name}` : `song-${song.id}`;
  const where = `${song.id}: ${section ? `${section.name} ` : ''}${role} (${density})`;
  const id = `${role}/${style}/${density}`;
  const progression = section?.progression ?? song.progression;
  const meta = { id, role, style, density, key: song.key, mode: song.mode, progression };
  if (role === 'drums') {
    const { events, bars } = parseDrums(spec, where);
    return { ...meta, bars: fit(bars, where), events };
  }
  const { events, bars } = typeof spec === 'string' ? parseLine(spec, where) : spec;
  const raw = events.map((e) => ({ midi: e.hit ? 60 : e.midi, ticks: e.bar * 16 + e.step, durationTicks: e.dur, velocity: velocity(e) }));
  const loop = toRelativeLoop(raw, 4, { ...meta, bars: fit(bars, where) });
  if (role === 'chords') loop.voicing = song.voicing ?? 3;
  else keepInRange(loop, { ...song, progression });
  return loop;
}

// Move the whole part by octaves so that, in the song's own key, it never hits the renderer's
// range limits (which would fold single notes and break the tune's shape).
function keepInRange(loop, song) {
  const structure = { key: song.key, mode: song.mode, bpm: song.bpm, progression: song.progression };
  const pitches = () => {
    const out = [];
    for (let phrase = 0; phrase < Math.max(1, loop.bars / 4); phrase++) out.push(...renderPhrase(loop, { structure, phrase, fold: false }).notes.map((n) => n.midi));
    return out;
  };
  const [lo, hi] = loop.role === 'bass' ? [28, 64] : [48, 96];
  for (let i = 0; i < 3; i++) {
    const p = pitches();
    const shift = Math.min(...p) < lo ? 1 : Math.max(...p) > hi ? -1 : 0;
    if (!shift) return;
    for (const e of loop.events) e.oct += shift;
  }
}

function fit(bars, where) {
  if (![1, 2, 4, 8].includes(bars)) throw new Error(`${where}: has ${bars} bars; parts need 1, 2, 4 or 8`);
  return bars;
}

// One role's versions -> a loop per density. With `allSame` (sections) a single version is used for
// every density as written, so a song section always sounds the way it was written.
function compileVersions(def, role, versions, section) {
  const loops = [];
  const single = typeof versions === 'string' || (role === 'drums' && !DENSITIES.some((d) => versions[d]));
  if (single) {
    for (const d of DENSITIES) loops.push(compilePart(def, role, d, versions, section));
    return loops;
  }
  const given = Object.fromEntries(DENSITIES.filter((d) => versions[d]).map((d) => [d, versions[d]]));
  if (!Object.keys(given).length) throw new Error(`${def.id}: ${section ? `${section.name} ` : ''}${role} needs at least one of sparse / medium / busy`);
  for (const d of DENSITIES) {
    let spec = given[d];
    if (!spec && d === 'sparse' && role !== 'drums' && !section) {
      const base = given.medium || given.busy;
      const parsed = typeof base === 'string' ? parseLine(base, `${def.id}: ${role}`) : base;
      spec = { events: thinned(parsed.events), bars: parsed.bars };
    }
    spec ??= given.medium || given.busy || given.sparse;
    loops.push(compilePart(def, role, d, spec, section));
  }
  return loops;
}

const ROLE_NAMES = ['drums', 'bass', 'chords', 'melody'];

// Songs with sections (step E): `sections` { name: { progression, hook?, energy?, plan?, parts } }
// and `form` [[name, phrases], ...]. Each section's parts compile to loops of style
// song-<id>-<section>; a role missing from a section rests in it. `end: true` ends the song after
// the form instead of going round again.
function compileSections(def) {
  if (!Array.isArray(def.form) || !def.form.length) throw new Error(`${def.id}: a song with sections needs a "form": [['intro', 1], ...]`);
  const loops = [];
  const sections = {};
  for (const [name, sec] of Object.entries(def.sections)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error(`${def.id}: section name "${name}" must be letters and digits`);
    const progression = sec.progression ?? def.progression;
    if (!progression || ![4, 8].includes(progression.length)) throw new Error(`${def.id}: section ${name} needs a progression of 4 or 8 chords`);
    for (const r of Object.keys(sec.parts || {})) if (!ROLE_NAMES.includes(r)) throw new Error(`${def.id}: section ${name} has an unknown part "${r}"`);
    sections[name] = { name, progression, hook: !!sec.hook, energy: sec.energy, plan: sec.plan, transitionIn: sec.transitionIn, roles: Object.keys(sec.parts || {}) };
    for (const [role, versions] of Object.entries(sec.parts || {})) loops.push(...compileVersions(def, role, versions, sections[name]));
  }
  for (const [name, phrases] of def.form) {
    if (!sections[name]) throw new Error(`${def.id}: the form uses section "${name}", which is not in "sections"`);
    if (!Number.isInteger(phrases) || phrases < 1) throw new Error(`${def.id}: section ${name} in the form needs a whole number of phrases`);
  }
  return { loops, sections };
}

// song definition -> { ...song, loops }
export function compileSong(def) {
  if (def.sections) {
    if (!Array.isArray(def.form) || !def.form.length) throw new Error(`${def.id}: a song with sections needs a "form": [['intro', 1], ...]`);
    const first = def.sections[def.form[0][0]];
    def = { ...def, progression: def.progression ?? first?.progression, parts: def.parts ?? {} };
  }
  for (const k of ['id', 'title', 'key', 'mode', 'bpm', 'progression', 'parts']) if (def[k] == null) throw new Error(`song is missing "${k}"`);
  // (a song with sections checks each section's progression instead)
  if (!def.sections && ![4, 8].includes(def.progression.length)) throw new Error(`${def.id}: progression needs 4 or 8 chords (one per bar)`);
  if (def.sections) {
    const { loops, sections } = compileSections(def);
    return { ...def, loops, compiledSections: sections };
  }
  const loops = [];
  for (const [role, versions] of Object.entries(def.parts)) {
    const given = Object.fromEntries(DENSITIES.filter((d) => versions[d]).map((d) => [d, versions[d]]));
    if (!Object.keys(given).length) throw new Error(`${def.id}: ${role} needs at least one of sparse / medium / busy`);
    loops.push(...compileVersions(def, role, versions, null));
  }
  return { ...def, loops };
}
