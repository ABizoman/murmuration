// `npm run measure-levels`: measure how loud each part is on its own, in a real browser, and say
// how far ROLE_GAIN in src/audio.js has to move to hit the target balance.
//
// It starts `node server.js` on a spare port, opens /classic.html?rng=levels&solo=<role>&lite=0
// in headless Chrome for each part (classic.html runs the same src/main.js as index.html), presses
// Start, waits for every sample to load, then reads the master meters for a while through the
// read-only hook window.murmuration.meters().
//
// Target balance (MUSIC_QUALITY_HANDOFF.md, A1): drums and bass equal, chords 2 dB below them,
// melody 1 dB above the chords.
//
//   npm run measure-levels                       measure and print the table
//   npm run measure-levels -- --apply            ...and write the new ROLE_GAIN into src/audio.js
//   npm run measure-levels -- --seconds 20       shorter run per part (default 40)
//   npm run measure-levels -- --full             also play the whole band and check peak and clips
//   npm run measure-levels -- --extra voice=chords:synth-pad   extra URL params for every run
//   npm run measure-levels -- --roles bass,chords
//
// Browser: Playwright's own Chromium if installed (`npx playwright install chromium`), otherwise
// the system Chrome. Tone.js normally comes from unpkg; the tool serves node_modules/tone instead,
// so it works with no internet.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);
const SECONDS = Number(opt('seconds', 40));
const ROLES = opt('roles', 'drums,bass,chords,melody').split(',');
const EXTRA = opt('extra', '');
const SEED = opt('seed', 'levels');
const TARGET = { drums: 0, bass: 0, chords: -2, melody: -1 }; // relative to the drums/bass level
const TONE_JS = `${ROOT}node_modules/tone/build/Tone.js`;

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function startServer(port) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in 15 s')), 15000);
    proc.stdout.on('data', (d) => d.toString().includes('localhost') && (clearTimeout(timer), resolve()));
    proc.on('exit', (code) => reject(new Error(`server exited (${code})`)));
  });
  return proc;
}

async function launch() {
  const flags = ['--autoplay-policy=no-user-gesture-required'];
  try {
    return await chromium.launch({ args: flags });
  } catch {
    return chromium.launch({ channel: 'chrome', args: flags }); // the system Chrome
  }
}

// Energy average of the loudness readings (the meter's own loudness is a 2 s running average).
const powerMean = (dbs) => {
  const xs = dbs.filter(Number.isFinite);
  if (!xs.length) return -Infinity;
  return 10 * Math.log10(xs.reduce((a, d) => a + 10 ** (d / 10), 0) / xs.length);
};

async function measure(browser, base, query, seconds) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (existsSync(TONE_JS)) await page.route(/unpkg\.com\/tone@[^/]+\/build\/Tone\.js/, (r) => r.fulfill({ path: TONE_JS, contentType: 'text/javascript' }));
  await page.goto(`${base}/classic.html?${query}`);
  await page.waitForFunction(() => window.murmuration?.swarm, null, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('start').click());
  // Wait for the meters to exist, then for every sample to finish loading (or 90 s).
  await page.waitForFunction(() => window.murmuration.meters(), null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const s = window.murmuration.samples();
    return s && s.loading === 0 && s.loaded + s.failed >= s.total;
  }, null, { timeout: 90000 }).catch(() => {});
  const samples = await page.evaluate(() => window.murmuration.samples());
  await page.evaluate(() => window.murmuration.resetMeters());
  const loud = [];
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => window.murmuration.meters());
    if (m && Number.isFinite(m.loudDb) && Date.now() - t0 > 3000) loud.push(m.loudDb); // skip the meter's warm-up
  }
  const m = await page.evaluate(() => window.murmuration.meters());
  await page.close();
  return { loudness: powerMean(loud), peak: m.peakDb, clips: m.clips, lite: m.lite, samples, errors };
}

function readGains() {
  const src = readFileSync(`${ROOT}src/audio.js`, 'utf8');
  const m = src.match(/const ROLE_GAIN = (\{[^}]*\});/);
  if (!m) throw new Error('ROLE_GAIN not found in src/audio.js');
  return { src, gains: Function(`return (${m[1]})`)() };
}

const f1 = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}` : '  –');
const pad = (s, n) => String(s).padEnd(n);

const port = await freePort();
const server = await startServer(port);
const base = `http://localhost:${port}`;
const browser = await launch();
try {
  const extra = EXTRA ? `&${EXTRA}` : '';
  const results = {};
  for (const role of ROLES) {
    process.stdout.write(`measuring ${role} (${SECONDS} s)… `);
    results[role] = await measure(browser, base, `rng=${SEED}&solo=${role}&lite=0${extra}`, SECONDS);
    const r = results[role];
    console.log(`${f1(r.loudness)} dB, peak ${f1(r.peak)} dB${r.errors.length ? ` · page errors: ${r.errors.join('; ')}` : ''}`);
    if (r.lite) console.log('  (warning: the lite graph was used)');
    if (r.samples && r.samples.failed) console.log(`  (warning: ${r.samples.failed} instruments failed to load)`);
  }

  const { src, gains } = readGains();
  // The drums/bass reference level: chosen so the corrections average to zero.
  const measured = ROLES.filter((r) => Number.isFinite(results[r].loudness));
  const ref = measured.reduce((a, r) => a + results[r].loudness - TARGET[r], 0) / (measured.length || 1);
  console.log(`\n${pad('role', 8)}${pad('loudness', 10)}${pad('peak', 8)}${pad('target', 8)}${pad('change', 8)}ROLE_GAIN`);
  const next = { ...gains };
  for (const role of ROLES) {
    const r = results[role];
    const want = ref + TARGET[role];
    const change = Number.isFinite(r.loudness) ? want - r.loudness : null;
    if (change != null) next[role] = Math.round((gains[role] + change) * 2) / 2; // half-dB steps
    console.log(`${pad(role, 8)}${pad(f1(r.loudness), 10)}${pad(f1(r.peak), 8)}${pad(f1(want), 8)}${pad(f1(change), 8)}${f1(gains[role])} -> ${f1(next[role])}`);
  }
  const off = measured.map((r) => Math.abs(results[r].loudness - (ref + TARGET[r])));
  console.log(`worst distance from the target balance: ${Math.max(...off).toFixed(1)} dB (aim: within 1 dB)`);

  if (flag('apply')) {
    const line = `const ROLE_GAIN = { ${Object.entries(next).map(([k, v]) => `${k}: ${v}`).join(', ')} };`;
    writeFileSync(`${ROOT}src/audio.js`, src.replace(/const ROLE_GAIN = \{[^}]*\};/, line));
    console.log(`wrote ${line} to src/audio.js — run again to confirm`);
  }

  if (flag('full')) {
    process.stdout.write(`\nthe whole band (${SECONDS} s)… `);
    const all = await measure(browser, base, `rng=${SEED}&lite=0${extra}`, SECONDS);
    console.log(`loudness ${f1(all.loudness)} dB, master peak ${f1(all.peak)} dBFS, clips ${all.clips}`);
    console.log(all.peak < -1 && all.clips === 0 ? 'OK: peak below -1 dBFS and no clips' : 'CHECK: the master peak reached -1 dBFS or clipped');
  }
} finally {
  await browser.close();
  server.kill();
}
