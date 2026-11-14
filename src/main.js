import { KEYS } from './theory.js';
import { structureFromSeed } from './seed.js';
import { localNow, STEPS_PER_PHRASE } from './clock.js';
import { createLibrary, ROLES } from './loops.js';
import { Agent } from './agent.js';
import { Engine } from './engine.js';
import { createAudio } from './audio.js';
import { importMidiFile } from './midi-import.js';

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const COLORS = Object.fromEntries(ROLES.map((r) => [r, css.getPropertyValue(`--${r}`).trim()]));
const LEVELS = ['silent', 'sparse', 'medium', 'busy'];

const library = createLibrary();
const agents = ROLES.map((r) => new Agent(r, library));
const engine = new Engine({ agents, audio: null, now: localNow, onEvent });

// --- Header -----------------------------------------------------------------

function showStructure() {
  const s = structureFromSeed($('seed').value);
  $('structure').textContent = `${s.key} ${s.mode} · ${s.bpm} bpm · ${s.progression.join(' – ')}`;
  return s;
}
$('seed').addEventListener('input', () => {
  showStructure();
  if (timer) log('seed changed: press Stop then Start to play the new structure');
});
showStructure();

$('ahead').addEventListener('change', () => (engine.composeAheadBars = Number($('ahead').value)));
$('auto').addEventListener('change', () => {
  for (const a of agents) a.auto = $('auto').checked;
  renderAgents();
});

let timer = null;
let wakeLock = null;
$('start').addEventListener('click', async () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    engine.stop();
    wakeLock?.release?.();
    $('start').textContent = 'Start';
    $('status').textContent = 'stopped';
    return;
  }
  if (!engine.audio) engine.audio = await createAudio();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  const structure = showStructure();
  $('log').innerHTML = '';
  engine.composeAheadBars = Number($('ahead').value);
  engine.start(structure, localNow() + 300);
  log(`<b>start</b> · ${$('structure').textContent} · start time ${Math.round(engine.startMs)}`);
  timer = setInterval(() => engine.tick(), 25);
  $('start').textContent = 'Stop';
});

// --- Agent cards ----------------------------------------------------------------

function renderAgents() {
  $('agents').innerHTML = agents
    .map(
      (a) => `<div class="agent" data-role="${a.role}">
        <div class="name"><span style="color:${COLORS[a.role]}">${a.role}</span>
          <label><input type="checkbox" data-k="mine" ${engine.myRoles.has(a.role) ? 'checked' : ''}/> plays here</label></div>
        <div class="row">
          <label>Busy <input type="range" data-k="level" min="0" max="3" value="${a.level}" ${a.auto ? 'disabled' : ''}/>
            <span data-k="levelName">${LEVELS[a.level]}</span></label>
          <label>Register <select data-k="register">
            ${[-1, 0, 1].map((r) => `<option value="${r}" ${a.register === r ? 'selected' : ''}>${r > 0 ? '+' : ''}${r}</option>`).join('')}
          </select></label>
        </div>
        <div class="why" data-k="why"></div>
      </div>`,
    )
    .join('');
}
renderAgents();

$('agents').addEventListener('input', (e) => {
  const card = e.target.closest('.agent');
  const a = agents.find((x) => x.role === card.dataset.role);
  const k = e.target.dataset.k;
  if (k === 'mine') e.target.checked ? engine.myRoles.add(a.role) : engine.myRoles.delete(a.role);
  if (k === 'level') {
    a.level = Number(e.target.value);
    card.querySelector('[data-k=levelName]').textContent = LEVELS[a.level];
  }
  if (k === 'register') a.register = Number(e.target.value);
});

function updateCard(role, why) {
  const card = document.querySelector(`.agent[data-role=${role}]`);
  const a = agents.find((x) => x.role === role);
  card.querySelector('[data-k=why]').textContent = why;
  card.querySelector('[data-k=level]').value = a.level;
  card.querySelector('[data-k=levelName]').textContent = LEVELS[a.level];
}

// --- MIDI import --------------------------------------------------------------

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
      log(`imported <b>${loop.id}</b>: ${loop.bars} bar(s), ${loop.events.length} events`);
    } catch (err) {
      log(`import failed for ${file.name}: ${err.message}`);
    }
  }
  e.target.value = '';
});

// --- Log ----------------------------------------------------------------------

function log(html) {
  $('log').insertAdjacentHTML('afterbegin', html + '\n');
}

function onEvent(ev) {
  if (ev.type !== 'composed') return;
  for (const [role, p] of Object.entries(ev.parts)) updateCard(role, `phrase ${ev.phrase}: ${p.why}`);
  const lines = Object.entries(ev.parts).map(([r, p]) => `  <span style="color:${COLORS[r]}">${r.padEnd(6)}</span> ${p.why}`);
  log(`<b>composed phrase ${ev.phrase}</b>, starts in ${Math.round(ev.startsInMs)} ms\n${lines.join('\n')}`);
}

// --- Grid -----------------------------------------------------------------------

const canvas = $('grid');
const ctx = canvas.getContext('2d');
const DRUM_Y = { kick: 0.85, snare: 0.55, hat: 0.25, ohat: 0.25 };

function drawPhrase(entry, y0, h, playhead) {
  const W = canvas.width, dpr = devicePixelRatio;
  const rowH = h / ROLES.length;
  const x = (s) => (s / STEPS_PER_PHRASE) * W;
  ctx.fillStyle = '#12151b';
  ctx.fillRect(0, y0, W, h);
  for (let s = 0; s <= STEPS_PER_PHRASE; s += 4) {
    ctx.fillStyle = s % 16 === 0 ? '#3a4150' : '#21252e';
    ctx.fillRect(Math.round(x(s)), y0, 1, h);
  }
  if (!entry) {
    ctx.fillStyle = '#8a90a0';
    ctx.font = `${14 * dpr}px system-ui`;
    ctx.fillText('not composed yet: the agents will write it before the playhead gets here', 12 * dpr, y0 + h / 2);
    return;
  }
  ROLES.forEach((role, i) => {
    const ry = y0 + i * rowH;
    const part = entry.parts[role];
    ctx.fillStyle = '#8a90a0';
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.fillText(`${role} · ${part.why}`, 6 * dpr, ry + 13 * dpr);
    const pitches = part.notes.flatMap((n) => n.midis || (n.midi != null ? [n.midi] : []));
    const lo = Math.min(...pitches), hi = Math.max(...pitches);
    const top = ry + 18 * dpr, span = rowH - 26 * dpr;
    const yOf = (m) => top + (hi === lo ? 0.5 : 1 - (m - lo) / (hi - lo)) * span;
    ctx.fillStyle = COLORS[role];
    ctx.globalAlpha = engine.myRoles.has(role) ? 1 : 0.25;
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
    drawPhrase(engine.phrases.get(pos.phrase), 0, half, (pos.stepFloat % STEPS_PER_PHRASE) / STEPS_PER_PHRASE);
    drawPhrase(engine.phrases.get(pos.phrase + 1), half + 10 * dpr, half, null);
    $('status').textContent = `phrase ${pos.phrase} · bar ${pos.bar + 1} · step ${pos.step + 1}`;
  } else {
    drawPhrase(null, 0, half, null);
    drawPhrase(null, half + 10 * dpr, half, null);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
