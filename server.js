// Signalling server. It hosts the page and introduces devices to each other; it never carries music.
// Once two devices have a WebRTC data channel, this server can be killed and they keep talking.
//
//   node server.js            (PORT=8000 by default)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mid': 'audio/midi' };

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return 'localhost';
}
const LAN_URL = `http://${lanAddress()}:${PORT}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/qr.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    return res.end(await QRCode.toString(LAN_URL, { type: 'svg', margin: 1, color: { dark: '#e6e8ee', light: '#0000' } }));
  }
  if (url.pathname === '/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ lanUrl: LAN_URL }));
  }
  const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.git`)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
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
  console.log(`    phones:        ${LAN_URL}  (same Wi-Fi)\n`);
  try { console.log(await QRCode.toString(LAN_URL, { type: 'terminal', small: true })); } catch {}
  console.log('  Ctrl+C stops the server. Devices already connected keep playing.\n');
});
