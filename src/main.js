import { KEYS } from './theory.js';
import { structureFromSeed } from './seed.js';
import { localNow, STEPS_PER_PHRASE } from './clock.js';
import { createLibrary, ROLES } from './loops.js';
import { Agent } from './agent.js';
import { Engine } from './engine.js';
import { createAudio } from './audio.js';
import { renderPhrase } from './render.js';
import { importMidiFile } from './midi-import.js';
import { Swarm } from './swarm/swarm.js';

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const COLORS = Object.fromEntries(ROLES.map((r) => [r, css.getPropertyValue(`--${r}`).trim()]));
const LEVELS = ['silent', 'sparse', 'medium', 'busy'];
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const library = createLibrary();
const agents = ROLES.map((r) => new Agent(r, library));
let realAudio = null;
let tickTimer = null;

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
      // Taking a part over mid-phrase: tell everyone what we'll play for the phrases already composed.
      for (const [phrase, entry] of engine.phrases) for (const r of gained) swarm.publishPart(phrase, r, entry.local[r]);
      if (gained.length) log(`now also sounding <b>${gained.join(', ')}</b>`);
      renderAgents();
    },
    part: onRemotePart,
    change: renderSwarm,
  },
});

const engine = new Engine({
  agents,
  now: () => swarm.clock.now(), // shared swarm time
  // The engine schedules in shared time; Web Audio needs this device's local time.
  audio: { play: (role, n, when, dur) => realAudio?.play(role, n, when - swarm.clock.offset, dur) },
  onEvent,
});
engine.myRoles = new Set();

// --- Song: start, join, leave --------------------------------------------------

function showStructure(seed) {
  const s = structureFromSeed(seed);
  $('structure').textContent = `${s.key} ${s.mode} · ${s.bpm} bpm · ${s.progression.join(' – ')}`;
  return s;
}
$('seed').addEventListener('input', () => !swarm.song && showStructure($('seed').value));
showStructure($('seed').value);

function playSong(song) {
  const structure = showStructure(song.seed);
  $('seed').value = song.seed;
  engine.start(structure, song.startMs);
  clearInterval(tickTimer);
  tickTimer = setInterval(() => engine.tick(), 25);
}

$('start').addEventListener('click', async () => {
  if (swarm.playing) {
    swarm.leave();
    engine.stop();
    clearInterval(tickTimer);
    log('left the song (still connected to the swarm)');
    return updateButton();
  }
  if (!realAudio) realAudio = await createAudio(); // needs this click
  try { await navigator.wakeLock?.request('screen'); } catch {}
  if (swarm.song) {
    log(`<b>joining</b> "${swarm.song.seed}"`);
    swarm.join();
  } else {
    swarm.startSong($('seed').value.trim() || 'durhack');
    log(`<b>started a new song</b> "${swarm.song.seed}"`);
  }
  playSong(swarm.song);
  updateButton();
});

function onSong(song, reason) {
  log(`song: ${reason}`);
  $('seed').value = song.seed;
  $('seed').disabled = true;
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

// --- Parts going out and coming in ------------------------------------------------

function onEvent(ev) {
  if (ev.type !== 'composed') return;
  for (const role of ev.mine) swarm.publishPart(ev.phrase, role, ev.parts[role]);
  renderAgents();
}

function onRemotePart(body, origin) {
  if (!engine.structure) return;
  let part;
  const loop = body.loopId && library.loops.find((l) => l.id === body.loopId);
  if (!body.loopId) part = { notes: [], why: `${body.why} · ${origin}` };
  else if (!loop) part = { notes: [], why: `${body.loopId} (not in my library) · ${origin}` };
  else {
    const { notes } = renderPhrase(loop, { structure: engine.structure, phrase: body.phrase, register: body.register || 0 });
    part = { notes, loop, why: `${body.loopId} · played by ${origin}` };
  }
  engine.setRemotePart(body.phrase, body.role, part);
}

// --- Agent cards --------------------------------------------------------------------

function renderAgents() {
  const players = swarm.view().players;
  const pos = engine.position();
  const parts = pos ? engine.partsFor(Math.max(0, pos.phrase)) : null;
  $('agents').innerHTML = agents
    .map((a) => {
      const who = players[a.role].map((p) => `${p.id === swarm.id ? 'me' : p.id} (${p.why})`).join(', ') || 'nobody';
      const mine = engine.myRoles.has(a.role);
      return `<div class="agent ${mine ? 'mine' : ''}" data-role="${a.role}">
        <div class="name"><span style="color:${COLORS[a.role]}">${a.role}</span><span class="who">${esc(who)}</span></div>
        <div class="row">
          <label>Busy <input type="range" data-k="level" min="0" max="3" value="${a.level}" ${a.auto ? 'disabled' : ''}/> ${LEVELS[a.level]}</label>
          <label><input type="checkbox" data-k="auto" ${a.auto ? 'checked' : ''}/> auto</label>
          <label>Reg <select data-k="register">${[-1, 0, 1].map((r) => `<option value="${r}" ${a.register === r ? 'selected' : ''}>${r > 0 ? '+' : ''}${r}</option>`).join('')}</select></label>
        </div>
        <div class="why">${esc(parts?.[a.role]?.why ?? '')}</div>
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
  renderAgents();
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
const DRUM_Y = { kick: 0.85, snare: 0.55, hat: 0.25, ohat: 0.25 };

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
    ctx.fillText(swarm.playing ? `composed ${engine.composeAheadBars} bar before it starts` : 'press Start or Join', 12 * dpr, y0 + h / 2);
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
window.murmuration = { swarm, engine };

swarm.start();
renderSwarm();
