// Builds the loop packs in src/packs/ from three openly licensed sources (see CREDITS.md):
//
//   Groove MIDI Dataset (Magenta, CC BY 4.0)  -> drum loops, 2 bars, by genre
//   POP909 (Music X Lab, MIT)                 -> melodies, bass lines and piano comping rhythms,
//                                                converted against each song's own chord labels
//   free-midi-chords (Ludovic Drolez, MIT)    -> mood-tagged chord progressions and chord rhythms
//
// The source files are only read as data. Usage:
//   node tools/build-packs.mjs <groove dir> <POP909 dir> <free-midi-chords dir>

import fs from 'node:fs';
import path from 'node:path';
import MidiPkg from '@tonejs/midi';
import { parseChord, diatonicIndex, degreeInterval, anchorFor, SCALES } from '../src/theory.js';

const { Midi } = MidiPkg;
const [grooveDir, popDir, chordsDir] = process.argv.slice(2);
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'packs');
fs.mkdirSync(OUT, { recursive: true });

const PC = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r2 = (x) => Math.round(x * 100) / 100;

// Pick up to n items spread evenly through a list (keeps variety across songs/drummers).
function spread(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]);
  return out;
}
function density(perBar, [a, b]) {
  return perBar < a ? 'sparse' : perBar < b ? 'medium' : 'busy';
}

// ===================================================================================
// 1. Groove MIDI -> drums
// ===================================================================================
const GM = {
  36: 'kick', 35: 'kick',
  38: 'snare', 40: 'snare', 37: 'snare',
  42: 'hat', 22: 'hat', 44: 'hat', 51: 'hat', 59: 'hat', 53: 'hat', // rides play the hat part
  46: 'ohat', 26: 'ohat', 49: 'ohat', 57: 'ohat', 55: 'ohat', 52: 'ohat', // crashes become open hats
  48: 'tom1', 50: 'tom1', 45: 'tom2', 47: 'tom2', 43: 'tom3', 58: 'tom3',
};
const GENRE_ENERGY = { rock: 0.7, funk: 0.7, punk: 0.95, hiphop: 0.5, soul: 0.5, jazz: 0.4, latin: 0.6, afrocuban: 0.6, reggae: 0.35, country: 0.5, pop: 0.6, gospel: 0.65, neworleans: 0.55, afrobeat: 0.65, dance: 0.85 };
const DRUM_CODE = { kick: 'k', snare: 's', hat: 'h', ohat: 'o', tom1: '1', tom2: '2', tom3: '3' };

function buildGroove(dir) {
  const rows = fs.readFileSync(path.join(dir, 'info.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const byGenre = {};
  let rejected = 0;
  for (const r of rows) {
    const [, , , style, bpm, type, ts, file] = r;
    if (type !== 'beat' || ts !== '4-4') continue;
    const genre = style.split('/')[0];
    if (!(genre in GENRE_ENERGY)) continue;
    const midi = new Midi(fs.readFileSync(path.join(dir, file)));
    const ppq = midi.header.ppq;
    const sixteenth = ppq / 4;
    const notes = midi.tracks.flatMap((t) => t.notes).filter((n) => GM[n.midi]);
    if (!notes.length) continue;
    const bars = Math.floor(Math.max(...notes.map((n) => n.ticks)) / (ppq * 4));
    for (let b = 0; b + 2 <= bars; b += 2) {
      const start = b * ppq * 4, end = start + 2 * ppq * 4;
      const win = notes.filter((n) => n.ticks >= start - sixteenth / 2 && n.ticks < end - sixteenth / 2);
      if (win.length < 8) continue;
      let off = 0;
      const hits = new Map();
      for (const n of win) {
        const s = (n.ticks - start) / sixteenth;
        const q = Math.round(s);
        off += Math.abs(s - q);
        if (q < 0 || q >= 32) continue;
        const key = `${q}:${GM[n.midi]}`;
        hits.set(key, Math.max(hits.get(key) || 0, n.velocity));
      }
      if (off / win.length > 0.22) { rejected++; continue; } // swung or loose: doesn't sit on a 16th grid
      const ev = [...hits.entries()].map(([k, v]) => { const [q, d] = k.split(':'); return [Math.floor(q / 16), q % 16, DRUM_CODE[d], r2(clamp(v, 0.15, 1))]; });
      const has = (d) => ev.some((e) => e[2] === d);
      if (!has('k') || !has('s') || !(has('h') || has('o'))) continue;
      const sig = ev.map((e) => `${e[0]}.${e[1]}.${e[2]}`).sort().join(' ');
      (byGenre[genre] ||= []).push({ sig, ev, perBar: ev.length / 2, bpm: Number(bpm), src: file });
    }
  }
  const loops = [];
  const stats = {};
  for (const [genre, list] of Object.entries(byGenre)) {
    const seen = new Set();
    const uniq = list.filter((x) => (seen.has(x.sig) ? false : seen.add(x.sig)));
    if (uniq.length < 6) continue;
    const per = uniq.map((x) => x.perBar).sort((a, b) => a - b);
    const t = [per[Math.floor(per.length / 3)], per[Math.floor((2 * per.length) / 3)]];
    for (const dens of ['sparse', 'medium', 'busy']) {
      const pick = spread(uniq.filter((x) => density(x.perBar, t) === dens), 8);
      pick.forEach((x, i) => loops.push({
        id: `drums/groove-${genre}/${dens}/${i + 1}`, role: 'drums', style: `groove-${genre}`, density: dens, bars: 2,
        energy: r2(clamp(GENRE_ENERGY[genre] + (dens === 'busy' ? 0.1 : dens === 'sparse' ? -0.1 : 0), 0, 1)), weight: 1, e: x.ev,
      }));
      stats[`${genre}/${dens}`] = pick.length;
    }
  }
  console.log(`groove: ${loops.length} drum loops from ${Object.keys(byGenre).length} genres (${rejected} swung windows skipped)`);
  return loops;
}

// ===================================================================================
// 2. POP909 -> melody, bass, chord comping
// ===================================================================================
function parseChordLabel(label, key) {
  // "Bb:min7" -> { rootPc, quality: 'maj'|'min'|'dim' } or null
  const m = /^([A-G][b#]?):([a-z0-9]+)/.exec(label);
  if (!m || !(m[1] in PC)) return null;
  const q = m[2];
  let quality = null;
  if (/^(maj|maj7|maj6|7|9|11|13|maj9)$/.test(q)) quality = 'maj';
  else if (/^(min|min7|min6|min9|min11|minmaj7)$/.test(q)) quality = 'min';
  else if (/^(dim|hdim7|dim7)$/.test(q)) quality = 'dim';
  if (!quality) return null; // sus, aug, power chords...
  return { rootPc: PC[m[1]], quality };
}

// Chord in the song's key -> our chord object (via a Roman numeral), or null if it isn't one we model.
function chordInKey(c, key) {
  const scale = SCALES[key.mode];
  const rel = (c.rootPc - key.pc + 12) % 12;
  let deg = scale.indexOf(rel), acc = '';
  if (deg < 0) {
    deg = scale.indexOf((rel + 1) % 12); acc = 'b';
    if (deg < 0) return null;
  }
  let numeral = NUMERALS[deg];
  numeral = c.quality === 'maj' ? numeral : numeral.toLowerCase();
  if (c.quality === 'dim') numeral += '°';
  return parseChord(acc + numeral, KEY_NAMES[key.pc], key.mode);
}

function songData(dir, id) {
  const base = path.join(dir, id);
  const midi = new Midi(fs.readFileSync(path.join(base, `${id}.mid`)));
  const beats = fs.readFileSync(path.join(base, 'beat_midi.txt'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const downs = beats.filter((b) => b[2] === 1).map((b) => b[0]);
  const chords = fs.readFileSync(path.join(base, 'chord_midi.txt'), 'utf8').trim().split('\n').map((l) => { const [s, e, c] = l.trim().split(/\s+/); return { s: +s, e: +e, c }; });
  const keys = fs.readFileSync(path.join(base, 'key_audio.txt'), 'utf8').trim().split('\n').map((l) => {
    const [s, e, k] = l.trim().split(/\s+/);
    const m = /^([A-G][b#]?):(maj|min)/.exec(k || '');
    return m && m[1] in PC ? { s: +s, e: +e, pc: PC[m[1]], mode: m[2] === 'maj' ? 'major' : 'minor' } : null;
  }).filter(Boolean);
  const track = (name) => midi.tracks.find((t) => t.name.toUpperCase().includes(name))?.notes || [];
  // 4/4 check: 4 beats between downbeats
  let fourFour = 0;
  for (let i = 0; i + 1 < downs.length; i++) if (beats.filter((b) => b[0] >= downs[i] && b[0] < downs[i + 1]).length === 4) fourFour++;
  return { downs, chords, keys, melody: track('MELODY'), piano: track('PIANO'), fourFour: fourFour / Math.max(1, downs.length - 1) };
}

function barChord(song, b) {
  const s = song.downs[b], e = song.downs[b + 1];
  const cover = new Map();
  for (const c of song.chords) {
    const o = Math.min(e, c.e) - Math.max(s, c.s);
    if (o > 0) cover.set(c.c, (cover.get(c.c) || 0) + o);
  }
  const best = [...cover.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 0.6 * (e - s) || best[0] === 'N') return null;
  return best[0];
}

// Quantise notes (seconds) in 4 bars starting at bar b. Returns events or null if they don't sit on the grid.
function quantise(song, b, notes) {
  const out = [];
  let off = 0;
  for (let k = 0; k < 4; k++) {
    const s = song.downs[b + k], e = song.downs[b + k + 1];
    const step = (e - s) / 16;
    for (const n of notes) {
      if (n.time < s - step / 2 || n.time >= e - step / 2) continue;
      const x = (n.time - s) / step;
      const q = Math.round(x);
      off += Math.abs(x - q);
      if (q < 0 || q > 15) continue;
      out.push({ bar: k, step: q, dur: clamp(Math.round(n.duration / step), 1, 16), midi: n.midi, vel: n.velocity });
    }
  }
  if (!out.length || off / out.length > 0.2) return null;
  return out;
}

function keyAt(song, t) {
  return song.keys.find((k) => t >= k.s && t < k.e) || song.keys[0] || null;
}

// events with midi -> [bar, step, dur, deg, oct, vel] relative to each bar's chord; null if too chromatic
function relative(events, chords, role) {
  const pitches = events.map((e) => e.midi);
  const med = median(pitches);
  let chromatic = 0;
  const rows = events.map((e) => {
    const chord = chords[e.bar];
    const idx = diatonicIndex(e.midi, chord, role === 'bass' ? anchorFor('bass', chord) : rootNearMedian(med, chord));
    const d = ((idx % 7) + 7) % 7;
    const exact = (chord.rootPc + degreeInterval(d, chord)) % 12 === ((e.midi % 12) + 12) % 12;
    if (!exact) chromatic++;
    return { ...e, idx };
  });
  if (chromatic / events.length > 0.1) return null;
  const octs = rows.map((r) => Math.floor(r.idx / 7));
  const shift = median(octs);
  return rows.map((r) => [r.bar, r.step, r.dur, r.idx - 7 * Math.floor(r.idx / 7), Math.floor(r.idx / 7) - shift, r2(r.vel)]);
}
const rootNearMedian = (med, chord) => med - ((((med - chord.rootPc) % 12) + 12) % 12);

function buildPop909(dir) {
  const ids = fs.readdirSync(dir).filter((d) => /^\d{3}$/.test(d)).sort();
  const mel = [], bass = [], comp = [];
  let songs = 0;
  for (const id of ids) {
    let song;
    try { song = songData(dir, id); } catch { continue; }
    if (song.fourFour < 0.9 || !song.keys.length) continue;
    songs++;
    const found = { mel: [], bass: [], comp: [] };
    for (let b = 0; b + 5 < song.downs.length; b += 2) {
      const key = keyAt(song, song.downs[b]);
      if (!key) continue;
      const labels = [0, 1, 2, 3].map((k) => barChord(song, b + k));
      if (labels.some((l) => !l)) continue;
      const chords = labels.map((l) => { const c = parseChordLabel(l); return c && chordInKey(c, key); });
      if (chords.some((c) => !c)) continue;

      // melody
      const m = quantise(song, b, song.melody);
      if (m && m.length >= 8 && m.length <= 40 && new Set(m.map((e) => e.bar)).size >= 3 && Math.max(...m.map((e) => e.midi)) - Math.min(...m.map((e) => e.midi)) <= 19) {
        const rel = relative(m, chords, 'melody');
        if (rel) found.mel.push({ rel, perBar: m.length / 4, b });
      }

      // bass: lowest piano note at each onset, below G3
      const onsets = new Map();
      for (const n of song.piano) if (n.midi < 55) { const k = Math.round(n.time * 50); if (!onsets.has(k) || onsets.get(k).midi > n.midi) onsets.set(k, n); }
      const bq = quantise(song, b, [...onsets.values()]);
      if (bq && bq.length >= 4 && bq.length <= 32 && new Set(bq.map((e) => e.bar)).size >= 3) {
        const rel = relative(bq, chords, 'bass');
        if (rel) {
          const chordTones = rel.filter((r) => r[3] === 0 || r[3] === 4).length / rel.length;
          const onDownbeat = [0, 1, 2, 3].filter((k) => rel.some((r) => r[0] === k && r[1] === 0 && r[3] === 0)).length;
          if (chordTones >= 0.7 && onDownbeat >= 3) found.bass.push({ rel, perBar: bq.length / 4, b });
        }
      }

      // comping: piano onsets where two or more notes above E3 start together
      const groups = new Map();
      for (const n of song.piano) if (n.midi >= 52) { const k = Math.round(n.time * 50); (groups.get(k) || groups.set(k, []).get(k)).push(n); }
      const hits = [...groups.values()].filter((g) => g.length >= 2).map((g) => ({ time: g[0].time, duration: Math.max(...g.map((x) => x.duration)), midi: 60, velocity: Math.max(...g.map((x) => x.velocity)), size: g.length }));
      const cq = quantise(song, b, hits);
      if (cq && cq.length >= 4 && cq.length <= 40 && new Set(cq.map((e) => e.bar)).size === 4) {
        found.comp.push({ ev: cq.map((e) => [e.bar, e.step, e.dur, r2(e.vel)]), perBar: cq.length / 4, size: median(hits.map((h) => h.size)), b });
      }
    }
    // a few windows per song, spread through it
    for (const x of spread(found.mel, 3)) mel.push({ ...x, song: id });
    for (const x of spread(found.bass, 2)) bass.push({ ...x, song: id });
    for (const x of spread(found.comp, 2)) comp.push({ ...x, song: id });
  }
  const loops = [];
  const WEIGHT = { melody: 3, bass: 1.6, chords: 1.4 }; // real melodies should win over the hand-written motifs
  const add = (role, list, cap, thresholds, extra = () => ({})) => {
    const seen = new Set();
    const uniq = list.filter((x) => { const s = JSON.stringify(x.rel || x.ev); return seen.has(s) ? false : seen.add(s); });
    for (const dens of ['sparse', 'medium', 'busy']) {
      const pick = spread(uniq.filter((x) => density(x.perBar, thresholds) === dens), cap);
      for (const x of pick) loops.push({
        id: `${role}/pop909/${dens}/${x.song}-${x.b}`, role, style: 'pop909', density: dens, bars: 4,
        energy: r2(clamp(0.25 + x.perBar / 12, 0, 1)), weight: WEIGHT[role], e: x.rel || x.ev, ...extra(x),
      });
    }
  };
  add('melody', mel, 120, [3, 6]);
  add('bass', bass, 80, [3, 6]);
  add('chords', comp, 60, [2, 4], (x) => ({ voicing: x.size >= 4 ? 4 : 3 }));
  const count = (r) => loops.filter((l) => l.role === r).length;
  console.log(`POP909: ${songs} songs in 4/4 -> ${count('melody')} melodies, ${count('bass')} bass lines, ${count('chords')} comping rhythms`);
  return loops;
}

// ===================================================================================
// 3. free-midi-chords -> progressions and chord rhythms (parsed as text, not executed)
// ===================================================================================
function buildDrolez(dir) {
  // chord rhythms: "'name': [ '1.5N', 'X', ... ]," in c2mpatterns.py
  const ptxt = fs.readFileSync(path.join(dir, 'src', 'chords2midi', 'c2mpatterns.py'), 'utf8');
  const patterns = {};
  for (const m of ptxt.matchAll(/'(\w+)':\s*\[([^\]]*)\]/g)) {
    patterns[m[1]] = [...m[2].matchAll(/'([\d.]*)([NSX])'|\b([NSX])\b/g)].map((t) => ({ beats: Number(t[1] || 1) || 1, kind: t[2] || t[3] }));
  }
  const groups = { 'drolez-pop': ['pop', 'pop2', 'basic4'], 'drolez-soul': ['long', 'soul', 'soul2'], 'drolez-hiphop': ['hiphop', 'hiphop2', 'hiphop3'], 'drolez-offbeat': ['alt', 'alt2', 'alt3'] };
  const loops = [];
  for (const [style, names] of Object.entries(groups)) {
    for (const name of names) {
      const p = patterns[name];
      if (!p) continue;
      let t = 0;
      const ev = [];
      for (const tok of p) {
        if (tok.kind !== 'X') ev.push([Math.floor((t * 4) / 16), Math.round(t * 4) % 16, Math.max(1, Math.round(tok.beats * 4)), tok.kind === 'N' ? 0.75 : 0.6]);
        t += tok.beats;
      }
      const bars = [1, 2, 4].find((b) => b * 4 >= t - 0.01) ?? 4;
      const perBar = ev.length / bars;
      loops.push({ id: `chords/${style}/${name}`, role: 'chords', style, density: density(perBar, [1.6, 2.6]), bars, voicing: 4, energy: style === 'drolez-soul' ? 0.35 : style === 'drolez-hiphop' ? 0.5 : 0.6, weight: 1.2, e: ev.map(([bar, step, dur, vel]) => [bar, step, Math.min(dur, 16), vel]) });
    }
  }
  console.log(`free-midi-chords: ${loops.length} chord rhythms`);

  // progressions: lines like "i VI III VII =Nostalgic Hopeful", inside prog_maj / prog_min
  const ctxt = fs.readFileSync(path.join(dir, 'chords.py'), 'utf8');
  const list = (name) => {
    const block = ctxt.slice(ctxt.indexOf(`${name} = [`), ctxt.indexOf(']', ctxt.indexOf(`${name} = [`)));
    return [...block.matchAll(/"([^"=]+?)\s*=([^"]*)"/g)].map((m) => ({ chords: m[1].trim().split(/\s+/), mood: m[2].replace(/\bNew\b/g, '').trim() }));
  };
  const simplify = (n, mode) => {
    if (n.includes('/')) return null;
    const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(n);
    if (!m) return null;
    let [, acc, num, suffix] = m;
    const dim = /dim/.test(suffix) || /^m7?-5/.test(suffix); // M-5 is a major chord with a flat fifth: keep it major
    if (/aug|\+/.test(suffix)) return null;
    let out = acc + num + (dim ? '°' : '');
    if (!dim && mode === 'minor' && num === 'ii') out = 'ii°';
    if (!dim && mode === 'major' && num === 'vii') out = 'vii°';
    return out;
  };
  const progressions = {};
  for (const [mode, name] of [['major', 'prog_maj'], ['minor', 'prog_min']]) {
    progressions[mode] = list(name)
      .map((p) => ({ chords: p.chords.map((c) => simplify(c, mode)), mood: p.mood }))
      .filter((p) => (p.chords.length === 4 || p.chords.length === 8) && p.chords.every(Boolean) && new Set(p.chords).size >= 3 && p.mood && !/Cadence/.test(p.mood))
      .filter((p) => { try { p.chords.forEach((c) => parseChord(c, 'C', mode)); return true; } catch { return false; } });
  }
  console.log(`free-midi-chords: ${progressions.major.length} major and ${progressions.minor.length} minor progressions`);
  return { loops, progressions };
}

// ===================================================================================
const header = (what) => `// Generated by tools/build-packs.mjs from ${what}. See CREDITS.md. Do not edit by hand.\n`;
const write = (file, what, data) => {
  const text = header(what) + `export default ${JSON.stringify(data)};\n`;
  fs.writeFileSync(path.join(OUT, file), text);
  console.log(`  wrote src/packs/${file} (${Math.round(text.length / 1024)} KB)`);
};
const groove = buildGroove(grooveDir);
write('groove.js', 'the Groove MIDI Dataset (Magenta, CC BY 4.0)', groove);
const pop = buildPop909(popDir);
write('pop909.js', 'POP909 (Music X Lab, MIT)', pop);
const drolez = buildDrolez(chordsDir);
write('drolez.js', 'free-midi-chords (Ludovic Drolez, MIT)', drolez.loops);
write('progressions.js', 'free-midi-chords (Ludovic Drolez, MIT)', drolez.progressions);
