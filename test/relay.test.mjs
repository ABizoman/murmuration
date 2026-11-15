// The relay fallback (src/net/mesh.js): when the network blocks the direct WebRTC link, devices
// that the signalling server introduced still talk, through the server.
import test from 'node:test';
import assert from 'node:assert/strict';

// A fake signalling server with the same message rules as server.js.
const clients = new Map();
class FakeWS {
  constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1); }
  send(raw) {
    const msg = JSON.parse(raw);
    if (msg.type === 'join') {
      this.id = msg.id;
      this.deliver({ type: 'peers', ids: [...clients.keys()] });
      for (const c of clients.values()) c.deliver({ type: 'peer-joined', id: msg.id });
      clients.set(msg.id, this);
    } else if (msg.type === 'signal' || msg.type === 'relay') clients.get(msg.to)?.deliver({ type: msg.type, from: this.id, data: msg.data });
  }
  deliver(m) { setTimeout(() => this.onmessage?.({ data: JSON.stringify(m) }), 1); }
  close() { clients.delete(this.id); for (const c of clients.values()) c.deliver({ type: 'peer-left', id: this.id }); this.readyState = 3; }
}
// A peer connection that never gets through (a blocked network).
class BlockedPC {
  constructor() { this.connectionState = 'new'; }
  createDataChannel() { return { readyState: 'connecting', close() {} }; }
  async createOffer() { return { type: 'offer', sdp: 'x' }; }
  async createAnswer() { return { type: 'answer', sdp: 'y' }; }
  async setLocalDescription(d) { this.localDescription = { toJSON: () => d }; }
  async setRemoteDescription(d) { this.remoteDescription = d; }
  async addIceCandidate() {}
  close() {}
}

test('mesh: with the direct link blocked, two devices still talk, through the server', async () => {
  globalThis.WebSocket = FakeWS;
  globalThis.RTCPeerConnection = BlockedPC;
  const { Mesh } = await import('../src/net/mesh.js');
  const got = { a: [], b: [] };
  const opened = { a: [], b: [] };
  const closed = [];
  const make = (id) => new Mesh({ id, signalUrl: 'ws://x', relayAfterMs: 30, onMessage: (from, m) => got[id].push([from, m]), onPeerOpen: (p) => opened[id].push(p), onPeerClose: (p) => closed.push([id, p]) });
  const a = make('a');
  a.connect();
  await new Promise((r) => setTimeout(r, 10));
  const b = make('b');
  b.connect();
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(opened, { a: ['b'], b: ['a'] }, 'each sees the other once');
  assert.deepEqual(a.openPeers(), ['b']);
  assert.equal(a.isDirect('b'), false);
  a.send('b', { g: 1, hello: 'there' });
  b.send('a', { d: 1, body: { type: 'ping' } });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got.b, [['a', { g: 1, hello: 'there' }]]);
  assert.deepEqual(got.a, [['b', { d: 1, body: { type: 'ping' } }]]);
  // b leaves: a hears it from the server
  b.ws.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(closed, [['a', 'b']]);
  assert.deepEqual(a.openPeers(), []);
  // a silent device can still be dropped by the swarm
  a.relayed.add('c');
  a.drop('c', 'silent for 4 s');
  assert.equal(a.isOpen('c'), false);
  clients.clear();
});
