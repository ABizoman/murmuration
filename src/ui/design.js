// Design layer for index.html. It does not run the band: src/main.js (the same file classic.html
// uses) does all of that, unchanged. This file only reads what main.js exposes on window.murmuration to
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
  analyser.fftSize = 2048; // ~21 Hz per bin: enough to tell a kick from a bassline
  analyser.smoothingTimeConstant = 0.2; // light smoothing, so onsets stay sharp
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

  // main.js fills #samples with the sampled-instrument count. Worth showing while instruments are
  // still arriving or one failed; once they are all in, it is just noise on the stage.
  const sm = $('samples');
  sm.hidden = !/loading|failed/.test(sm.textContent);

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
//
// The music drives the drawing as well as the scroll: every note flashes and throws a shockwave
// down its lane as it crosses the line, each lane glows while its part is busy, the melodic parts
// trail a contour line through their pitches, and the playhead itself breathes with the output
// level the orb is listening to.

const canvas = $('stageGrid');
const g = canvas.getContext('2d');
const firstSeen = new Map(); // `${phrase}:${role}` -> ms, for the notes' entrance animation
const easeOut = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// COLORS come from the CSS variables as hex, and the effects need them at partial alpha.
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const sparks = []; // struck-note debris, flung from the playhead
const rings = []; // shockwave along the lane of a note that just sounded
const energy = Object.fromEntries(ROLES.map((r) => [r, 0])); // how alive each lane looks
let prevPlay = null;
let lastNow = 0;

function pill(x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
  else g.rect(x, y, w, h);
  g.fill();
}

function strike(x, y, role, vel, dpr) {
  // Shockwaves and debris are motion: the lane glow and the swell of the note carry the beat instead.
  if (reduced) return;
  rings.push({ x, y, role, r: 2 * dpr, life: 1, ttl: 0.55 + vel * 0.25 });
  if (rings.length > 24) rings.shift();
  for (let i = 0; i < 2 + Math.round(vel * 3); i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = (40 + Math.random() * 150 * (0.4 + vel)) * dpr;
    sparks.push({
      x, y, role,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.55,
      r: (1.1 + Math.random() * 1.9) * dpr, life: 1, ttl: 0.45 + Math.random() * 0.4,
    });
  }
  if (sparks.length > 180) sparks.splice(0, sparks.length - 180);
}

function drawEffects(dt, dpr) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const k = rings[i];
    k.life -= dt / k.ttl;
    if (k.life <= 0) { rings.splice(i, 1); continue; }
    k.r += dt * 260 * dpr;
    g.strokeStyle = rgba(COLORS[k.role], k.life * k.life * 0.55);
    g.lineWidth = Math.max(1, 2.4 * dpr * k.life);
    g.beginPath();
    g.ellipse(k.x, k.y, k.r * 2.1, k.r, 0, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt / s.ttl;
    if (s.life <= 0) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 90 * dpr * dt; // a little gravity, so they settle into the lane
    s.vx *= 0.97;
    g.fillStyle = rgba(COLORS[s.role], s.life * 0.85);
    g.beginPath();
    g.arc(s.x, s.y, s.r * (0.35 + s.life * 0.65), 0, Math.PI * 2);
    g.fill();
  }
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
  if (!swarm.playing || !pos || pos.stepFloat < 0) {
    prevPlay = null;
    sparks.length = rings.length = 0;
    return;
  }

  const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0;
  lastNow = now;
  const play = pos.stepFloat; // global step, continuous
  // Only fire effects on an ordinary forward step: a backgrounded tab must not dump a whole phrase.
  const live = prevPlay != null && play > prevPlay && play - prevPlay < 4;

  const visible = cssW < 520 ? 28 : 40; // steps across the whole width
  const pps = W / visible;
  const cx = W / 2;
  const xOf = (gs) => cx + (gs - play) * pps;
  const lo = Math.floor(play - visible / 2) - 1, hi = Math.ceil(play + visible / 2) + 1;

  const laneGap = 8 * dpr;
  const laneH = (H - laneGap * (ROLES.length - 1)) / ROLES.length;
  const phrases = [pos.phrase - 1, pos.phrase, pos.phrase + 1].filter((q) => q >= 0);
  const partsBy = Object.fromEntries(phrases.map((q) => [q, engine.partsFor(q)]));

  // How loud this device is right now: the orb is already following the output, so share its ears.
  const lv = orb.level, ht = orb.hit;

  // soft glow behind the playhead, breathing with the sound
  const aura = g.createRadialGradient(cx, H / 2, 0, cx, H / 2, Math.max(W, H) * (0.45 + lv * 0.3));
  aura.addColorStop(0, `rgba(99,102,241,${0.08 + lv * 0.1 + ht * 0.06})`);
  aura.addColorStop(1, 'rgba(99,102,241,0)');
  g.fillStyle = aura;
  g.fillRect(0, 0, W, H);

  // a column of light standing on the line, so "now" reads before you find the playhead
  const col = g.createLinearGradient(cx - pps * 2, 0, cx + pps * 2, 0);
  col.addColorStop(0, 'rgba(67,56,202,0)');
  col.addColorStop(0.5, `rgba(67,56,202,${0.05 + ht * 0.07})`);
  col.addColorStop(1, 'rgba(67,56,202,0)');
  g.fillStyle = col;
  g.fillRect(cx - pps * 2, 0, pps * 4, H);

  ROLES.forEach((role, i) => {
    const ly = i * (laneH + laneGap);
    const mine = engine.myRoles.has(role);
    const dim = mine ? 1 : 0.4;
    energy[role] *= Math.pow(0.1, dt); // the lane's glow fades between notes

    // the lane itself, lit by how much that part is playing
    g.fillStyle = rgba(COLORS[role], (mine ? 0.045 : 0.025) + energy[role] * 0.1 * dim);
    pill(0, ly, W, laneH, 12 * dpr);

    // bars and beats sliding past
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
    all.sort((a, b) => a.gs - b.gs);
    const pitches = all.flatMap(({ n }) => n.midis || (n.midi != null ? [n.midi] : []));
    const pLo = Math.min(...pitches), pHi = Math.max(...pitches);
    const pad = 8 * dpr;
    const noteH = Math.min(Math.max(laneH * 0.13, 4 * dpr), 9 * dpr);
    const span = laneH - pad * 2 - noteH;
    const yOf = (mid) => ly + pad + (pHi === pLo ? 0.5 : 1 - (mid - pLo) / (pHi - pLo)) * span;
    const yFor = (n) => (n.drum ? [ly + pad + DRUM_Y[n.drum] * span] : (n.midis || [n.midi]).map(yOf));

    // the shape of the part: a contour through the pitches, held across each note's length
    if (role !== 'drums' && all.length > 1) { // drums have no pitch to trace
      g.strokeStyle = rgba(COLORS[role], 0.16 * dim);
      g.lineWidth = 1.5 * dpr;
      g.lineJoin = 'round';
      g.beginPath();
      let started = false;
      for (const { n, gs } of all) {
        if (gs + n.dur < lo || gs > hi) continue;
        const y = Math.min(...yFor(n)) + noteH / 2;
        const x = xOf(gs), xe = xOf(gs + n.dur);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
        g.lineTo(xe, y);
      }
      if (started) g.stroke();
    }

    for (const { n, gs, born } of all) {
      if (gs + n.dur < lo || gs > hi) continue;
      const grow = easeOut((now - born - n.step * 9) / 450);
      if (grow <= 0) continue;
      const vel = Math.min(Math.max(n.vel ?? 0.8, 0.2), 1);
      const active = play >= gs && play < gs + n.dur;
      const passed = play >= gs + n.dur;
      const ys = yFor(n);

      // the moment it reaches the line
      if (live && gs > prevPlay && gs <= play) {
        energy[role] = Math.min(1, energy[role] + 0.45 + vel * 0.4);
        if (mine) for (const y of ys.slice(0, 2)) strike(xOf(gs), y + noteH / 2, role, vel, dpr);
      }

      // a struck note swells for a beat and then settles back
      const since = play - gs;
      const punch = active && since >= 0 ? Math.pow(Math.max(0, 1 - since / 2), 2) : 0;
      const x = xOf(gs) + 1 * dpr;
      const w = Math.max((n.dur * pps - 2 * dpr) * grow, 3 * dpr);
      const h = noteH * (1 + punch * 0.9);
      const lift = (h - noteH) / 2;

      g.globalAlpha = dim * (passed ? 0.42 : 0.55 + vel * 0.45) * grow;
      g.fillStyle = COLORS[role];
      if (punch > 0.02) {
        g.shadowColor = COLORS[role];
        g.shadowBlur = (10 + punch * 26) * dpr;
      }
      for (const y of ys) pill(x, y - lift, w, h, h);
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
  });

  drawEffects(dt, dpr);

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

  // the playhead: fixed in the middle, brightening with what this device is sounding
  const bright = Math.min(0.75 + lv * 0.25 + ht * 0.25, 1);
  const line = g.createLinearGradient(0, 0, 0, H);
  line.addColorStop(0, 'rgba(67,56,202,0)');
  line.addColorStop(0.12, `rgba(67,56,202,${bright})`);
  line.addColorStop(0.88, `rgba(67,56,202,${bright})`);
  line.addColorStop(1, 'rgba(67,56,202,0)');
  g.shadowColor = `rgba(67,56,202,${0.5 + ht * 0.4})`;
  g.shadowBlur = (10 + lv * 16 + ht * 22) * dpr;
  g.fillStyle = line;
  const pw = (1.4 + ht * 1.8) * dpr;
  g.fillRect(cx - pw / 2, 0, pw, H);
  g.shadowBlur = 0;

  // role labels, small, at the left of each lane
  ROLES.forEach((role, i) => {
    const ly = i * (laneH + laneGap);
    const label = `${LABELS[role]}${engine.myRoles.has(role) ? ' · you' : ''}`;
    g.font = `600 ${10 * dpr}px Inter, system-ui, sans-serif`;
    g.fillStyle = COLORS[role];
    g.globalAlpha = (engine.myRoles.has(role) ? 1 : 0.6) * (0.75 + energy[role] * 0.25);
    g.fillText(label, 10 * dpr, ly + 14 * dpr);
    g.globalAlpha = 1;
  });

  setText($('gridCaption'), `Phrase ${pos.phrase + 1} · bar ${pos.bar + 1} · ${$('structure').textContent}`);
  for (const k of firstSeen.keys()) if (Number(k.split(':')[0]) < pos.phrase - 2) firstSeen.delete(k);
  prevPlay = play;
}


function frame(t) {
  tapAudio();
  // The orb keeps time even while this device rests, so hand it the beat.
  const pos = mm()?.engine.position();
  orb.beat = mm()?.swarm.playing && pos && pos.stepFloat >= 0 ? (pos.stepFloat % 4) / 4 : -1;
  drawGrid(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(renderStatus, 400);
renderStatus();

// For looking at the reaction in the console, next to main.js's window.murmuration.
window.murmurationUI = { orb, sparks, rings, energy };
