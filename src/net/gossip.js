// Gossip: flood each message to every neighbour, and each neighbour passes it on once.
// Duplicates are dropped by message id, so a message reaches everyone even if the mesh
// is not fully connected (e.g. two devices that never managed a direct link).

export class Gossip {
  constructor({ id, send, neighbours, deliver, ttl = 4, memory = 2000 }) {
    this.id = id;
    this.send = send; // (peerId, envelope)
    this.neighbours = neighbours; // () => [peerId]
    this.deliver = deliver; // (body, originId, viaPeerId)
    this.ttl = ttl;
    this.seq = 0;
    this.seen = new Set();
    this.order = [];
    this.memory = memory;
    this.stats = { sent: 0, received: 0, duplicates: 0, forwarded: 0 };
  }

  remember(mid) {
    this.seen.add(mid);
    this.order.push(mid);
    if (this.order.length > this.memory) this.seen.delete(this.order.shift());
  }

  publish(body) {
    const env = { g: 1, mid: `${this.id}:${++this.seq}`, origin: this.id, ttl: this.ttl, body };
    this.remember(env.mid);
    for (const p of this.neighbours()) this.send(p, env);
    this.stats.sent++;
  }

  // Returns true if the envelope was new.
  receive(env, fromPeer) {
    if (this.seen.has(env.mid)) {
      this.stats.duplicates++;
      return false;
    }
    this.remember(env.mid);
    this.stats.received++;
    this.deliver(env.body, env.origin, fromPeer);
    if (env.ttl > 1) {
      const fwd = { ...env, ttl: env.ttl - 1 };
      for (const p of this.neighbours()) if (p !== fromPeer && p !== env.origin) {
        this.send(p, fwd);
        this.stats.forwarded++;
      }
    }
    return true;
  }
}
