// WebRTC mesh. The signalling server is only used to swap offers/answers/ICE candidates.
// Rule (from the plan): the newcomer sends an offer to every device already there.
// After a data channel opens, all music traffic goes device to device.
//
// Relay fallback: venue Wi-Fi and the Windows firewall (on a "public" network) often block the
// direct link, while every device can still reach the server. If a device the server introduced
// has no open channel after RELAY_AFTER_MS (or its link fails), messages to it go through the
// server's WebSocket instead ({ type: 'relay', to, data }). The rest of the app can't tell the
// difference. If the direct link opens later, it takes over. A relayed link needs the server.

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
export const RELAY_AFTER_MS = 3500;

export class Mesh {
  constructor({ id, signalUrl, onMessage, onPeerOpen, onPeerClose, onStatus, relayAfterMs = RELAY_AFTER_MS }) {
    this.relayAfterMs = relayAfterMs;
    this.id = id;
    this.signalUrl = signalUrl;
    this.onMessage = onMessage;
    this.onPeerOpen = onPeerOpen || (() => {});
    this.onPeerClose = onPeerClose || (() => {});
    this.onStatus = onStatus || (() => {});
    this.peers = new Map(); // id -> { pc, dc, pending: [], open }
    this.relayed = new Set(); // ids reached through the server instead of a direct channel
    this.known = new Set(); // ids the server says are connected
    this.relayTimers = new Map();
    this.ws = null;
    this.serverUp = false;
    this.retryMs = 1000;
  }

  connect() {
    let ws;
    try { ws = new WebSocket(this.signalUrl); } catch { return this.scheduleReconnect(); }
    this.ws = ws;
    ws.onopen = () => {
      this.serverUp = true;
      this.retryMs = 1000;
      ws.send(JSON.stringify({ type: 'join', id: this.id }));
      this.onStatus({ server: 'up' });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.serverUp;
      this.serverUp = false;
      if (was) this.onStatus({ server: 'down' });
      this.scheduleReconnect();
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => this.onSignal(JSON.parse(e.data));
  }

  scheduleReconnect() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 1.5, 5000);
  }

  sendSignal(to, data) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'signal', to, data }));
  }

  async onSignal(msg) {
    if (msg.type === 'peers') {
      // I'm the newcomer: offer to everyone already there that I'm not already connected to.
      for (const pid of msg.ids) {
        this.known.add(pid);
        this.relayLater(pid);
        if (!this.isOpen(pid)) this.offer(pid).catch(() => {});
      }
    } else if (msg.type === 'peer-joined') {
      this.known.add(msg.id);
      this.relayLater(msg.id); // its offer should arrive; if no channel opens, relay
    } else if (msg.type === 'peer-left') {
      this.known.delete(msg.id);
      this.drop(msg.id, 'left (server)');
    } else if (msg.type === 'signal') {
      await this.handle(msg.from, msg.data);
    } else if (msg.type === 'relay') {
      if (!this.isOpen(msg.from)) this.useRelay(msg.from); // it relays to me: relay back
      this.onMessage(msg.from, msg.data);
    }
  }

  isOpen(pid) {
    return this.peers.get(pid)?.open === true || this.relayed.has(pid);
  }

  isDirect(pid) {
    return this.peers.get(pid)?.open === true;
  }

  relayLater(pid) {
    clearTimeout(this.relayTimers.get(pid));
    this.relayTimers.set(pid, setTimeout(() => {
      this.relayTimers.delete(pid);
      if (!this.isOpen(pid) && this.known.has(pid)) this.useRelay(pid);
    }, this.relayAfterMs));
  }

  useRelay(pid) {
    if (this.relayed.has(pid) || this.isDirect(pid) || this.ws?.readyState !== 1) return;
    this.relayed.add(pid);
    this.onStatus({ relay: pid });
    this.onPeerOpen(pid);
  }

  makePeer(pid) {
    this.drop(pid, null);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, dc: null, pending: [], open: false };
    this.peers.set(pid, peer);
    pc.onicecandidate = (e) => e.candidate && this.sendSignal(pid, { candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (this.peers.get(pid)?.pc !== pc) return;
      if (pc.connectionState === 'failed' && this.known.has(pid) && this.ws?.readyState === 1) {
        // the direct link failed but the server can still reach it: carry on through the server
        const wasDirect = peer.open;
        this.peers.delete(pid);
        try { pc.close(); } catch {}
        if (wasDirect) { this.relayed.add(pid); this.onStatus({ relay: pid }); } else this.useRelay(pid);
      } else if (['failed', 'closed'].includes(pc.connectionState)) this.drop(pid, pc.connectionState);
    };
    pc.ondatachannel = (e) => this.attach(pid, peer, e.channel);
    return peer;
  }

  attach(pid, peer, dc) {
    peer.dc = dc;
    dc.onopen = () => {
      const was = this.isOpen(pid);
      peer.open = true;
      this.relayed.delete(pid); // a direct link takes over from the relay
      if (!was) this.onPeerOpen(pid);
    };
    dc.onclose = () => {
      if (this.peers.get(pid)?.dc === dc) this.drop(pid, 'channel closed');
    };
    dc.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.onMessage(pid, msg);
    };
  }

  async offer(pid) {
    const peer = this.makePeer(pid);
    this.attach(pid, peer, peer.pc.createDataChannel('murmuration', { ordered: true }));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    this.sendSignal(pid, { sdp: peer.pc.localDescription.toJSON() });
  }

  async handle(pid, data) {
    let peer = this.peers.get(pid);
    if (data.sdp?.type === 'offer') {
      peer = this.makePeer(pid);
      await peer.pc.setRemoteDescription(data.sdp);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      this.sendSignal(pid, { sdp: peer.pc.localDescription.toJSON() });
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.sdp?.type === 'answer' && peer) {
      await peer.pc.setRemoteDescription(data.sdp);
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  }

  // Forget a device entirely: its direct link and its relay. (makePeer() calls this with no
  // reason to replace a link; the relay is kept then, until the new link opens.)
  drop(pid, reason) {
    const peer = this.peers.get(pid);
    const wasOpen = this.isOpen(pid);
    if (peer) {
      this.peers.delete(pid);
      try { peer.dc?.close(); } catch {}
      try { peer.pc.close(); } catch {}
    }
    if (reason) {
      this.relayed.delete(pid);
      clearTimeout(this.relayTimers.get(pid));
      if (wasOpen) this.onPeerClose(pid, reason);
    }
  }

  send(pid, msg) {
    const p = this.peers.get(pid);
    if (p?.open && p.dc.readyState === 'open') p.dc.send(JSON.stringify(msg));
    else if (this.relayed.has(pid) && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'relay', to: pid, data: msg }));
  }

  openPeers() {
    const direct = [...this.peers.entries()].filter(([, p]) => p.open).map(([id]) => id);
    return [...new Set([...direct, ...this.relayed])];
  }
}
