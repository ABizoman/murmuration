// Design layer for agent.html. It does not run the band: src/main.js (the same file index.html uses)
// does all of that, unchanged. This file only reads what main.js exposes on window.murmuration to
//   * drive the orb from this device's audio output,
//   * draw the grid aura (fixed playhead, notes sliding right to left),
//   * show a short status, and
//   * turn the prompt box into the same agent settings the agent cards already have.

import { ROLES } from '../loops.js';
import { STEPS_PER_PHRASE } from '../clock.js';
import { Orb } from './orb.js';
import { parseInstruction } from './instructions.js';

const $ = (id) => document.getElementById(id);
// Only touch the DOM when the text really changed: #statusTitle is a live region, and the grid
// caption is reached from the draw loop.
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const mm = () => window.murmuration; // { swarm, engine, jev, director }, set by main.js
const LABELS = { drums: 'Drums', bass: 'Bass', chords: 'Chords', melody: 'Melody' };
const css = getComputedStyle(document.documentElement);
const COLORS = Object.fromEntries(ROLES.map((r) => [r, css.getPropertyValue(`--${r}`).trim()]));
const DRUM_Y = { kick: 0.82, snare: 0.5, hat: 0.18, ohat: 0.18 };

// --- Orb ---------------------------------------------------------------------------------

const orb = new Orb($('orb'));
if (!orb.ok) $('orb').classList.add('no-webgl'); // no WebGL here: the CSS stand-in shows instead
let tapped = false;

// main.js starts Tone.js when Join/Start is pressed. Once it is running, listen to its output.
function tapAudio() {
  const Tone = window.Tone;
  if (tapped || !Tone || Tone.getContext().state !== 'running') return;
  const analyser = Tone.getContext().createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  Tone.getDestination().connect(analyser); // an extra listener on the output; the sound is unchanged
  orb.listen(analyser);
  tapped = true;
}

// --- Status ------------------------------------------------------------------------------

let lastInstruction = null;

function renderStatus() {
  const m = mm();
  if (!m) return;
  const { swarm, engine } = m;
  const playing = swarm.playing;
  document.body.classList.toggle('live', playing);

  const mine = [...engine.myRoles].map((r) => LABELS[r].toLowerCase());
  const list = mine.length === ROLES.length ? 'the whole band'
    : mine.length > 1 ? `${mine.slice(0, -1).join(', ')} and ${mine.at(-1)}` : mine[0];
  let title;
  if (playing) title = list ? `Playing ${list}` : 'Doubling a part';
  else if (swarm.song) title = 'A song is playing';
  else title = 'Ready when you are';
  setText($('statusTitle'), title);

  const others = swarm.view().peers.filter((p) => p.state?.playing).length;
  setText($('statusSub'), playing
    ? `${others ? `with ${others} other device${others === 1 ? '' : 's'}` : 'on your own so far'}`
    : swarm.song ? 'Press Join the song, or tell your agent what to play.' : 'Press Start a song, or tell your agent what to play.');

  const li = $('lastInstruction');
  li.hidden = !lastInstruction;
  if (lastInstruction) {
    setText(li.querySelector('[data-k=text]'), `“${lastInstruction.text}”`);
    setText(li.querySelector('[data-k=summary]'), lastInstruction.summary);
    setText(li.querySelector('[data-k=note]'), lastInstruction.note || '');
    li.title = `${lastInstruction.summary} ${lastInstruction.note || ''}`.trim();
  }
}

// --- Prompt box ----------------------------------------------------------------------------

function press(label) {
  const b = $('start');
  if (!b.disabled && b.textContent.trim() === label) b.click();
}

function send(text) {
  const m = mm();
  const clean = String(text || '').trim();
  if (!m || !clean) return;
  $('prompt').value = '';
  const { swarm, engine } = m;
  const mine = [...engine.myRoles];
  const result = parseInstruction(clean, engine.agents, mine);

  if (result.stop) {
    if (swarm.playing) press('Leave');
    lastInstruction = { text: clean, summary: swarm.playing ? 'Left the song. The others keep playing.' : 'Not playing yet, so there is nothing to leave.' };
    return renderStatus();
  }
  // Same fields the agent cards' sliders and checkboxes set; main.js shows them on its next render.
  for (const { role, set } of result.changes) Object.assign(engine.agents[role], set);

  let note = '';
  const others = mine.length ? result.changes.map((c) => c.role).filter((r) => !mine.includes(r)) : [];
  if (others.length) note = `${others.map((r) => LABELS[r]).join(' and ')} ${others.length > 1 ? 'are' : 'is'} played by another device: your agent follows this if it takes the part over.`;
  lastInstruction = { text: clean, summary: result.summary, note };

  // Not playing yet: the same as pressing the Start / Join button (this runs inside the user's click).
  if (result.understood && !swarm.playing) {
    if ($('start').disabled) lastInstruction.note = 'Still syncing with the band. Press Join the song in a moment.';
    else $('start').click();
  }
  renderStatus();
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send($('prompt').value);
});
$('suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-say]');
  if (b) send(b.dataset.say);
});

// --- Invite ----------------------------------------------------------------------------------

$('inviteBtn').addEventListener('click', () => $('invite').showModal());
$('inviteClose').addEventListener('click', () => $('invite').close());

// --- Grid aura -----------------------------------------------------------------------------
// The playhead stays in the middle; the score slides from right to left through it. Only a
// window around "now" is drawn, fading out at both edges.

const canvas = $('stageGrid');
const g = canvas.getContext('2d');
const firstSeen = new Map(); // `${phrase}:${role}` -> ms, for the notes' entrance animation
const easeOut = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);

function pill(x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
  else g.rect(x, y, w, h);
  g.fill();
}

function drawGrid(now) {
  const m = mm();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  g.clearRect(0, 0, W, H);
  if (!m) return;
  const { engine, swarm } = m;
  const pos = engine.position();
  if (!swarm.playing || !pos || pos.stepFloat < 0) return;

  const play = pos.stepFloat; // global step, continuous
  const visible = cssW < 520 ? 28 : 40; // steps across the whole width
  const pps = W / visible;
  const cx = W / 2;
  const xOf = (gs) => cx + (gs - play) * pps;
  const lo = Math.floor(play - visible / 2) - 1, hi = Math.ceil(play + visible / 2) + 1;

  const laneGap = 8 * dpr;
  const laneH = (H - laneGap * (ROLES.length - 1)) / ROLES.length;
  const phrases = [pos.phrase - 1, pos.phrase, pos.phrase + 1].filter((q) => q >= 0);
  const partsBy = Object.fromEntries(phrases.map((q) => [q, engine.partsFor(q)]));

  // soft glow behind the playhead
  const aura = g.createRadialGradient(cx, H / 2, 0, cx, H / 2, Math.max(W, H) * 0.55);
  aura.addColorStop(0, 'rgba(99,102,241,0.10)');
  aura.addColorStop(1, 'rgba(99,102,241,0)');
  g.fillStyle = aura;
  g.fillRect(0, 0, W, H);

  ROLES.forEach((role, i) => {
    const ly = i * (laneH + laneGap);
    const mine = engine.myRoles.has(role);

    // lane and moving beat lines
    g.fillStyle = mine ? 'rgba(124,58,237,0.06)' : 'rgba(15,18,34,0.035)';
    pill(0, ly, W, laneH, 12 * dpr);
    for (let s = lo; s <= hi; s++) {
      if (s % 4) continue;
      g.fillStyle = s % 64 === 0 ? 'rgba(67,56,202,0.35)' : s % 16 === 0 ? 'rgba(15,18,34,0.12)' : 'rgba(15,18,34,0.05)';
      g.fillRect(Math.round(xOf(s)), ly + 6 * dpr, (s % 64 === 0 ? 2 : 1) * dpr, laneH - 12 * dpr);
    }

    // notes from the previous, current and next phrase, placed on one continuous timeline
    const all = [];
    for (const q of phrases) {
      const part = partsBy[q]?.[role];
      if (!part || part.pending) continue;
      const key = `${q}:${role}`;
      if (!firstSeen.has(key)) firstSeen.set(key, now);
      for (const n of part.notes) all.push({ n, gs: q * STEPS_PER_PHRASE + n.step, born: firstSeen.get(key) });
    }
    if (!all.length) return;
    const pitches = all.flatMap(({ n }) => n.midis || (n.midi != null ? [n.midi] : []));
    const pLo = Math.min(...pitches), pHi = Math.max(...pitches);
    const pad = 8 * dpr;
    const noteH = Math.min(Math.max(laneH * 0.13, 4 * dpr), 9 * dpr);
    const span = laneH - pad * 2 - noteH;
    const yOf = (mid) => ly + pad + (pHi === pLo ? 0.5 : 1 - (mid - pLo) / (pHi - pLo)) * span;

    for (const { n, gs, born } of all) {
      if (gs + n.dur < lo || gs > hi) continue;
      const grow = easeOut((now - born - n.step * 9) / 450);
      if (grow <= 0) continue;
      const active = play >= gs && play < gs + n.dur;
      const passed = play >= gs + n.dur;
      const x = xOf(gs) + 1 * dpr;
      const w = Math.max((n.dur * pps - 2 * dpr) * grow, 3 * dpr);
      const ys = n.drum ? [ly + pad + DRUM_Y[n.drum] * span] : (n.midis || [n.midi]).map(yOf);
      const lift = active ? 2 * dpr : 0;
      g.globalAlpha = (mine ? 1 : 0.4) * (passed ? 0.5 : 1) * grow;
      g.fillStyle = COLORS[role];
      if (active) { g.shadowColor = COLORS[role]; g.shadowBlur = 16 * dpr; }
      for (const y of ys) pill(x, y - lift, w, noteH + lift * 2, noteH);
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
  });

  // fade both edges: everything far from "now" dissolves
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, W, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.22, 'rgba(0,0,0,1)');
  fade.addColorStop(0.78, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  // the playhead: fixed in the middle
  const line = g.createLinearGradient(0, 0, 0, H);
  line.addColorStop(0, 'rgba(67,56,202,0)');
  line.addColorStop(0.12, 'rgba(67,56,202,0.95)');
  line.addColorStop(0.88, 'rgba(67,56,202,0.95)');
  line.addColorStop(1, 'rgba(67,56,202,0)');
  g.shadowColor = 'rgba(67,56,202,0.7)';
  g.shadowBlur = 12 * dpr;
  g.fillStyle = line;
  g.fillRect(cx - 1 * dpr, 0, 2 * dpr, H);
  g.shadowBlur = 0;

  // role labels, small, at the left of each lane
  ROLES.forEach((role, i) => {
    const ly = i * (laneH + laneGap);
    const label = `${LABELS[role]}${engine.myRoles.has(role) ? ' · you' : ''}`;
    g.font = `600 ${10 * dpr}px Inter, system-ui, sans-serif`;
    g.fillStyle = COLORS[role];
    g.globalAlpha = engine.myRoles.has(role) ? 1 : 0.6;
    g.fillText(label, 10 * dpr, ly + 14 * dpr);
    g.globalAlpha = 1;
  });

  setText($('gridCaption'), `Phrase ${pos.phrase + 1} · bar ${pos.bar + 1} · ${$('structure').textContent}`);
  for (const k of firstSeen.keys()) if (Number(k.split(':')[0]) < pos.phrase - 2) firstSeen.delete(k);
}

function frame(t) {
  tapAudio();
  drawGrid(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(renderStatus, 400);
renderStatus();