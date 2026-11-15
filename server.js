// Signalling server. It hosts the page and introduces devices to each other. Once two devices have
// a WebRTC data channel, this server can be killed and they keep talking. When the network blocks
// the direct link (venue Wi-Fi, a firewall), it relays their messages instead.
//
//   node server.js            (PORT=8000 by default)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { decide, direct, aiStatus } from './ai.js';
import { rankAddresses } from './src/net/lan.js';

// Keys can live in a .env file next to this script (it is gitignored): GEMINI_API_KEY=..., JEV_API_KEY=...
try { process.loadEnvFile?.(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')); } catch {}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mid': 'audio/midi', '.mp3': 'audio/mpeg' };

const ADDRESSES = rankAddresses(os.networkInterfaces());
const LAN_HOST = process.env.HOST || ADDRESSES[0]?.address || 'localhost';
const LAN_URL = `http://${LAN_HOST}:${PORT}`;

// Tone.js comes from this server (node_modules/tone, installed by npm install), so a phone needs no
// internet: on a venue Wi-Fi without internet the page used to wait on unpkg and stay dark. If it
// isn't installed, the browser is sent to unpkg as before.
const TONE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', 'tone', 'build', 'Tone.js');
const TONE_CDN = 'https://unpkg.com/tone@15.1.22/build/Tone.js';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/qr.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    return res.end(await QRCode.toString(LAN_URL, { type: 'svg', margin: 1, color: { dark: '#e6e8ee', light: '#0000' } }));
  }
  if (url.pathname === '/vendor/Tone.js') {
    return fs.readFile(TONE_FILE, (err, data) => {
      if (err) {
        res.writeHead(302, { location: TONE_CDN });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=86400' });
      res.end(data);
    });
  }
  if (url.pathname === '/songs-local.json') {
    // Your own songs: every .js file in songs-local/ (gitignored). See docs/ADDING_SONGS.md.
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, 'songs-local')).filter((f) => f.endsWith('.js')).sort(); } catch {}
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(files));
  }
  if (url.pathname === '/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ lanUrl: LAN_URL, ai: aiStatus() }));
  }
  if (req.method === 'POST' && (url.pathname === '/decide' || url.pathname === '/direct')) {
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 200000) throw new Error('request too large');
      }
      const out = await (url.pathname === '/decide' ? decide : direct)(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (err) {
      log(`${url.pathname} failed: ${err.message}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: String(err.message).slice(0, 200) }));
    }
  }
  const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.git`) || path.basename(file).startsWith('.env')) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': url.pathname.startsWith('/samples/') ? 'public, max-age=86400' : 'no-store' });
    res.end(data);
  });
});

// --- Signalling ---------------------------------------------------------------
// Client -> server:  { type: 'join', id }  then  { type: 'signal', to, data }
// Server -> client:  { type: 'peers', ids }  { type: 'peer-joined', id }  { type: 'peer-left', id }  { type: 'signal', from, data }

const wss = new WebSocketServer({ server, path: '/signal' });
const clients = new Map(); // id -> ws

wss.on('connection', (ws) => {
  let id = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'join' && typeof msg.id === 'string' && !id) {
      id = msg.id.slice(0, 32);
      clients.get(id)?.close(); // same device reconnecting
      ws.send(JSON.stringify({ type: 'peers', ids: [...clients.keys()].filter((x) => x !== id) }));
      for (const other of clients.values()) other.send(JSON.stringify({ type: 'peer-joined', id }));
      clients.set(id, ws);
      log(`+ ${id} joined (${clients.size} connected)`);
    } else if (msg.type === 'signal' && id) {
      clients.get(msg.to)?.send(JSON.stringify({ type: 'signal', from: id, data: msg.data }));
    } else if (msg.type === 'relay' && id) {
      // music traffic for devices whose direct link is blocked (mesh.js relay fallback)
      clients.get(msg.to)?.send(JSON.stringify({ type: 'relay', from: id, data: msg.data }));
    }
  });
  ws.on('close', () => {
    if (!id || clients.get(id) !== ws) return;
    clients.delete(id);
    for (const other of clients.values()) other.send(JSON.stringify({ type: 'peer-left', id }));
    log(`- ${id} left (${clients.size} connected)`);
  });
});

const log = (s) => console.log(`${new Date().toLocaleTimeString()}  ${s}`);

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  Murmuration signalling server`);
  console.log(`    this computer: http://localhost:${PORT}`);
  console.log(`    phones:        ${LAN_URL}  (same Wi-Fi)`);
  const others = ADDRESSES.filter((a) => a.address !== LAN_HOST);
  if (others.length) console.log(`    if phones can't reach it, try: ${others.map((a) => `http://${a.address}:${PORT} (${a.name})`).join(', ')}  -- or run with HOST=<address>`);
  if (!fs.existsSync(TONE_FILE)) console.log('    note: run npm install so phones get Tone.js from this computer (no internet needed)');
  console.log('');
  try { console.log(await QRCode.toString(LAN_URL, { type: 'terminal', small: true })); } catch {}
  const ai = aiStatus();
  console.log(`  Jev: ${ai.jev === 'jev' ? 'live (JEV_API_KEY)' : 'stand-in (set JEV_API_KEY for the real model)'}`);
  console.log(`  Director: ${ai.director === 'stand-in' ? 'stand-in (set GEMINI_API_KEY for the real LLM)' : `live, ${ai.director} (GEMINI_API_KEY)`}\n`);
  console.log('  Ctrl+C stops the server. Devices already connected keep playing.\n');
});
