// Leaderless clock sync.
//
// Every device has   sharedNow = localNow + offset.
// It pings each neighbour (NTP style) and estimates   diff = peerShared - myLocal   from the
// sample with the lowest round-trip time. Then:
//   - a device that has not locked yet jumps straight to the average of locked neighbours (joining);
//   - a locked device nudges its offset a little toward the average of everyone, itself included
//     (like fireflies adjusting to their neighbours). No device is the reference clock.

export class ClockSync {
  constructor({ localNow, samplesKept = 6, gain = 0.3, maxSlewMs = 2, snapAboveMs = 60 }) {
    this.localNow = localNow;
    this.offset = 0;
    this.locked = false;
    this.epoch = 0; // bumped on every jump, so peers drop measurements taken before it
    this.peerEpoch = new Map();
    this.samples = new Map(); // peer -> [{ rtt, diff }]
    this.samplesKept = samplesKept;
    this.gain = gain;
    this.maxSlewMs = maxSlewMs;
    this.snapAboveMs = snapAboveMs;
  }

  now() {
    return this.localNow() + this.offset;
  }

  ping() {
    return { type: 'ping', t0: this.localNow() };
  }

  answer(ping) {
    return { type: 'pong', t0: ping.t0, t1: this.now(), epoch: this.epoch };
  }

  onPong(peer, pong) {
    const t2 = this.localNow();
    const rtt = t2 - pong.t0;
    if (rtt < 0 || rtt > 2000) return;
    const diff = pong.t1 - (pong.t0 + t2) / 2; // peerShared - myLocal
    if (this.peerEpoch.get(peer) !== pong.epoch) {
      this.peerEpoch.set(peer, pong.epoch);
      this.samples.delete(peer); // the peer's clock jumped: old measurements are wrong
    }
    const list = this.samples.get(peer) || [];
    list.push({ rtt, diff });
    if (list.length > this.samplesKept) list.shift();
    this.samples.set(peer, list);
  }

  forget(peer) {
    this.samples.delete(peer);
    this.peerEpoch.delete(peer);
  }

  // Best estimate of (peerShared - myShared), or null.
  error(peer) {
    const list = this.samples.get(peer);
    if (!list || list.length < 3) return null;
    const best = list.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    return { err: best.diff - this.offset, rtt: best.rtt };
  }

  // lockedPeers: peers that report themselves locked. playing: avoid jumps while audio runs.
  step({ lockedPeers, alone, playing }) {
    const errs = lockedPeers.map((p) => this.error(p)).filter(Boolean).map((e) => e.err);
    if (!this.locked) {
      if (errs.length) {
        this.offset += errs.reduce((a, b) => a + b, 0) / errs.length;
        this.locked = true;
        this.epoch++;
        return 'joined';
      }
      if (alone) {
        this.locked = true; // first device: its clock is as good as any
        return 'first';
      }
      return null;
    }
    if (!errs.length) return null;
    const mean = errs.reduce((a, b) => a + b, 0) / (errs.length + 1); // +1: myself, error 0
    if (!playing || Math.abs(mean) > this.snapAboveMs) {
      this.offset += mean;
      if (Math.abs(mean) > 1) this.epoch++;
    }
    else this.offset += Math.max(-this.maxSlewMs, Math.min(this.maxSlewMs, mean * this.gain));
    return null;
  }

  // Largest disagreement with any neighbour, for display.
  worstError(peers) {
    let worst = 0;
    for (const p of peers) {
      const e = this.error(p);
      if (e) worst = Math.max(worst, Math.abs(e.err));
    }
    return worst;
  }
}
