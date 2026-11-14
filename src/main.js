import { KEYS } from './theory.js';
import { structureFromSeed } from './seed.js';
import { localNow, STEPS_PER_PHRASE } from './clock.js';
import { createLibrary, ROLES } from './loops.js';
import { Agent } from './agent.js';
import { Engine } from './engine.js';
import { createAudio } from './audio.js';
import { importMidiFile } from './midi-import.js';
import { Swarm } from './swarm/swarm.js';
import { Jev } from './decide/jev.js';
import { Director, sectionOf, SECTION_PHRASES } from './decide/director.js';
import { describeDirective, DEFAULT_DIRECTIVE } from './decide/directive.js';
import { summarise, describePart } from './decide/context.js';

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
      syncDoubling();
      if (gained.length && engine.myRoles.size > gained.length) log(`now also sounding <b>${gained.join(', ')}</b>`);
      renderAgents();
    },
    message: (body, origin) => {
      if (body.type === 'proposal') director.onProposal(body);
      else if (body.type === 'endorse') director.onEndorse(body, origin);
    },
    welcome: (b) => b.direction && director.adoptFromPeer(b.direction),
    part: onRemotePart,
    change: renderSwarm,
  },
  welcomeExtra: () => {
    const pos = engine.position();
    return { direction: pos ? director.current(Math.max(0, pos.phrase) + 1) : null };
  },
});

// Jev: typed questions about the shared score, answered through the laptop's relay.
const jev = new Jev({ library, onChange: renderDirection });

// Director: any device may propose a direction for the next section; the swarm votes.
const director = new Director({
  id: swarm.id,
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

function syncDoubling() {
  const why = swarm.view().whyMine;
  engine.doubling = new Set(Object.keys(why).filter((r) => why[r] === 'doubling'));
}

// What the director LLM reads: the last few phrases, one line per part.
function describeForDirector(phrase) {
  const section = sectionOf(phrase) + 1;
  const lines = [`Song: ${$('structure').textContent}. You are setting the direction for section ${section + 1} (phrases ${section * SECTION_PHRASES + 1}-${(section + 1) * SECTION_PHRASES}).`];
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
  audio: { play: (role, n, when, dur) => realAudio?.play(role, n, when - swarm.clock.offset, dur) },
  onEvent,
  onPlan: (phrase, ctxs, deadlineMs) => {
    jev.plan(phrase, ctxs, deadlineMs);
    director.maybePropose(phrase, () => describeForDirector(phrase));
  },
  getAdvice: (phrase, role) => jev.advice(phrase, role),
  getDirective: (phrase) => director.directiveFor(phrase),
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
  syncDoubling();
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
  if (ev.type !== 'part') return;
  ev.part.by = swarm.id;
  swarm.publishPart(ev.phrase, ev.role, ev.part);
  const reasons = ev.part.notes.length && ev.part.reasons?.length ? ` — ${ev.part.reasons.join('; ')}` : '';
  log(`phrase ${ev.phrase + 1} <span style="color:${COLORS[ev.role]}">${ev.role}</span>: ${esc(ev.part.why)} [${esc(ev.part.source)}]${esc(reasons)}`);
  renderAgents();
}

function validNotes(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 400).filter((n) => n && Number.isInteger(n.step) && n.step >= 0 && n.step < 64 && n.dur > 0 &&
    (typeof n.drum === 'string' || Number.isFinite(n.midi) || (Array.isArray(n.midis) && n.midis.every(Number.isFinite))));
}

function onRemotePart(body, origin) {
  if (!engine.structure || !ROLES.includes(body.role) || !Number.isInteger(body.phrase)) return;
  const d = body.d && typeof body.d === 'object' ? body.d : {};
  engine.setRemotePart(body.phrase, body.role, {
    notes: validNotes(body.notes),
    d: { level: Number(d.level) || 0, style: String(d.style ?? ''), register: Number(d.register) || 0, interaction: String(d.interaction ?? 'none') },
    by: origin,
    source: String(body.source ?? ''),
    why: `${String(body.why ?? '').slice(0, 120)} · played by ${origin}`,
  });
}

// --- Agent cards --------------------------------------------------------------------

function detail(part) {
  if (!part || !part.p) return part?.source ? `decided with ${part.source}` : '';
  const pct = (x) => `${Math.round(x * 100)}%`;
  return `${part.source} · sure: busy ${pct(part.p.level)}, pattern ${pct(part.p.style)}, react ${pct(part.p.interaction)}`;
}

function renderDirection() {
  const pos = engine.position();
  const cur = pos ? director.current(Math.max(0, pos.phrase)) : null;
  const d = cur?.directive || DEFAULT_DIRECTIVE;
  const j = jev.stats;
  $('direction').innerHTML =
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
window.murmuration = { swarm, engine, jev, director };

swarm.start();
renderSwarm();
