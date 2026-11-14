// Murmuration Live: the design layer for live.html.
//
// src/main.js runs the band exactly as it does for the other pages (swarm, clock, agents, Jev,
// director, audio). This file only reads window.murmuration and draws:
//   * a dusk sky whose colours follow the song's sections, with a sun that breathes with the bass,
//   * a starling murmuration that the music moves: kicks send shockwaves, snares scatter, chords
//     light the flock, melody notes fly off as glowing sparks,
//   * the score as a ribbon flowing through a fixed line,
//   * the swarm as a row of devices that pulse on the shared beat, with toasts when someone joins,
//     drops out or a part is handed over,
//   * the prompt box: what you type is spelled out by the birds, then applied to your agents.

import { ROLES } from '../loops.js';
import { STEPS_PER_PHRASE } from '../clock.js';
import { structureFromSeed } from '../seed.js';
import { voiceById } from '../voices.js';
import { parseInstruction, LEVEL_NAMES } from '../ui/instructions.js';
import { Flock, textPoints } from './flock.js';

const $ = (id) => document.getElementById(id);
const mm = () => window.murmuration;
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const LABELS = { drums: 'Drums', bass: 'Bass', chords: 'Chords', melody: 'Melody' };
const css = getComputedStyle(document.documentElement);
const COLORS = ROLES.map((r) => css.getPropertyValue(`--${r}`).trim());
const RI = Object.fromEntries(ROLES.map((r, i) => [r, i]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SERIF = (px) => `italic 400 ${px}px "Instrument Serif", Georgia, serif`;

// --- Sky ---------------------------------------------------------------------------------------
// Four dusks: top, upper, lower, horizon. The song moves between them section by section.
const SKIES = [
  [[24, 20, 56], [92, 50, 108], [238, 128, 106], [255, 214, 172]], // plum dusk
  [[34, 26, 70], [146, 68, 122], [250, 150, 142], [255, 228, 204]], // rose
  [[26, 24, 50], [118, 58, 80], [246, 140, 72], [255, 206, 132]], // amber
  [[12, 28, 52], [40, 88, 122], [118, 170, 182], [232, 222, 192]], // sea
];
const sky = SKIES[0].map((c) => c.slice());
let skyTarget = 0;
const lerp = (a, b, k) => a + (b - a) * k;
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

const canvas = $('sky');
const g = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 1;
let flock = null;
const stars = Array.from({ length: 90 }, () => [Math.random(), Math.random() * 0.45, Math.random() * Math.PI * 2]);

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  W = Math.round(innerWidth * DPR);
  H = Math.round(innerHeight * DPR);
  canvas.width = W;
  canvas.height = H;
  S = DPR * Math.max(0.75, Math.min(1.25, Math.min(innerWidth, innerHeight) / 700));
  if (!flock) {
    const n = reduced ? 450 : innerWidth < 700 ? 1100 : 1600;
    flock = new Flock(n, W, H, S);
  } else {
    flock.scale = S;
    flock.resize(W, H);
  }
}
addEventListener('resize', resize);
resize();

// --- Audio tap (read-only listener on the output) ----------------------------------------------
let analyser = null, td = null, fd = null;
let level = 0, low = 0;
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

// --- Sparks: melody notes and accents fly off as light -----------------------------------------
const sparks = [];
function spark(x, y, vx, vy, color, size, life) {
  if (sparks.length > 360) sparks.shift();
  sparks.push({ x, y, vx, vy, color, size, life, age: 0 });
}
function drawSparks(dt) {
  g.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.age += dt;
    if (p.age > p.life) { sparks.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.985;
    p.vy = p.vy * 0.985 - 6 * S * dt;
    const k = 1 - p.age / p.life;
    g.fillStyle = p.color;
    g.globalAlpha = 0.18 * k;
    g.beginPath(); g.arc(p.x, p.y, p.size * 3.2 * S, 0, 7); g.fill();
    g.globalAlpha = 0.95 * k;
    g.beginPath(); g.arc(p.x, p.y, p.size * S, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

// --- Rings: kicks ripple out from the flock ---------------------------------------------------
const rings = [];
function drawRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.age += dt;
    if (r.age > r.life) { rings.splice(i, 1); continue; }
    const k = r.age / r.life;
    g.strokeStyle = `rgba(255,244,230,${0.35 * (1 - k)})`;
    g.lineWidth = (2.5 - 2 * k) * S;
    g.beginPath();
    g.ellipse(r.x, r.y, r.max * k, r.max * k * 0.62, 0, 0, 7);
    g.stroke();
  }
}

// --- Notes: turn the shared score into events, as the playhead crosses them -------------------
let lastStep = null;
const byStepCache = new Map(); // `${phrase}:${role}` -> { ref, map }
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

function onNote(role, n, mine, now) {
  const [cx, cy] = flock.centroid();
  const amp = mine ? 1 : 0.55;
  const ri = RI[role];
  if (role === 'drums') {
    if (n.drum === 'kick') {
      flock.impulse(cx, cy, 190 * S * amp, Math.min(W, H) * 0.4);
      rings.push({ x: cx, y: cy, age: 0, life: 0.9, max: Math.min(W, H) * 0.42 });
      sunKick = 1;
    } else if (n.drum === 'snare') {
      flock.scatter(0.22 * amp, 120 * S);
      flock.light(ri, 0.05 * amp, 260, now);
    } else {
      flock.light(ri, 0.02 * amp, 160, now);
    }
  } else if (role === 'bass') {
    bassDrop = Math.min(1, bassDrop + 0.5 * amp);
    flock.light(ri, 0.04 * amp, 380, now);
  } else if (role === 'chords') {
    flock.light(ri, 0.12 * amp, 700, now);
    chordGlow = 1;
  } else if (role === 'melody') {
    const pitch = n.midi ?? (n.midis ? n.midis[0] : 72);
    const y = H * (0.75 - Math.min(1, Math.max(0, (pitch - 55) / 36)) * 0.6);
    for (let k = 0; k < (mine ? 7 : 3); k++) {
      spark(cx + (Math.random() - 0.5) * 30 * S, cy + (Math.random() - 0.5) * 30 * S,
        (60 + Math.random() * 120) * S, (y - cy) * (0.4 + Math.random() * 0.4), COLORS[ri], 1.6 + Math.random() * 1.8, 1.4 + Math.random());
    }
  }
}

// --- Main loop -------------------------------------------------------------------------------------
let sunKick = 0, bassDrop = 0, chordGlow = 0;
let lastT = performance.now();
let ax = 0, ay = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tapAudio();
  readAudio();
  const m = mm();
  const playing = !!m?.swarm.playing;
  const pos = playing ? m.engine.position() : null;

  // sky colours ease toward the section's palette
  for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) sky[i][c] = lerp(sky[i][c], SKIES[skyTarget][i][c], dt * 0.6);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, rgb(sky[0]));
  grad.addColorStop(0.42, rgb(sky[1]));
  grad.addColorStop(0.74, rgb(sky[2]));
  grad.addColorStop(1, rgb(sky[3]));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // stars in the dark top of the sky
  g.fillStyle = '#FFF6E8';
  for (const [sx, sy, ph] of stars) {
    g.globalAlpha = 0.25 + 0.25 * Math.sin(now * 0.0012 + ph);
    g.fillRect(sx * W, sy * H, 1.3 * DPR, 1.3 * DPR);
  }
  g.globalAlpha = 1;

  // the sun, low on the horizon, breathing with the bass and flaring on kicks
  sunKick *= Math.pow(0.02, dt);
  chordGlow *= Math.pow(0.15, dt);
  const sr = Math.min(W, H) * (0.16 + 0.05 * low + 0.03 * sunKick);
  const sx = W * 0.5, sy = H * 0.86;
  g.globalCompositeOperation = 'lighter';
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
  sun.addColorStop(0, `rgba(255,236,200,${0.55 + 0.3 * sunKick})`);
  sun.addColorStop(0.25, `rgba(255,190,140,${0.22 + 0.15 * low})`);
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

  // where the flock wants to be: a slow figure-of-eight, lower when the bass plays
  bassDrop *= Math.pow(0.2, dt);
  const tt = now / 1000;
  const live = document.body.classList.contains('live');
  const cyBase = live ? 0.36 : 0.42;
  ax = W * (0.5 + 0.22 * Math.sin(tt * 0.23) * (playing ? 1 : 0.6));
  ay = H * (cyBase + 0.07 * Math.sin(tt * 0.46) + 0.05 * bassDrop);

  // notes crossing the playhead since the last frame
  if (pos && pos.stepFloat >= 0) {
    const cur = Math.floor(pos.stepFloat);
    if (lastStep === null || cur < lastStep || cur - lastStep > 8) lastStep = cur - 1;
    for (let s = lastStep + 1; s <= cur; s++) {
      for (const { role, n } of notesAt(m.engine, s)) onNote(role, n, m.engine.myRoles.has(role), now);
      if (s % 4 === 0) beat(s);
    }
    lastStep = cur;
    const section = Math.floor(pos.phrase / 4);
    skyTarget = (seedHash + section) % SKIES.length;
  } else {
    lastStep = null;
  }

  flock.step(dt, { ax, ay, energy: playing ? 0.25 + level * 0.9 : 0.2, tight: playing ? 0.35 + level * 0.6 : 0.6 });
  drawRings(dt);
  flock.draw(g, '16,10,28', COLORS, now);
  drawSparks(dt);

  drawRibbon(now, pos, m);
  requestAnimationFrame(frame);
}

// --- Beat: every quarter note the device beads pulse together ------------------------------------
function beat(s) {
  const strip = $('devices');
  strip.classList.remove('pulse');
  void strip.offsetWidth;
  strip.classList.add('pulse');
  const dots = document.querySelectorAll('#beatDots i');
  const b = Math.floor(s / 4) % 4;
  dots.forEach((d, i) => d.classList.toggle('on', i === b));
}

// --- Score ribbon: the music around now, flowing through a fixed line -----------------------------
const rib = $('ribbon');
const rg = rib.getContext('2d');
const DRUM_Y = { kick: 0.85, snare: 0.5, hat: 0.15, ohat: 0.15 };
function drawRibbon(now, pos, m) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rib.clientWidth * dpr), h = Math.round(rib.clientHeight * dpr);
  if (!w || !h) return;
  if (rib.width !== w || rib.height !== h) { rib.width = w; rib.height = h; }
  rg.clearRect(0, 0, w, h);
  if (!pos || pos.stepFloat < 0) return;
  const { engine } = m;
  const play = pos.stepFloat, visible = rib.clientWidth < 520 ? 24 : 36, pps = w / visible, cx = w / 2;
  const xOf = (gs) => cx + (gs - play) * pps;
  const lo = play - visible / 2 - 1, hi = play + visible / 2 + 1;
  const laneH = h / 4;
  const phrases = [pos.phrase - 1, pos.phrase, pos.phrase + 1].filter((q) => q >= 0);

  ROLES.forEach((role, i) => {
    const ly = i * laneH, mine = engine.myRoles.has(role);
    const all = [];
    for (const q of phrases) {
      const part = engine.partsFor(q)?.[role];
      if (part && !part.pending) for (const n of part.notes) all.push([n, q * STEPS_PER_PHRASE + n.step]);
    }
    if (!all.length) return;
    const ps = all.flatMap(([n]) => n.midis || (n.midi != null ? [n.midi] : []));
    const pLo = Math.min(...ps), pHi = Math.max(...ps);
    const nh = Math.max(2 * dpr, Math.min(4 * dpr, laneH * 0.16));
    const span = laneH - nh - 6 * dpr;
    const yOf = (p) => ly + 3 * dpr + (pHi === pLo ? 0.5 : 1 - (p - pLo) / (pHi - pLo)) * span;
    for (const [n, gs] of all) {
      if (gs + n.dur < lo || gs > hi) continue;
      const active = play >= gs && play < gs + n.dur, passed = play >= gs + n.dur;
      const ys = n.drum ? [ly + 3 * dpr + DRUM_Y[n.drum] * span] : (n.midis || [n.midi]).map(yOf);
      rg.globalAlpha = (mine ? 1 : 0.45) * (passed ? 0.35 : 1);
      rg.fillStyle = COLORS[i];
      if (active) { rg.shadowColor = COLORS[i]; rg.shadowBlur = 14 * dpr; }
      const x = xOf(gs), wd = Math.max(n.dur * pps - 2 * dpr, 2 * dpr);
      for (const y of ys) { rg.beginPath(); rg.roundRect ? rg.roundRect(x, y - (active ? dpr : 0), wd, nh + (active ? 2 * dpr : 0), nh) : rg.rect(x, y, wd, nh); rg.fill(); }
      rg.shadowBlur = 0;
    }
  });
  rg.globalAlpha = 1;
  // fade the edges
  rg.globalCompositeOperation = 'destination-in';
  const f = rg.createLinearGradient(0, 0, w, 0);
  f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(0.25, '#000'); f.addColorStop(0.75, '#000'); f.addColorStop(1, 'rgba(0,0,0,0)');
  rg.fillStyle = f; rg.fillRect(0, 0, w, h);
  rg.globalCompositeOperation = 'source-over';
  // the line
  rg.fillStyle = 'rgba(255,246,232,0.95)';
  rg.shadowColor = 'rgba(255,230,200,0.9)';
  rg.shadowBlur = 10 * dpr;
  rg.fillRect(cx - dpr, 0, 2 * dpr, h);
  rg.shadowBlur = 0;
}

// --- Words in the sky --------------------------------------------------------------------------
let releaseTimer = null;
function skyWrite(text, holdMs, burst = 260) {
  if (reduced) return;
  const box = { x: W * 0.06, y: H * (document.body.classList.contains('live') ? 0.17 : 0.2), w: W * 0.88, h: Math.min(H * 0.2, W * 0.32) };
  const pts = textPoints(text, SERIF, box, Math.floor(flock.n * 0.85));
  if (!pts.length) return;
  flock.form(pts);
  clearTimeout(releaseTimer);
  if (holdMs) releaseTimer = setTimeout(() => flock.release(burst * S), holdMs);
}

// --- Status, kinetic title, your parts ---------------------------------------------------------
let seedHash = 0;
let shownMood = null;
function kinetic(el, text) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.setAttribute('aria-label', text);
  el.innerHTML = '';
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? '\u00A0' : ch;
    s.style.animationDelay = `${i * 28}ms`;
    s.setAttribute('aria-hidden', 'true');
    el.append(s);
  });
}

let lastInstruction = null;
function renderStatus() {
  const m = mm();
  if (!m) return;
  const { swarm, engine } = m;
  const playing = swarm.playing;
  document.body.classList.toggle('live', playing);
  document.body.classList.toggle('song-exists', !!swarm.song);

  const seed = swarm.song?.seed || $('seed').value || 'durhack';
  const st = structureFromSeed(seed);
  seedHash = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % SKIES.length;
  const mood = st.mood || `${st.key} ${st.mode}`;
  if (mood !== shownMood) { shownMood = mood; kinetic($('mood'), mood); }
  const keyLine = `${st.key} ${st.mode} · ${st.bpm} BPM · ${st.progression.join(' – ')}`;
  setText($('keyLine'), keyLine);
  setText($('keyLineHero'), keyLine);

  const v = swarm.view();
  const others = v.peers.filter((p) => p.state?.playing).length;
  const pos = engine.position();
  setText($('counter'), pos && playing && pos.stepFloat >= 0 ? `Phrase ${pos.phrase + 1} · Bar ${pos.bar + 1}` : '');

  // hero line
  setText($('heroSub'), swarm.song
    ? `A song is playing on ${others || 'another'} device${others === 1 ? '' : 's'}. Join in.`
    : 'A band with no conductor. Every phone is a player.');

  // your parts
  const parts = pos && playing ? engine.partsFor(Math.max(0, pos.phrase)) : null;
  const mine = [...engine.myRoles];
  const list = $('yourParts');
  const sig = JSON.stringify(mine.map((r) => [r, parts?.[r]?.d?.voice, parts?.[r]?.d?.level, v.whyMine[r]]));
  if (list.dataset.sig !== sig) {
    list.dataset.sig = sig;
    list.innerHTML = '';
    for (const r of mine) {
      const d = parts?.[r]?.d;
      const li = document.createElement('li');
      li.style.setProperty('--c', COLORS[RI[r]]);
      const name = document.createElement('b');
      name.textContent = LABELS[r];
      const sub = document.createElement('span');
      const bits = [d?.voice ? voiceById[d.voice]?.label ?? d.voice : null, d ? LEVEL_NAMES[d.level] : null, v.whyMine[r] && v.whyMine[r] !== 'owner' ? v.whyMine[r] : null].filter(Boolean);
      sub.textContent = bits.join(' · ') || 'listening…';
      li.append(name, sub);
      list.append(li);
    }
  }
  setText($('youLabel'), mine.length === ROLES.length ? 'You are the whole band' : mine.length ? 'You are playing' : 'Doubling a part');

  // last instruction
  const li = $('lastInstruction');
  li.hidden = !lastInstruction;
  if (lastInstruction) setText(li, `“${lastInstruction.text}” → ${lastInstruction.summary}${lastInstruction.note ? `. ${lastInstruction.note}` : ''}`);

  // samples loading (main.js writes into #samples)
  const sm = $('samples');
  $('loading').hidden = !/loading|failed/.test(sm.textContent);
  setText($('loading'), sm.textContent);

  renderDevices(v);
  watchSwarm(v, engine);
}

// --- Devices strip ------------------------------------------------------------------------------
const gone = new Map(); // id -> ms it disappeared
function renderDevices(v) {
  const strip = $('devices');
  const items = [{ id: v.id, me: true, roles: [...(mm().engine.myRoles)], direct: true, playing: mm().swarm.playing },
    ...v.peers.map((p) => ({ id: p.id, roles: p.state?.roles || [], direct: p.direct, playing: !!p.state?.playing }))];
  const now = performance.now();
  for (const [id, t] of gone) if (now - t > 5000 || items.some((i) => i.id === id)) gone.delete(id);
  for (const id of gone.keys()) items.push({ id, roles: [], gone: true });
  const sig = JSON.stringify(items);
  if (strip.dataset.sig === sig) return;
  strip.dataset.sig = sig;
  strip.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = `${it.me ? 'me' : ''} ${it.gone ? 'gone' : ''} ${it.direct === false ? 'relayed' : ''} ${it.playing ? 'playing' : ''}`;
    const cols = it.roles.length ? it.roles.map((r) => COLORS[RI[r]]) : ['rgba(255,255,255,.35)'];
    const stops = cols.map((c, i) => `${c} ${(i / cols.length) * 360}deg ${((i + 1) / cols.length) * 360}deg`).join(',');
    li.style.setProperty('--ring', `conic-gradient(${stops})`);
    li.title = `${it.me ? 'This device' : it.id}${it.roles.length ? `: ${it.roles.join(', ')}` : ''}${it.gone ? ' (gone)' : it.direct === false ? ' (reached through others)' : ''}`;
    const dot = document.createElement('i');
    const label = document.createElement('span');
    label.textContent = it.me ? 'you' : it.id.slice(0, 4);
    li.append(dot, label);
    strip.append(li);
  }
  setText($('deviceCount'), `${items.filter((i) => !i.gone).length} in the room`);
}

// --- Toasts: the swarm's story, as it happens ----------------------------------------------------
let prev = null;
function toast(text, kind = '') {
  const el = document.createElement('li');
  el.className = kind;
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4500);
  while ($('toasts').children.length > 3) $('toasts').firstElementChild.remove();
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
    for (const id of prev.peers.keys()) if (!cur.peers.has(id)) { toast(`${id.slice(0, 4)} went quiet`, 'warn'); gone.set(id, performance.now()); }
    for (const r of cur.mine) if (!prev.mine.has(r) && prev.playing) { toast(`You picked up ${LABELS[r].toLowerCase()}`, 'good'); flock.light(RI[r], 0.5, 1200, performance.now()); }
    for (const r of prev.mine) if (!cur.mine.has(r) && prev.playing) toast(`${LABELS[r]} handed over`);
    if (prev.server === 'up' && cur.server !== 'up') toast('Server gone. The band plays on.', 'warn');
    if (prev.server !== 'up' && cur.server === 'up') toast('Server back', 'good');
  }
  if (prev && !prev.playing && cur.playing) { flock.release(420 * S); rings.push({ x: W / 2, y: H * 0.35, age: 0, life: 1.4, max: Math.max(W, H) * 0.6 }); }
  if (prev && prev.playing && !cur.playing) setTimeout(() => !mm().swarm.playing && skyWrite('murmuration', 0), 600);
  prev = cur;
}

// --- Prompt box ---------------------------------------------------------------------------------
function send(text) {
  const m = mm();
  const clean = String(text || '').trim();
  if (!m || !clean) return;
  $('prompt').value = '';
  $('prompt').blur();
  const { swarm, engine } = m;
  const mine = [...engine.myRoles];
  const result = parseInstruction(clean, engine.agents, mine);
  if (result.stop) {
    if (swarm.playing && !$('start').disabled) $('start').click();
    lastInstruction = { text: clean, summary: swarm.playing ? 'left the song' : 'nothing to leave yet' };
    return renderStatus();
  }
  for (const { role, set } of result.changes) Object.assign(engine.agents[role], set);
  let note = '';
  const others = mine.length ? result.changes.map((c) => c.role).filter((r) => !mine.includes(r)) : [];
  if (others.length) note = `${others.map((r) => LABELS[r]).join(' and ')} ${others.length > 1 ? 'are' : 'is'} on another device`;
  lastInstruction = { text: clean, summary: result.summary, note };
  if (result.understood) skyWrite(clean.toLowerCase(), 2800);
  if (result.understood && !swarm.playing) {
    if ($('start').disabled) lastInstruction.note = 'still syncing, press Join in a moment';
    else $('start').click();
  }
  renderStatus();
}
$('composer').addEventListener('submit', (e) => { e.preventDefault(); send($('prompt').value); });
$('suggestions').addEventListener('click', (e) => { const b = e.target.closest('button[data-say]'); if (b) send(b.dataset.say); });

// --- Sheet and invite ------------------------------------------------------------------------------
const sheet = $('sheet');
sheet.inert = true;
function openSheet(open) {
  sheet.classList.toggle('open', open);
  sheet.setAttribute('aria-hidden', String(!open));
  sheet.inert = !open;
  $('bandBtn').setAttribute('aria-expanded', String(open));
  if (open) sheet.querySelector('button, summary')?.focus();
}
$('bandBtn').addEventListener('click', () => openSheet(!sheet.classList.contains('open')));
$('sheetClose').addEventListener('click', () => openSheet(false));
$('scrim').addEventListener('click', () => openSheet(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
$('inviteBtn').addEventListener('click', () => $('invite').showModal());
$('inviteClose').addEventListener('click', () => $('invite').close());

// Start/Join is main.js's own button: a flash of birds when it is pressed.
$('start').addEventListener('click', () => { const [cx, cy] = flock.centroid(); flock.impulse(cx, cy, 300 * S, Math.max(W, H)); });

// Tap the sky: birds scatter from your finger.
canvas.addEventListener('pointerdown', (e) => {
  flock.impulse(e.clientX * DPR, e.clientY * DPR, 340 * S, 160 * S);
  for (let k = 0; k < 10; k++) spark(e.clientX * DPR, e.clientY * DPR, (Math.random() - 0.5) * 240 * S, (Math.random() - 0.5) * 240 * S, '#FFE7C2', 1.4, 0.9);
});

// --- Go ------------------------------------------------------------------------------------------
(document.fonts?.ready || Promise.resolve()).then(() => setTimeout(() => { if (!mm()?.swarm.playing) skyWrite('murmuration', 0); }, 350));
setInterval(renderStatus, 400);
renderStatus();
requestAnimationFrame(frame);