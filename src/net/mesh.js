// WebRTC mesh. The signalling server is only used to swap offers/answers/ICE candidates.
// Rule (from the plan): the newcomer sends an offer to every device already there.
// After a data channel opens, all music traffic goes device to device.

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export class Mesh {
  constructor({ id, signalUrl, onMessage, onPeerOpen, onPeerClose, onStatus }) {
    this.id = id;
    this.signalUrl = signalUrl;
    this.onMessage = onMessage;
    this.onPeerOpen = onPeerOpen || (() => {});
    this.onPeerClose = onPeerClose || (() => {});
    this.onStatus = onStatus || (() => {});
    this.peers = new Map(); // id -> { pc, dc, pending: [], open }
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
      for (const pid of msg.ids) if (!this.isOpen(pid)) this.offer(pid);
    } else if (msg.type === 'peer-left') {
      this.drop(msg.id, 'left (server)');
    } else if (msg.type === 'signal') {
      await this.handle(msg.from, msg.data);
    }
  }

  isOpen(pid) {
    return this.peers.get(pid)?.open === true;
  }

  makePeer(pid) {
    this.drop(pid, null);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, dc: null, pending: [], open: false };
    this.peers.set(pid, peer);
    pc.onicecandidate = (e) => e.candidate && this.sendSignal(pid, { candidate: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.drop(pid, pc.connectionState);
    };
    pc.ondatachannel = (e) => this.attach(pid, peer, e.channel);
    return peer;
  }

  attach(pid, peer, dc) {
    peer.dc = dc;
    dc.onopen = () => {
      peer.open = true;
      this.onPeerOpen(pid);
    };
    dc.onclose = () => this.drop(pid, 'channel closed');
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

  drop(pid, reason) {
    const peer = this.peers.get(pid);
    if (!peer) return;
    this.peers.delete(pid);
    const wasOpen = peer.open;
    try { peer.dc?.close(); } catch {}
    try { peer.pc.close(); } catch {}
    if (wasOpen && reason) this.onPeerClose(pid, reason);
  }

  send(pid, msg) {
    const p = this.peers.get(pid);
    if (p?.open && p.dc.readyState === 'open') p.dc.send(JSON.stringify(msg));
  }

  openPeers() {
    return [...this.peers.entries()].filter(([, p]) => p.open).map(([id]) => id);
  }
}
