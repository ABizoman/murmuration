import test from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, registerSong, songSeed } from '../src/songs/index.js';
import { parseLine, compileSong } from '../src/songs/format.js';
import { renderPhrase } from '../src/render.js';
import { structureFromSeed } from '../src/seed.js';
import { createLibrary, ROLES , CORE_ROLES } from '../src/loops.js';
import { Agent } from '../src/agent.js';
import { Engine } from '../src/engine.js';
import { stepMs } from '../src/clock.js';
import { voiceById } from '../src/voices.js';
import mountainKing from '../src/songs/mountain-king.js';
import canon from '../src/songs/canon-in-d.js';
import ode from '../src/songs/ode-to-joy.js';

const DEFS = { 'mountain-king': mountainKing, 'canon-in-d': canon, 'ode-to-joy': ode };

// Render a loop over enough phrases to cover it; return { 'bar:step': midi } over absolute bars.
function play(loop, structure, register = 0) {
  const out = {};
  for (let phrase = 0; phrase < loop.bars / 4 || phrase < 1; phrase++) {
    for (const n of renderPhrase(loop, { structure, phrase, register }).notes) {
      const bar = phrase * 4 + Math.floor(n.step / 16);
      if (bar < loop.bars) out[`${bar}:${n.step % 16}`] = n;
    }
  }
  return out;
}

test('every song renders exactly what was written (same notes, rhythm and lengths, up to whole octaves)', () => {
  for (const [id, def] of Object.entries(DEFS)) {
    const structure = structureFromSeed(songSeed(id));
    for (const loop of SONGS[id].loops) {
      const spec = def.parts[loop.role][loop.density];
      if (!spec || loop.role === 'drums') continue;
      const written = parseLine(spec, id).events;
      const heard = play(loop, structure);
      assert.equal(Object.keys(heard).length, written.length, `${loop.id}: note count`);
      let shift = null;
      for (const w of written) {
        const h = heard[`${w.bar}:${w.step}`];
        assert.ok(h, `${loop.id}: nothing at bar ${w.bar + 1} step ${w.step}`);
        assert.equal(h.dur, w.dur, `${loop.id}: length at bar ${w.bar + 1} step ${w.step}`);
        if (loop.role === 'chords') continue;
        const d = h.midi - w.midi;
        assert.equal(((d % 12) + 12) % 12, 0, `${loop.id}: bar ${w.bar + 1} step ${w.step} plays ${h.midi}, written ${w.midi}`);
        shift ??= d;
        assert.equal(d, shift, `${loop.id}: octave jumps inside the part at bar ${w.bar + 1}`);
      }
    }
  }
});

test('drum patterns come through hit for hit', () => {
  const structure = structureFromSeed(songSeed('mountain-king'));
  const loop = SONGS['mountain-king'].loops.find((l) => l.id === 'drums/song-mountain-king/busy');
  const notes = renderPhrase(loop, { structure, phrase: 0 }).notes;
  const snareBar4 = notes.filter((n) => n.drum === 'snare' && n.step >= 48).map((n) => n.step - 48);
  assert.deepEqual(snareBar4.sort((a, b) => a - b), [4, 8, 10, 12, 13, 14, 15]);
  assert.equal(notes.filter((n) => n.drum === 'kick').length, 32);
});

test('song seeds give the song its own key, tempo and chords', () => {
  const s = structureFromSeed('song:ode-to-joy');
  assert.equal(s.key, 'D'); assert.equal(s.mode, 'major'); assert.equal(s.bpm, 108);
  assert.equal(s.song.id, 'ode-to-joy');
  assert.ok(s.mood.includes('Beethoven'));
  assert.equal(structureFromSeed('song:nope').song, undefined, 'unknown song falls back to an improvised structure');
});

test('the format catches mistakes with a clear message', () => {
  assert.throws(() => parseLine('C4:4 D4:4 E4:4', 'x'), /adds up to 12/);
  assert.throws(() => parseLine('C4:4 H4:12', 'x'), /not a note/);
  assert.throws(() => compileSong({ ...ode, id: 'bad', progression: ['I', 'V', 'I'] }), /4 or 8 chords/);
  assert.throws(() => compileSong({ ...ode, id: 'bad', parts: { drums: { busy: { kick: 'x...' } } } }), /16 characters/);
  const custom = registerSong({ id: 'test-tune', title: 'Test', composer: 'me', key: 'G', mode: 'major', bpm: 100, progression: ['I', 'IV', 'V', 'I'], parts: { melody: { medium: 'G4:16 | C5:16 | D5:16 | G4:16' } } });
  assert.equal(custom.loops.filter((l) => l.role === 'melody').length, 3, 'missing densities are filled in');
});

function simulate(id, phrases = 20, seed = 5) {
  let t = 0, r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const structure = structureFromSeed(songSeed(id));
  const library = createLibrary({ packs: SONGS[id].loops, builtins: false });
  const parts = [];
  const e = new Engine({ agents: ROLES.map((role) => new Agent(role, library, rand)), now: () => t, audio: { play() {} }, onEvent: (ev) => parts.push(ev) });
  e.start(structure, 0);
  for (t = 0; t < phrases * 64 * stepMs(structure.bpm); t += 50) e.tick();
  return parts;
}

test('the swarm builds each song up layer by layer, in roughly the song order, and keeps the theme intact', () => {
  for (const id of Object.keys(DEFS)) {
    const order = DEFS[id].build;
    let firstWins = 0, allIn = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // these songs predate the extra layers, which rest in them: judge the core band
      const parts = simulate(id, 16, seed).filter((x) => CORE_ROLES.includes(x.role));
      const entry = Object.fromEntries(CORE_ROLES.map((r) => [r, parts.find((x) => x.role === r && x.part.notes.length)?.phrase ?? 99]));
      if (entry[order[0]] === 0 && CORE_ROLES.filter((r) => r !== order[0]).every((r) => entry[r] > 0)) firstWins++;
      if (Math.max(...Object.values(entry)) <= 8) allIn++;
      for (const x of parts) {
        assert.equal(x.part.d.interaction, 'none', `${id}: ${x.role} reacted to someone`);
        assert.equal(x.part.d.register, 0);
        assert.ok(DEFS[id].voices[x.role].includes(x.part.d.voice), `${id}: ${x.role} on ${x.part.d.voice}`);
      }
      // once in, a part stays in
      for (const r of CORE_ROLES) {
        const lv = parts.filter((x) => x.role === r).map((x) => x.part.d.level);
        const first = lv.findIndex((l) => l > 0);
        if (first >= 0) assert.ok(lv.slice(first).filter((l) => l === 0).length <= 1, `${id}: ${r} dropped out ${lv.join('')}`);
      }
    }
    assert.ok(firstWins >= 11, `${id}: ${order[0]} starts alone in ${firstWins}/12 runs`);
    assert.ok(allIn >= 10, `${id}: everyone in by phrase 9 in ${allIn}/12 runs`);
  }
});
