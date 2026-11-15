import { KEYS } from './theory.js';
import { structureFromSeed, randomFor, parseSeed, withEnd } from './seed.js';
import { formFromStructure, formDirective, describeSection } from './form.js';
import { HookBook } from './hooks.js';
import { localNow, STEPS_PER_PHRASE } from './clock.js';
import { createLibrary, ROLES } from './loops.js';
import { Agent, CANDIDATES, CANDIDATES_LITE } from './agent.js';
import { Engine } from './engine.js';
import { createAudio } from './audio.js';
import { importMidiFile } from './midi-import.js';
import { Swarm } from './swarm/swarm.js';
import { PACK_LOOPS } from './packs.js';
import { SONGS, registerSong, songSeed, songFromSeed } from './songs/index.js';
import { Jev } from './decide/jev.js';
import { Director, sectionOf, SECTION_PHRASES } from './decide/director.js';
import { describeDirective, DEFAULT_DIRECTIVE } from './decide/directive.js';
import { summarise, describePart } from './decide/context.js';
import { VOICES, voiceById } from './voices.js';
import { clipName, describeMeters } from './listen.js';
import { sanitiseNotes } from './feel.js';
import { isWeakDevice } from './mix.js';

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const COLORS = Object.fromEntries(ROLES.map((r) => [r, css.getPropertyValue(`--${r}`).trim()]));
const LEVELS = ['silent', 'sparse', 'medium', 'busy'];
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const library = createLibrary({ packs: PACK_LOOPS });

// ?rng=<text>: a reproducible run. Every agent (and through it every loop variant draw) samples
// from a stream fixed by (rng, role), so the same seed + rng make the same music and two
// recordings can be compared fairly. Without it everything samples from Math.random as before.
const params = new URLSearchParams(location.search);
const RNG = params.get('rng');
// Dev switches for the mix (Phase 2): ?solo=<role> hears one part on its own, which is how
// ROLE_GAIN in audio.js is measured; ?lite=1 forces the lite graph, ?lite=0 forbids it.
const SOLO = ROLES.includes(params.get('solo')) ? params.get('solo') : null;
const LITE = params.has('lite') ? params.get('lite') !== '0' : null;
// ?feel=off: no swing and no humanising on this device, for a straight-grid "before" clip.
// Local to the URL that sets it: never use it while several devices play together.
const FEEL = params.get('feel') !== 'off';

// Songs in songs-local/ (gitignored) are loaded before anything starts, so every device that
// joins a "song:<id>" seed knows the song.
try {
  const files = await fetch('/songs-local.json').then((r) => (r.ok ? r.json() : []));
  for (const f of files) {
    try {
      registerSong((await import(`/songs-local/${f}`)).default);
    } catch (err) {
      console.error(`songs-local/${f}:`, err);
      setTimeout(() => log(`could not load songs-local/${esc(f)}: ${esc(err.message)}`), 0);
    }
  }
} catch {}

const songLibraries = {};
const libraryFor = (structure) =>
  structure.song ? (songLibraries[structure.song.id] ||= createLibrary({ packs: SONGS[structure.song.id].loops, builtins: false })) : library;
// Each agent renders and scores this many candidate parts per phrase (Phase 3). A weak device
// does less searching rather than missing the compose deadline.
const CANDIDATE_COUNT = isWeakDevice(navigator) ? CANDIDATES_LITE : CANDIDATES;
const agents = ROLES.map((r) => new Agent(r, library, randomFor(RNG, r), { candidates: CANDIDATE_COUNT, feel: FEEL }));
// ?voice=<role>:<id>[,<role>:<id>]: pin instruments (for measuring a voice's level, or listening to one).
for (const pair of (params.get('voice') || '').split(',').filter(Boolean)) {
  const [role, id] = pair.split(':');
  const agent = agents.find((a) => a.role === role);
  if (agent && VOICES[role]?.some((v) => v.id === id)) agent.pinVoice = id;
}
let realAudio = null;
let tickTimer = null;
// The form (improvising: the upbeat-pop form; songs: none until step E) and the shared hooks.
let form = null;
let formSeed = null; // the seed the hooks belong to
const hookBook = new HookBook();

const swarm = new Swarm({
  localNow,
  signalUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`,
  getPosition: () => engine.position(),
  events: {
    log,
    song: onSong,
    roles: (roles) => {
      const gained = [...roles].filter((r) => !engine.myRoles.has(r));
      engine.myRoles = new Set(roles);
      syncDoubling();
      if (gained.length && engine.myRoles.size > gained.length) log(`now also sounding <b>${gained.join(', ')}</b>`);
      if (gained.length) preloadVoices();
      renderAgents();
    },
    message: (body, origin) => {
      if (body.type === 'proposal') director.onProposal(body);
      else if (body.type === 'endorse') director.onEndorse(body, origin);
      else if (body.type === 'hook') onHook(body, origin);
    },
    welcome: (b) => {
      if (b.direction) director.adoptFromPeer(b.direction);
      for (const h of Array.isArray(b.hooks) ? b.hooks.slice(0, 8) : []) onHook({ ...h, seed: b.hooksSeed }, h.by);
    },
    part: onRemotePart,
    change: renderSwarm,
  },
  welcomeExtra: () => {
    const pos = engine.position();
    return { direction: pos ? director.current(Math.max(0, pos.phrase) + 1) : null, hooks: hookBook.all(), hooksSeed: formSeed };
  },
});

// Jev: typed questions about the shared score, answered through the laptop's relay.
const jev = new Jev({ library, onChange: renderDirection });

// Director: any device may propose a direction for the next section; the swarm votes.
const director = new Director({
  id: swarm.id,
  random: randomFor(RNG, 'director'),
  now: () => swarm.clock.now(),
  publish: (body) => swarm.publish(body),
  liveCount: () => Math.max(1, swarm.liveIds().length),
  request: async (state) => {
    const res = await fetch('/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
    if (!res.ok) throw new Error(`relay answered ${res.status}`);
    return res.json();
  },
  log,
  onChange: renderDirection,
});

// Load the sampled instruments for the parts this device plays first, then the rest.
function preloadVoices() {
  if (!realAudio) return;
  const mine = ROLES.filter((r) => engine.myRoles.has(r));
  const order = [...mine, ...ROLES.filter((r) => !mine.includes(r))];
  const ids = order.flatMap((r) => VOICES[r].filter((v) => !v.synth).map((v) => v.id));
  realAudio.preload(ids);
}

let samplesState = null;
function showSamples({ loaded, loading, failed }) {
  samplesState = { loaded, loading, failed, total: Object.values(VOICES).flat().filter((v) => !v.synth).length };
  const total = Object.values(VOICES).flat().filter((v) => !v.synth).length;
  $('samples').textContent = `instruments ${loaded}/${total}${loading ? ' loading…' : ''}${failed ? ` (${failed} failed)` : ''}`;
}

function syncDoubling() {
  const why = swarm.view().whyMine;
  engine.doubling = new Set(Object.keys(why).filter((r) => why[r] === 'doubling'));
}

// What the director LLM reads: the last few phrases, one line per part.
function describeForDirector(phrase) {
  const section = sectionOf(phrase) + 1;
  const lines = [`Song: ${$('structure').textContent}. You are setting the direction for section ${section + 1} (phrases ${section * SECTION_PHRASES + 1}-${(section + 1) * SECTION_PHRASES}).`];
  if (form) {
    const first = section * SECTION_PHRASES;
    const parts = [];
    for (let p = first; p < first + SECTION_PHRASES; p++) parts.push(`phrase ${p + 1}: ${describeSection(form, p)}`);
    lines.push(`The song has a pop form that sets the energy; your direction nudges it. Coming up: ${parts.join('; ')}.`);
  }
  lines.push(`Current direction: ${describeDirective(director.directiveFor(phrase))}.`);
  for (let p = Math.max(0, phrase - 3); p < phrase; p++) {
    lines.push(`Phrase ${p + 1}:`);
    for (const r of ROLES) lines.push(`- ${r}: ${describePart(summarise(engine.lookup(p, r), r, p))}`);
  }
  return lines.join('\n');
}

const engine = new Engine({
  agents,
  now: () => swarm.clock.now(), // shared swarm time
  // The engine schedules in shared time; Web Audio needs this device's local time.
  audio: {
    play: (role, n, when, dur, voice, sMs) =>
      (SOLO && role !== SOLO ? null : realAudio?.play(role, n, when - swarm.clock.offset, dur, voice, sMs)),
  },
  onEvent,
  onPlan: (phrase, ctxs, deadlineMs) => {
    jev.plan(phrase, ctxs, deadlineMs);
    director.maybePropose(phrase, () => describeForDirector(phrase));
  },
  getAdvice: (phrase, role) => jev.advice(phrase, role),
  // The form leads and the director nudges (form.js); with no form, the director alone.
  getDirective: (phrase) => (form ? formDirective(form, phrase, director.directiveFor(phrase)) : director.directiveFor(phrase)),
  swing: FEEL,
  hooks: hookBook,
  id: swarm.id,
});
engine.myRoles = new Set();

// --- Song: start, join, leave --------------------------------------------------

function showStructure(seed) {
  const s = structureFromSeed(seed);
  $('structure').textContent = `${s.key} ${s.mode} · ${s.bpm} bpm · ${s.progression.join(' – ')}${s.swing ? ` · swing ${s.swing}` : ''}${s.mood ? ` · ${s.mood}` : ''}${s.end ? ' · ends after one pass' : ''}`;
  return s;
}
$('seed').addEventListener('input', () => !swarm.song && showStructure(chosenSeed()));

// Song picker: "improvise" uses the seed; a song fixes key, tempo, chords and parts.
$('song').innerHTML = `<option value="">Improvise (from the seed)</option>` +
  Object.values(SONGS).map((s) => `<option value="${esc(s.id)}">${esc(s.title)} — ${esc(s.composer)}</option>`).join('');
$('song').addEventListener('change', () => {
  if (swarm.song) return;
  $('seed').disabled = !!$('song').value;
  showStructure(chosenSeed());
});
function showSeed(seed) {
  const { base, end } = parseSeed(seed);
  const song = songFromSeed(base);
  $('song').value = song ? song.id : '';
  if (!song) $('seed').value = base;
  if ($('endAfterPass')) $('endAfterPass').checked = end;
}
// What Start plays: the picked song or the seed, with "#end" if "End after one pass" is ticked.
const chosenSeed = () => withEnd($('song').value ? songSeed($('song').value) : $('seed').value.trim() || 'durhack', !!$('endAfterPass')?.checked);
$('endAfterPass')?.addEventListener('change', () => !swarm.song && showStructure(chosenSeed()));
showStructure($('seed').value);

function playSong(song) {
  const structure = showStructure(song.seed);
  form = formFromStructure(structure);
  if (formSeed !== song.seed) hookBook.clear(); // a different song: its hooks are not ours
  formSeed = song.seed;
  showSeed(song.seed);
  const lib = libraryFor(structure);
  for (const a of agents) {
    a.library = lib;
    if (RNG) a.random = randomFor(RNG, a.role); // start the stream again, so a second run repeats the first
  }
  realAudio?.resetMeters();
  jev.library = lib;
  engine.start(structure, song.startMs);
  syncDoubling();
  clearInterval(tickTimer);
  lastTick = 0;
  tickTimer = setInterval(tick, 25);
}

// A device that cannot keep up drops to the lite mix (one reverb, no widener) rather than losing
// time. The engine's own tick is the thing that has to stay punctual, so that is what we measure.
let lastTick = 0;
let lateTicks = 0;
function tick() {
  const now = performance.now();
  if (lastTick) lateTicks = Math.max(0, lateTicks + (now - lastTick > 75 ? 1 : -0.05));
  lastTick = now;
  if (lateTicks > 15 && realAudio?.setLite()) {
    lateTicks = 0;
    log('this device was dropping frames: <b>lite mix</b> (one reverb, no widener)');
  }
  engine.tick();
}

function leaveSong(why = 'left the song (still connected to the swarm)') {
  swarm.leave();
  engine.stop();
  clearInterval(tickTimer);
  log(why);
  updateButton();
}

$('start').addEventListener('click', async () => {
  if (swarm.playing) return leaveSong();
  if (!realAudio) realAudio = await createAudio({ onStatus: showSamples, lite: LITE }); // needs this click
  try { await navigator.wakeLock?.request('screen'); } catch {}
  if (swarm.song) {
    log(`<b>joining</b> "${swarm.song.seed}"`);
    swarm.join();
  } else {
    swarm.startSong(chosenSeed());
    log(`<b>started a new song</b> "${swarm.song.seed}"`);
  }
  playSong(swarm.song);
  preloadVoices();
  updateButton();
});

function onSong(song, reason) {
  log(`song: ${reason}`);
  showSeed(song.seed);
  $('seed').disabled = true;
  $('song').disabled = true;
  showStructure(song.seed);
  if (swarm.playing) playSong(song); // switch to the winning song
  updateButton();
}

function updateButton() {
  const b = $('start');
  if (swarm.playing) {
    b.textContent = 'Leave';
    b.disabled = false;
  } else if (swarm.song) {
    b.textContent = swarm.clock.locked ? 'Join the song' : 'Syncing clock…';
    b.disabled = !swarm.clock.locked;
  } else {
    b.textContent = 'Start a song';
    b.disabled = false;
  }
}

// --- Listening tools: record a clip, read the master meters -------------------------

// The seed of what is playing (or about to), for the clip's file name.
const currentSeed = () => parseSeed(swarm.song?.seed ?? chosenSeed()).base;

const RECORD_SECONDS = 60;

$('record')?.addEventListener('click', async () => {
  const btn = $('record');
  if (!realAudio) return log('press Start first: there is nothing to record yet');
  if (!realAudio.canRecord()) return log('this browser cannot record audio');
  if (realAudio.isRecording()) return;
  const startedAt = new Date();
  const label = btn.textContent;
  let left = RECORD_SECONDS;
  btn.disabled = true;
  btn.textContent = `Recording… ${left}s`;
  const countdown = setInterval(() => (btn.textContent = `Recording… ${Math.max(0, --left)}s`), 1000);
  try {
    const blob = await realAudio.recordClip(RECORD_SECONDS);
    const name = clipName(currentSeed(), startedAt, blob.type);
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    log(`saved <b>${esc(name)}</b> (${Math.round(blob.size / 1024)} kB)`);
  } catch (err) {
    log(`recording failed: ${esc(err.message)}`);
  } finally {
    clearInterval(countdown);
    btn.disabled = false;
    btn.textContent = label;
  }
});

// Dev meters: master peak, an approximate loudness and how often the master went above -0.3 dBFS.
setInterval(() => {
  const el = $('meters');
  if (el && realAudio) el.textContent = describeMeters(realAudio.meters()) + (realAudio.isLite() ? ' · lite mix' : '') + (SOLO ? ` · solo ${SOLO}` : '') + (FEEL ? '' : ' · feel off');
}, 250);

// --- Parts going out and coming in ------------------------------------------------

function onEvent(ev) {
  if (ev.type === 'hook') {
    swarm.publish({ type: 'hook', seed: formSeed, ...ev.hook });
    return log(`the <b>${ev.hook.role}</b> hook is set (phrase ${ev.hook.phrase + 1})`);
  }
  if (ev.type === 'end') return setTimeout(() => swarm.playing && leaveSong('<b>the song ended</b>'), 0);
  if (ev.type !== 'part') return;
  ev.part.by = swarm.id;
  swarm.publishPart(ev.phrase, ev.role, ev.part);
  const reasons = ev.part.notes.length && ev.part.reasons?.length ? ` — ${ev.part.reasons.join('; ')}` : '';
  log(`phrase ${ev.phrase + 1} <span style="color:${COLORS[ev.role]}">${ev.role}</span>: ${esc(ev.part.why)} [${esc(ev.part.source)}]${esc(reasons)}`);
  renderAgents();
  renderDirection();
}

// Notes from another device: keep the fields we use (including the Phase 1 groove fields `nudge`
// and `offsets`) and bound every one of them. See sanitiseNotes in feel.js.
const validNotes = (list) => sanitiseNotes(list);

function onRemotePart(body, origin) {
  if (!engine.structure || !ROLES.includes(body.role) || !Number.isInteger(body.phrase)) return;
  const d = body.d && typeof body.d === 'object' ? body.d : {};
  engine.setRemotePart(body.phrase, body.role, {
    notes: validNotes(body.notes),
    d: { level: Number(d.level) || 0, style: String(d.style ?? ''), register: Number(d.register) || 0, interaction: String(d.interaction ?? 'none'), voice: voiceById[d.voice] ? d.voice : null, voiceSince: Number.isInteger(d.voiceSince) ? d.voiceSince : null },
    by: origin,
    source: String(body.source ?? ''),
    why: `${String(body.why ?? '').slice(0, 120)} · played by ${origin}`,
  });
}

// A hook another device set: keep it if it is for this song (earliest wins, hooks.js).
function onHook(body, origin) {
  if (!body || body.seed !== formSeed) return;
  hookBook.record({ role: body.role, loopId: body.loopId, register: Number(body.register) || 0, phrase: body.phrase, by: origin ?? body.by });
}

// --- Agent cards --------------------------------------------------------------------

function detail(part) {
  if (!part || !part.p) return part?.source ? `decided with ${part.source}` : '';
  const pct = (x) => `${Math.round(x * 100)}%`;
  const fit = part.fit
    ? ` · fit ${pct(part.fit.total)} (${part.rank} of ${part.candidates}: ${Object.entries(part.fit.terms).map(([k, v]) => `${k} ${pct(v)}`).join(', ')})`
    : '';
  return `${part.source} · sure: busy ${pct(part.p.level)}, pattern ${pct(part.p.style)}, react ${pct(part.p.interaction)}${fit}`;
}

function renderDirection() {
  const pos = engine.position();
  const cur = pos ? director.current(Math.max(0, pos.phrase)) : null;
  const d = cur?.directive || DEFAULT_DIRECTIVE;
  const j = jev.stats;
  const sec = form && pos ? describeSection(form, Math.max(0, pos.phrase)) : '';
  $('direction').innerHTML =
    (sec ? `<div>song form: <b>${esc(sec)}</b></div>` : '') +
    `<div><b>${esc(describeDirective(d))}</b>${d.note ? ` — “${esc(d.note)}”` : ''}</div>` +
    `<div class="why">${cur ? `section ${cur.section + 1}, proposed by ${esc(cur.by)} (${esc(cur.source)})${cur.votes ? `, ${cur.votes} votes` : ''}` : 'no direction adopted yet: default'} · director here: ${esc(director.status)}</div>` +
    `<div class="why">Jev: ${esc(j.state)}${j.source ? ` (${esc(j.source)})` : ''} · answered in time ${j.inTime}/${j.asked}${j.late ? `, too late ${j.late}` : ''}${j.failed ? `, failed ${j.failed}` : ''}${j.lastMs != null ? ` · last ${j.lastMs} ms` : ''}</div>`;
}

function renderAgents() {
  const players = swarm.view().players;
  const pos = engine.position();
  const parts = pos ? engine.partsFor(Math.max(0, pos.phrase)) : null;
  const lvl = (a) => (a.auto || !engine.myRoles.has(a.role) ? parts?.[a.role]?.d?.level ?? a.level : a.level);
  $('agents').innerHTML = agents
    .map((a) => {
      const who = players[a.role].map((p) => `${p.id === swarm.id ? 'me' : p.id} (${p.why})`).join(', ') || 'nobody';
      const mine = engine.myRoles.has(a.role);
      return `<div class="agent ${mine ? 'mine' : ''}" data-role="${a.role}">
        <div class="name"><span style="color:${COLORS[a.role]}">${a.role}</span><span class="who">${esc(who)}</span></div>
        <div class="row">
          <label>Busy <input type="range" data-k="level" min="0" max="3" value="${lvl(a)}" ${a.auto || !mine ? 'disabled' : ''}/> ${LEVELS[lvl(a)]}</label>
          <label><input type="checkbox" data-k="auto" ${a.auto ? 'checked' : ''}/> auto</label>
          <label>Instrument <select data-k="voice" ${a.auto || !mine ? 'disabled' : ''}>${VOICES[a.role].map((v) => `<option value="${v.id}" ${(parts?.[a.role]?.d?.voice ?? a.voice) === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
          <label>Reg <select data-k="register">${[-1, 0, 1].map((r) => `<option value="${r}" ${a.register === r ? 'selected' : ''}>${r > 0 ? '+' : ''}${r}</option>`).join('')}</select></label>
        </div>
        <div class="why">${esc(parts?.[a.role]?.why ?? '')}</div>
        <div class="why">${esc(detail(parts?.[a.role]))}</div>
      </div>`;
    })
    .join('');
  const mine = [...engine.myRoles];
  $('meRoles').textContent = swarm.playing ? ` plays ${mine.join(' + ') || 'nothing yet'}` : ' not playing';
}

$('agents').addEventListener('change', (e) => {
  const a = agents.find((x) => x.role === e.target.closest('.agent').dataset.role);
  const k = e.target.dataset.k;
  if (k === 'level') a.level = Number(e.target.value);
  if (k === 'auto') a.auto = e.target.checked;
  if (k === 'register') a.register = Number(e.target.value);
  if (k === 'voice') { a.voice = e.target.value; realAudio?.ensure(a.voice); }
  renderAgents();
});

// --- Swarm panel ----------------------------------------------------------------------

function renderSwarm() {
  const v = swarm.view();
  $('me').textContent = v.id;
  const direct = v.peers.filter((p) => p.direct).length;
  $('net').innerHTML =
    `<span class="dot ${v.server === 'up' ? 'ok' : 'bad'}"></span>server ${v.server} · ` +
    `${direct} direct link${direct === 1 ? '' : 's'} · clock ${v.locked ? `synced, worst ±${Math.round(v.worstErr)} ms` : 'syncing'}`;
  const rows = v.peers
    .map((p) => {
      const s = p.state;
      return `<tr><td>${p.id}</td><td>${p.direct ? 'direct' : 'via gossip'}</td><td>${p.rtt != null ? Math.round(p.rtt) + ' ms' : '–'}</td>
        <td>${p.err != null ? (p.err >= 0 ? '+' : '') + p.err.toFixed(1) + ' ms' : '–'}</td>
        <td>${s?.playing ? 'playing' : s ? 'listening' : '…'}</td><td>${s?.claim?.role ?? '–'}</td><td>${(s?.roles || []).join(' + ') || '–'}</td></tr>`;
    })
    .join('');
  $('peers').innerHTML =
    `<tr><th>device</th><th>link</th><th>round trip</th><th>clock diff</th><th>state</th><th>claim</th><th>sounds</th></tr>` +
    `<tr><td><b>${v.id} (me)</b></td><td>–</td><td>–</td><td>offset ${Math.round(v.offset)} ms</td><td>${swarm.playing ? 'playing' : 'listening'}</td>
      <td>${swarm.claim?.role ?? '–'}</td><td>${[...engine.myRoles].join(' + ') || '–'}</td></tr>` +
    rows;
  updateButton();
  syncDoubling();
  renderAgents();
  renderDirection();
}

fetch('/info').then((r) => r.json()).then((i) => ($('lanUrl').textContent = i.lanUrl)).catch(() => {});

// --- Log ------------------------------------------------------------------------------

function log(html) {
  const t = new Date().toLocaleTimeString();
  $('log').insertAdjacentHTML('afterbegin', `<span>${t}</span> ${html}\n`);
}

// --- MIDI import ------------------------------------------------------------------------

$('mKey').innerHTML = KEYS.map((k) => `<option>${k}</option>`).join('');
$('mFile').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    try {
      const style = $('mStyle').value.trim() || 'pack';
      const loop = await importMidiFile(await file.arrayBuffer(), {
        id: `${$('mRole').value}/${style}/${$('mDensity').value}/${file.name}`,
        role: $('mRole').value,
        style,
        density: $('mDensity').value,
        key: $('mKey').value,
        mode: $('mMode').value,
        progression: $('mProg').value.trim().split(/[\s,–-]+/),
      });
      library.add(loop);
      log(`imported <b>${esc(loop.id)}</b>: ${loop.bars} bar(s), ${loop.events.length} events`);
    } catch (err) {
      log(`import failed for ${esc(file.name)}: ${esc(err.message)}`);
    }
  }
  e.target.value = '';
});

// --- Grid ----------------------------------------------------------------------------------

const canvas = $('grid');
const ctx = canvas.getContext('2d');
const DRUM_Y = { kick: 0.85, snare: 0.55, hat: 0.25, ohat: 0.25, crash: 0.08, riser: 0.08 };

function drawPhrase(parts, y0, h, playhead) {
  const W = canvas.width, dpr = devicePixelRatio;
  const rowH = h / ROLES.length;
  const x = (s) => (s / STEPS_PER_PHRASE) * W;
  ctx.fillStyle = '#12151b';
  ctx.fillRect(0, y0, W, h);
  for (let s = 0; s <= STEPS_PER_PHRASE; s += 4) {
    ctx.fillStyle = s % 16 === 0 ? '#3a4150' : '#21252e';
    ctx.fillRect(Math.round(x(s)), y0, 1, h);
  }
  if (!parts) {
    ctx.fillStyle = '#8a90a0';
    ctx.font = `${14 * dpr}px system-ui`;
    ctx.fillText(swarm.playing ? `decided ${engine.composeAheadBars} bar before it starts` : 'press Start or Join', 12 * dpr, y0 + h / 2);
    return;
  }
  ROLES.forEach((role, i) => {
    const ry = y0 + i * rowH;
    const part = parts[role];
    const mine = engine.myRoles.has(role);
    ctx.fillStyle = mine ? '#c8ccd8' : '#8a90a0';
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.fillText(`${role}${mine ? ' (this device)' : ''} · ${part.why}`, 6 * dpr, ry + 13 * dpr);
    const pitches = part.notes.flatMap((n) => n.midis || (n.midi != null ? [n.midi] : []));
    const lo = Math.min(...pitches), hi = Math.max(...pitches);
    const top = ry + 18 * dpr, span = rowH - 26 * dpr;
    const yOf = (m) => top + (hi === lo ? 0.5 : 1 - (m - lo) / (hi - lo)) * span;
    ctx.fillStyle = COLORS[role];
    ctx.globalAlpha = mine ? 1 : 0.35;
    for (const n of part.notes) {
      const w = Math.max(x(n.dur) - 2, 3);
      const ys = n.drum ? [top + DRUM_Y[n.drum] * span] : (n.midis || [n.midi]).map(yOf);
      for (const y of ys) ctx.fillRect(x(n.step) + 1, y, w, 4 * dpr);
    }
    ctx.globalAlpha = 1;
  });
  if (playhead != null) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(playhead * W), y0, 2 * dpr, h);
  }
}

function frame() {
  const dpr = devicePixelRatio;
  const w = canvas.clientWidth * dpr, h = 380 * dpr;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.clearRect(0, 0, w, h);
  const half = (h - 10 * dpr) / 2;
  const pos = engine.position();
  if (pos && pos.stepFloat >= 0) {
    drawPhrase(engine.partsFor(pos.phrase), 0, half, (pos.stepFloat % STEPS_PER_PHRASE) / STEPS_PER_PHRASE);
    drawPhrase(engine.partsFor(pos.phrase + 1), half + 10 * dpr, half, null);
  } else {
    drawPhrase(null, 0, half, null);
    drawPhrase(null, half + 10 * dpr, half, null);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For tests and debugging in the console.
window.murmuration = {
  swarm, engine, jev, director,
  // Read-only hooks for tools/measure-levels.mjs: the master meters and the sample loading state.
  meters: () => (realAudio ? { ...realAudio.meters(), lite: realAudio.isLite() } : null),
  resetMeters: () => realAudio?.resetMeters(),
  samples: () => samplesState,
};

swarm.start();
renderSwarm();
if (RNG) log(`reproducible run: rng <b>${esc(RNG)}</b> (same seed + rng = same music)`);
if (!FEEL) log('<b>feel off</b>: straight grid, no humanising (A/B on this device only; don\'t play with others like this)');
