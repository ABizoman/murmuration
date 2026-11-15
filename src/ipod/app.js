// Murmuration, iPod edition: the design layer for index.html.
//
// src/main.js runs the band exactly as it does for classic.html (swarm, clock, agents, Jev,
// director, audio, songs). This file only reads window.murmuration and:
//   * draws the screen: a dusk sky with a starling murmuration that the music moves,
//   * turns the click wheel into agent settings (turn = busier / calmer, ◀◀ ▶▶ = lower / higher,
//     ❚❚ = take a break / come back, top = menu; the centre is main.js's own Start/Join/Leave button),
//   * shows the tempo knob, your instrument and the devices in the room,
//   * passes typed instructions to the agents (same parser as before).

import { ROLES } from '../loops.js';
import { STEPS_PER_PHRASE } from '../clock.js';
import { structureFromSeed } from '../seed.js';
import { voiceById } from '../voices.js';
import { parseInstruction, LEVEL_NAMES } from '../ui/instructions.js';
import { Flock, textPoints } from '../live/flock.js';

const $ = (id) => document.getElementById(id);
const mm = () => window.murmuration;
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const LABELS = { drums: 'Drums', bass: 'Bass', chords: 'Chords', melody: 'Melody', pad: 'Pad', arp: 'Arpeggio', perc: 'Percussion' };
const css = getComputedStyle(document.documentElement);
const COLORS = ROLES.map((r) => css.getPropertyValue(`--${r}`).trim());
const RI = Object.fromEntries(ROLES.map((r, i) => [r, i]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SERIF = (px) => `italic 400 ${px}px "Instrument Serif", Georgia, serif`;
const STEPS_PER_BAR = 16;

// line icons for the instrument tile
const ICONS = {
  drums: '<svg viewBox="0 0 32 32" fill="none" stroke="#4A4A52" stroke-width="1.8" stroke-linecap="round"><ellipse cx="16" cy="12" rx="10" ry="4"/><path d="M6 12v9c0 2.2 4.5 4 10 4s10-1.8 10-4v-9"/><path d="M9 4l5 6M23 4l-5 6"/></svg>',
  bass: '<svg viewBox="0 0 32 32" fill="none" stroke="#4A4A52" stroke-width="1.8" stroke-linecap="round"><path d="M3 16c3-8 5-8 7 0s4 8 6 0 4-8 6 0 4 8 7 0"/></svg>',
  chords: '<svg viewBox="0 0 32 32" fill="none" stroke="#4A4A52" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="7" width="24" height="18" rx="2"/><path d="M10 7v18M16 7v18M22 7v18"/><path d="M8 7h4v10H8zM14 7h4v10h-4zM20 7h4v10h-4z" fill="#4A4A52"/></svg>',
  melody: '<svg viewBox="0 0 32 32" fill="none" stroke="#4A4A52" stroke-width="1.8" stroke-linecap="round"><path d="M12 23V7l13-3v16"/><circle cx="9" cy="23" r="3.2"/><circle cx="22" cy="20" r="3.2"/></svg>',
  none: '<svg viewBox="0 0 32 32" fill="none" stroke="#B9B9C0" stroke-width="1.8" stroke-dasharray="3 3"><circle cx="16" cy="16" r="10"/></svg>',
};

// --- Screen: sky + flock ------------------------------------------------------------------------
const SKIES = [
  [[24, 20, 56], [92, 50, 108], [238, 128, 106], [255, 214, 172]], // plum dusk
  [[34, 26, 70], [146, 68, 122], [250, 150, 142], [255, 228, 204]], // rose
  [[26, 24, 50], [118, 58, 80], [246, 140, 72], [255, 206, 132]], // amber
  [[12, 28, 52], [40, 88, 122], [118, 170, 182], [232, 222, 192]], // sea
];
const sky = SKIES[3].map((c) => c.slice()); // always the blue "sea" sky
const skyTarget = 3;
let seedHash = 0;
const lerp = (a, b, k) => a + (b - a) * k;
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

const canvas = $('sky');
const g = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 1, flock = null;
const stars = Array.from({ length: 80 }, () => [Math.random(), Math.random() * 0.45, Math.random() * 7]);

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  W = Math.round(w * DPR);
  H = Math.round(h * DPR);
  canvas.width = W;
  canvas.height = H;
  S = DPR * Math.max(0.7, Math.min(1.2, Math.min(w, h) / 600));
  if (!flock) flock = new Flock(reduced ? 400 : w < 600 ? 900 : 1400, W, H, S);
  else { flock.scale = S; flock.resize(W, H); }
}
new ResizeObserver(resize).observe(canvas);
resize();

// --- Audio tap (read-only listener on the output) ----------------------------------------------
let analyser = null, td = null, fd = null, level = 0, low = 0;
function tapAudio() {
  const Tone = window.Tone;
  if (analyser || !Tone || Tone.getContext().state !== 'running') return;
  analyser = Tone.getContext().createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.25;
  Tone.getDestination().connect(analyser);
  td = new Float32Array(analyser.fftSize);
  fd = new Uint8Array(analyser.frequencyBinCount);
}
function readAudio() {
  let L = 0, B = 0;
  if (analyser && analyser.context.state === 'running') {
    analyser.getFloatTimeDomainData(td);
    let sum = 0;
    for (let i = 0; i < td.length; i += 2) sum += td[i] * td[i];
    L = Math.min(1, Math.sqrt(sum / (td.length / 2)) * 4.5);
    analyser.getByteFrequencyData(fd);
    let lo = 0;
    for (let j = 1; j < 8; j++) lo += fd[j];
    B = Math.min(1, lo / 7 / 255);
  }
  level += (L - level) * (L > level ? 0.35 : 0.06);
  low += (B - low) * (B > low ? 0.5 : 0.1);
}

// --- Sparks and rings ---------------------------------------------------------------------------
const sparks = [], rings = [];
function spark(x, y, vx, vy, color, size, life) {
  if (sparks.length > 240) sparks.shift();
  sparks.push({ x, y, vx, vy, color, size, life, age: 0 });
}
function drawFx(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.age += dt;
    if (r.age > r.life) { rings.splice(i, 1); continue; }
    const k = r.age / r.life;
    g.strokeStyle = `rgba(255,244,230,${0.35 * (1 - k)})`;
    g.lineWidth = (2.2 - 1.8 * k) * S;
    g.beginPath(); g.ellipse(r.x, r.y, r.max * k, r.max * k * 0.62, 0, 0, 7); g.stroke();
  }
  g.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.age += dt;
    if (p.age > p.life) { sparks.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy = p.vy * 0.985 - 6 * S * dt;
    const k = 1 - p.age / p.life;
    g.fillStyle = p.color;
    g.globalAlpha = 0.18 * k; g.beginPath(); g.arc(p.x, p.y, p.size * 3 * S, 0, 7); g.fill();
    g.globalAlpha = 0.95 * k; g.beginPath(); g.arc(p.x, p.y, p.size * S, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

// --- Notes as the playhead crosses them ---------------------------------------------------------
let lastStep = null;
const byStepCache = new Map();
function notesAt(engine, gstep) {
  const phrase = Math.floor(gstep / STEPS_PER_PHRASE), s = gstep - phrase * STEPS_PER_PHRASE;
  const parts = engine.partsFor(phrase);
  if (!parts) return [];
  const out = [];
  for (const role of ROLES) {
    const part = parts[role];
    if (!part || part.pending || !part.notes?.length) continue;
    const key = `${phrase}:${role}`;
    let c = byStepCache.get(key);
    if (!c || c.ref !== part.notes) {
      const map = new Map();
      for (const n of part.notes) { if (!map.has(n.step)) map.set(n.step, []); map.get(n.step).push(n); }
      c = { ref: part.notes, map };
      byStepCache.set(key, c);
    }
    for (const n of c.map.get(s) || []) out.push({ role, n });
  }
  if (byStepCache.size > 40) for (const k of byStepCache.keys()) if (Number(k.split(':')[0]) < phrase - 2) byStepCache.delete(k);
  return out;
}

let sunKick = 0, bassDrop = 0, chordGlow = 0;
function onNote(role, n, mine, now) {
  const [cx, cy] = flock.centroid();
  const amp = mine ? 1 : 0.55, ri = RI[role];
  if (role === 'drums') {
    if (n.drum === 'kick') {
      flock.impulse(cx, cy, 170 * S * amp, Math.min(W, H) * 0.45);
      rings.push({ x: cx, y: cy, age: 0, life: 0.8, max: Math.min(W, H) * 0.45 });
      sunKick = 1;
    } else if (n.drum === 'snare') { flock.scatter(0.22 * amp, 110 * S); flock.light(ri, 0.05 * amp, 260, now); }
    else if (n.drum === 'crash') { flock.scatter(0.4 * amp, 160 * S); flock.light(ri, 0.1 * amp, 900, now); sunKick = 1; } // a section starts
    else flock.light(ri, 0.02 * amp, 160, now);
  } else if (role === 'bass') { bassDrop = Math.min(1, bassDrop + 0.5 * amp); flock.light(ri, 0.04 * amp, 380, now); }
  else if (role === 'chords') { flock.light(ri, 0.12 * amp, 700, now); chordGlow = 1; }
  else if (role === 'pad') { flock.light(ri, 0.06 * amp, 1400, now); chordGlow = Math.max(chordGlow, 0.5); } // a slow glow
  else if (role === 'perc') flock.light(ri, 0.015 * amp, 120, now); // a shimmer
  else if (role === 'arp') {
    const pitch = n.midi ?? 64;
    const y = H * (0.75 - Math.min(1, Math.max(0, (pitch - 50) / 36)) * 0.6);
    spark(cx + (Math.random() - 0.5) * 40 * S, cy + (Math.random() - 0.5) * 40 * S, (30 + Math.random() * 60) * S, (y - cy) * 0.3, COLORS[ri], 1, 0.8);
  }
  else if (role === 'melody') {
    const pitch = n.midi ?? (n.midis ? n.midis[0] : 72);
    const y = H * (0.75 - Math.min(1, Math.max(0, (pitch - 55) / 36)) * 0.6);
    for (let k = 0; k < (mine ? 6 : 3); k++) {
      spark(cx + (Math.random() - 0.5) * 24 * S, cy + (Math.random() - 0.5) * 24 * S,
        (50 + Math.random() * 100) * S, (y - cy) * (0.4 + Math.random() * 0.4), COLORS[ri], 1.4 + Math.random() * 1.5, 1.3 + Math.random());
    }
  }
}

// --- Frame ----------------------------------------------------------------------------------------
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (!flock || !W) return;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tapAudio();
  readAudio();
  const m = mm();
  const playing = !!m?.swarm.playing;
  const pos = playing ? m.engine.position() : null;

  for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) sky[i][c] = lerp(sky[i][c], SKIES[skyTarget][i][c], dt * 0.6);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, rgb(sky[0])); grad.addColorStop(0.42, rgb(sky[1])); grad.addColorStop(0.76, rgb(sky[2])); grad.addColorStop(1, rgb(sky[3]));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#FFF6E8';
  for (const [sx, sy, ph] of stars) { g.globalAlpha = 0.25 + 0.25 * Math.sin(now * 0.0012 + ph); g.fillRect(sx * W, sy * H, 1.2 * DPR, 1.2 * DPR); }
  g.globalAlpha = 1;

  sunKick *= Math.pow(0.02, dt);
  chordGlow *= Math.pow(0.15, dt);
  const sr = Math.min(W, H) * (0.18 + 0.05 * low + 0.03 * sunKick);
  g.globalCompositeOperation = 'lighter';
  const sun = g.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, sr * 3);
  sun.addColorStop(0, `rgba(255,236,200,${0.5 + 0.3 * sunKick})`);
  sun.addColorStop(0.25, `rgba(255,190,140,${0.2 + 0.15 * low})`);
  sun.addColorStop(1, 'rgba(255,160,120,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  if (chordGlow > 0.01) {
    const cg = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.6);
    cg.addColorStop(0, `rgba(199,139,255,${0.12 * chordGlow})`);
    cg.addColorStop(1, 'rgba(199,139,255,0)');
    g.fillStyle = cg;
    g.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';

  bassDrop *= Math.pow(0.2, dt);
  const tt = now / 1000;
  const ax = W * (0.5 + 0.2 * Math.sin(tt * 0.23) * (playing ? 1 : 0.6));
  const ay = H * ((playing ? 0.27 : 0.3) + 0.06 * Math.sin(tt * 0.46) + 0.04 * bassDrop);

  if (pos && pos.stepFloat >= 0) {
    const cur = Math.floor(pos.stepFloat);
    if (lastStep === null || cur < lastStep || cur - lastStep > 8) lastStep = cur - 1;
    for (let s = lastStep + 1; s <= cur; s++) {
      for (const { role, n } of notesAt(m.engine, s)) onNote(role, n, m.engine.myRoles.has(role), now);
      if (s % 4 === 0) beat();
    }
    lastStep = cur;
    // tempo knob: the dot goes round once per bar
    const a = ((pos.stepFloat % STEPS_PER_BAR) / STEPS_PER_BAR) * Math.PI * 2 - Math.PI / 2;
    const r = knob.clientWidth * 0.36;
    knobDot.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`;
    // phrase progress
    progressFill.style.width = `${((pos.stepFloat % STEPS_PER_PHRASE) / STEPS_PER_PHRASE) * 100}%`;
  } else {
    lastStep = null;
    const r = knob.clientWidth * 0.36;
    knobDot.style.transform = `translate(${Math.cos(-0.8) * r}px, ${Math.sin(-0.8) * r}px)`;
  }

  flock.step(dt, { ax, ay, energy: playing ? 0.25 + level * 0.9 : 0.2, tight: playing ? 0.35 + level * 0.6 : 0.6 });
  flock.draw(g, '16,10,28', COLORS, now);
  drawFx(dt);
}
const knob = $('knob'), knobDot = $('knobDot'), progressFill = $('progressFill');

function beat() {
  knob.classList.remove('beat');
  void knob.offsetWidth;
  knob.classList.add('beat');
}

// --- Words in the sky ---------------------------------------------------------------------------
let releaseTimer = null;
function skyWrite(text, holdMs, burst = 240) {
  if (reduced || !flock) return;
  const box = { x: W * 0.06, y: H * 0.13, w: W * 0.88, h: Math.min(H * 0.16, W * 0.3) };
  const pts = textPoints(text, SERIF, box, Math.floor(flock.n * 0.85));
  if (!pts.length) return;
  flock.form(pts);
  clearTimeout(releaseTimer);
  if (holdMs) releaseTimer = setTimeout(() => flock.release(burst * S), holdMs);
}

// --- Applying a change to this device's agents ---------------------------------------------------
let lastInstruction = null;
function apply(text, { write = false, hud = true } = {}) {
  const m = mm();
  if (!m) return null;
  const { swarm, engine } = m;
  const mine = [...engine.myRoles];
  const result = parseInstruction(text, engine.agents, mine);
  if (result.stop) {
    if (swarm.playing && !$('start').disabled) $('start').click();
    lastInstruction = { text, summary: swarm.playing ? 'left the song' : 'nothing to leave yet' };
    return result;
  }
  for (const { role, set } of result.changes) Object.assign(engine.agents[role], set);
  const others = mine.length ? result.changes.map((c) => c.role).filter((r) => !mine.includes(r)) : [];
  lastInstruction = { text, summary: result.summary, note: others.length ? `${others.map((r) => LABELS[r]).join(' and ')} ${others.length > 1 ? 'are' : 'is'} on another device` : '' };
  if (result.understood && write) skyWrite(text.toLowerCase(), 2600);
  if (result.understood && hud) showHud(text, result);
  renderStatus();
  return result;
}

let hudTimer = null;
function showHud(label, result) {
  const m = mm();
  const first = result.changes[0];
  const a = first ? m.engine.agents[first.role] : null;
  setText($('hudLabel'), label);
  $('hudBars').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', a && !a.auto && a.level > i));
  setText($('hudSub'), result.understood ? result.summary : result.summary);
  $('hud').classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => $('hud').classList.remove('show'), 1400);
}

// --- Click wheel ----------------------------------------------------------------------------------
const wheel = $('wheel');
const angleAt = (e) => {
  const r = wheel.getBoundingClientRect();
  return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
};
let drag = null;
const TICK = 34; // degrees per busier / calmer step

wheel.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#start')) return; // the centre button is main.js's
  drag = { id: e.pointerId, last: angleAt(e), acc: 0, moved: 0, zone: e.target.closest('.zone') };
  wheel.setPointerCapture(e.pointerId);
});
wheel.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const a = angleAt(e);
  let d = a - drag.last;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  drag.last = a;
  drag.acc += d;
  drag.moved += Math.abs(d);
  if (drag.moved > 10) {
    wheel.classList.add('turning');
    wheel.style.setProperty('--trail-from', `${a + 90 - (d > 0 ? 70 : 0)}deg`);
  }
  while (Math.abs(drag.acc) >= TICK) {
    const up = drag.acc > 0;
    drag.acc -= up ? TICK : -TICK;
    navigator.vibrate?.(6);
    apply(up ? 'busier' : 'calm it down');
  }
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const wasTap = drag.moved <= 10;
  const zone = drag.zone;
  drag = null;
  wheel.classList.remove('turning');
  if (wasTap && zone) press(zone);
}
wheel.addEventListener('pointerup', endDrag);
wheel.addEventListener('pointercancel', endDrag);
// keyboard users: the zones are real buttons
wheel.querySelectorAll('.zone').forEach((z) => z.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(z); }
}));
wheel.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { if (e.target === wheel) apply('busier'); }
});

function press(zone) {
  zone.classList.remove('hit');
  void zone.offsetWidth;
  zone.classList.add('hit');
  setTimeout(() => zone.classList.remove('hit'), 380);
  navigator.vibrate?.(10);
  const act = zone.dataset.act;
  if (act === 'menu') return openSheet(true);
  if (act === 'higher') return apply('go higher');
  if (act === 'lower') return apply('go lower');
  if (act === 'break') {
    const { engine } = mm();
    const mine = [...engine.myRoles];
    const resting = mine.length && mine.every((r) => !engine.agents[r].auto && engine.agents[r].level === 0);
    return apply(resting ? 'bring back' : 'take a break');
  }
}

// --- Status ----------------------------------------------------------------------------------------
let shownTitle = null;
function kinetic(el, text) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.setAttribute('aria-label', text);
  el.innerHTML = '';
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? ' ' : ch;
    s.style.animationDelay = `${i * 26}ms`;
    s.setAttribute('aria-hidden', 'true');
    el.append(s);
  });
}

function currentSeed() {
  const m = mm();
  if (m?.swarm.song?.seed) return m.swarm.song.seed;
  const songId = $('song').value;
  return songId ? `song:${songId}` : ($('seed').value.trim() || 'durhack');
}

function renderStatus() {
  const m = mm();
  if (!m) return;
  const { swarm, engine } = m;
  const playing = swarm.playing;
  document.body.classList.toggle('live', playing);

  const st = structureFromSeed(currentSeed());
  const seed = currentSeed();
  seedHash = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % SKIES.length;
  const title = st.song?.title || st.mood || `${st.key} ${st.mode}`;
  if (title !== shownTitle) { shownTitle = title; kinetic($('scrTitle'), title); }
  $('knobNum').firstChild.textContent = String(st.bpm);

  const pos = engine.position();
  setText($('scrPhrase'), pos && playing && pos.stepFloat >= 0 ? `Phrase ${pos.phrase + 1} · Bar ${pos.bar + 1}` : `${st.key} ${st.mode}`);

  // hint on the screen before you join
  const v = swarm.view();
  const others = v.peers.filter((p) => p.state?.playing).length;
  setText($('heroSub'), swarm.song ? `A song is playing on ${others || 'another'} device${others === 1 ? '' : 's'}. Press the centre to join.` : 'A band with no conductor. Press the centre to start.');
  setText($('songChip'), swarm.song ? title : `${st.song ? title : `Improvise · ${$('seed').value || 'durhack'}`}  ▾`);
  $('songChip').hidden = !!swarm.song;
  const sm = $('samples');
  $('loading').hidden = !/loading|failed/.test(sm.textContent);
  setText($('loading'), sm.textContent);

  // your part(s)
  const mine = [...engine.myRoles];
  const parts = pos && playing ? engine.partsFor(Math.max(0, pos.phrase)) : null;
  const names = mine.map((r) => LABELS[r]);
  const li = lastInstruction ? ` · “${lastInstruction.text}”` : '';
  setText($('scrSub'), playing ? `${names.length === ROLES.length ? 'You are the whole band' : names.length ? `You: ${names.join(', ')}` : 'Doubling a part'}${li}` : '');

  const role = mine[Math.floor(performance.now() / 3500) % Math.max(1, mine.length)];
  const d = role ? parts?.[role]?.d : null;
  const icon = $('instIcon');
  const iconKey = role || 'none';
  if (icon.dataset.k !== iconKey) {
    icon.dataset.k = iconKey;
    icon.innerHTML = ICONS[iconKey];
    icon.classList.remove('pop');
    void icon.offsetWidth;
    icon.classList.add('pop');
  }
  setText($('instRole'), role ? `${LABELS[role]}${mine.length > 1 ? ` · ${mine.indexOf(role) + 1}/${mine.length}` : ''}` : 'Your part');
  setText($('instName'), role ? (d?.voice ? voiceById[d.voice]?.label ?? d.voice : 'Choosing…') : playing ? 'Listening' : 'Not playing yet');
  const lvl = role ? (d ? d.level : engine.agents[role].level) : 0;
  $('instLevel').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', lvl > i));
  $('instLevel').title = role ? LEVEL_NAMES[lvl] : '';

  renderRoom(v, playing);
  watchSwarm(v, engine);
}

// --- Devices in the room ---------------------------------------------------------------------------
function renderRoom(v, playing) {
  const dots = $('roomDots');
  const total = 1 + v.peers.length;
  const lit = (playing ? 1 : 0) + v.peers.filter((p) => p.state?.playing).length;
  const n = Math.max(10, total);
  const sig = `${n}|${lit}|${total}|${playing}`;
  dots.classList.toggle('spin', !!(mm().swarm.song && !mm().swarm.clock.locked));
  setText($('roomCount'), String(total));
  if (dots.dataset.sig === sig) return;
  dots.dataset.sig = sig;
  dots.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const el = document.createElement('i');
    el.style.left = `${50 + Math.cos(a) * 40}%`;
    el.style.top = `${50 + Math.sin(a) * 40}%`;
    if (i < lit) el.className = i === 0 && playing ? 'me' : 'on';
    dots.append(el);
  }
  $('roomBtn').setAttribute('aria-label', `${total} device${total === 1 ? '' : 's'} in the room, ${lit} playing. Invite another`);
}

// --- Toasts -----------------------------------------------------------------------------------------
let prev = null;
function toast(text, kind = '') {
  const el = document.createElement('li');
  el.className = kind;
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4200);
  while ($('toasts').children.length > 2) $('toasts').firstElementChild.remove();
}
function watchSwarm(v, engine) {
  const cur = {
    server: v.server,
    peers: new Map(v.peers.filter((p) => p.state?.playing).map((p) => [p.id, (p.state.roles || []).join(', ')])),
    mine: new Set(engine.myRoles),
    playing: mm().swarm.playing,
  };
  if (prev && cur.playing) {
    for (const [id, roles] of cur.peers) if (!prev.peers.has(id)) toast(`${id.slice(0, 4)} joined${roles ? ` · ${roles}` : ''}`);
    for (const id of prev.peers.keys()) if (!cur.peers.has(id)) toast(`${id.slice(0, 4)} went quiet`, 'warn');
    for (const r of cur.mine) if (!prev.mine.has(r) && prev.playing) { toast(`You picked up ${LABELS[r].toLowerCase()}`, 'good'); flock?.light(RI[r], 0.5, 1200, performance.now()); }
    for (const r of prev.mine) if (!cur.mine.has(r) && prev.playing) toast(`${LABELS[r]} handed over`);
    if (prev.server === 'up' && cur.server !== 'up') toast('Server gone. The band plays on.', 'warn');
    if (prev.server !== 'up' && cur.server === 'up') toast('Server back', 'good');
  }
  if (prev && !prev.playing && cur.playing && flock) { flock.release(380 * S); rings.push({ x: W / 2, y: H * 0.4, age: 0, life: 1.3, max: Math.max(W, H) * 0.7 }); }
  if (prev && prev.playing && !cur.playing) setTimeout(() => !mm().swarm.playing && skyWrite('murmuration', 0), 600);
  prev = cur;
}

// --- Prompt -----------------------------------------------------------------------------------------
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('prompt').value.trim();
  if (!text) return;
  $('prompt').value = '';
  $('prompt').blur();
  const result = apply(text, { write: true, hud: false });
  if (result && !result.understood) showHud('Hmm', result);
  if (result?.understood && !mm().swarm.playing && !$('start').disabled) $('start').click();
});

// --- Menu sheet and invite ---------------------------------------------------------------------------
const sheet = $('sheet');
sheet.inert = true;
function openSheet(open) {
  sheet.classList.toggle('open', open);
  sheet.setAttribute('aria-hidden', String(!open));
  sheet.inert = !open;
  if (open) $('sheetClose').focus();
}
$('sheetClose').addEventListener('click', () => openSheet(false));
$('scrim').addEventListener('click', () => openSheet(false));
$('songChip').addEventListener('click', () => openSheet(true));
addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
$('roomBtn').addEventListener('click', () => $('invite').showModal());
$('inviteClose').addEventListener('click', () => $('invite').close());
$('song').addEventListener('change', () => { renderStatus(); if (!mm()?.swarm.playing) skyWrite('murmuration', 0); });

// the centre button is main.js's: a burst of birds when it is pressed
$('start').addEventListener('click', () => { if (!flock) return; const [cx, cy] = flock.centroid(); flock.impulse(cx, cy, 280 * S, Math.max(W, H)); });
// tap the screen: birds scatter from your finger
canvas.addEventListener('pointerdown', (e) => {
  if (!flock) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * DPR, y = (e.clientY - r.top) * DPR;
  flock.impulse(x, y, 320 * S, 140 * S);
  for (let k = 0; k < 8; k++) spark(x, y, (Math.random() - 0.5) * 220 * S, (Math.random() - 0.5) * 220 * S, '#FFE7C2', 1.3, 0.8);
});

// --- Go --------------------------------------------------------------------------------------------
(document.fonts?.ready || Promise.resolve()).then(() => setTimeout(() => { if (!mm()?.swarm.playing) skyWrite('murmuration', 0); }, 350));
setInterval(renderStatus, 400);
renderStatus();
requestAnimationFrame(frame);