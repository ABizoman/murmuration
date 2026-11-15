// The swarm: glues mesh + gossip + clock sync + roles together.
//
// Messages on a data channel are either direct (neighbour only) or gossip envelopes:
//   direct: ping / pong (clock sync), hello / welcome (join handshake)
//   gossip: state (heartbeat: song, claim, clock locked), part (an agent's choice for a phrase)

import { Mesh } from '../net/mesh.js';
import { Gossip } from '../net/gossip.js';
import { ClockSync } from '../net/clocksync.js';
import { nextClaim, assignment, rolesFor } from './roles.js';
import { parseSeed } from '../seed.js';

const PEER_TIMEOUT_MS = 4000;

function makeId() {
  try {
    const saved = sessionStorage.getItem('murmuration-id');
    if (saved) return saved;
  } catch {}
  const id = Math.random().toString(36).slice(2, 8);
  try { sessionStorage.setItem('murmuration-id', id); } catch {}
  return id;
}

export function songWins(a, b) {
  // Deterministic. A newer generation wins (someone skipped to the next song, went back, or
  // started a new seed: every device switches); within a generation the song that started
  // earlier wins (two devices pressing Start at once); same start -> smaller seed.
  const ga = a.gen ?? 0, gb = b.gen ?? 0;
  if (ga !== gb) return ga > gb;
  if (a.startMs !== b.startMs) return a.startMs < b.startMs;
  return a.seed < b.seed;
}
const sameSong = (a, b) => a && b && a.seed === b.seed && Math.abs(a.startMs - b.startMs) < 1;

export class Swarm {
  constructor({ localNow, signalUrl, getPosition, events, welcomeExtra = () => ({}), preferRole = null }) {
    this.welcomeExtra = welcomeExtra;
    this.preferRole = preferRole; // ?part=<role>: the part this device claims if it is free
    this.id = makeId();
    this.ev = events; // { log, song, roles, part, change }
    this.getPosition = getPosition;
    this.clock = new ClockSync({ localNow });
    this.peers = new Map(); // id -> { lastSeen, state }
    this.song = null;
    this.playing = false;
    this.claim = null; // { role, ts }
    this.myRoles = new Set();
    this.serverPeersSeen = false;
    this.aloneSince = localNow();
    this.server = 'connecting';

    this.mesh = new Mesh({
      id: this.id,
      signalUrl,
      onMessage: (from, msg) => this.onMessage(from, msg),
      onPeerOpen: (pid) => this.onPeerOpen(pid),
      onPeerClose: (pid, why) => this.onPeerClose(pid, why),
      onStatus: ({ server, relay }) => {
        if (relay) {
          this.ev.log(`no direct link to ${relay} (blocked by the network?): talking through the server`);
          return this.ev.change();
        }
        this.server = server;
        this.ev.log(server === 'up' ? 'signalling server connected' : 'signalling server unreachable: existing links keep working');
        this.ev.change();
      },
    });
    const origOnSignal = this.mesh.onSignal.bind(this.mesh);
    this.mesh.onSignal = async (msg) => {
      if (msg.type === 'peers') {
        this.serverPeersSeen = true;
        this.serverPeerCount = msg.ids.length;
        if (msg.ids.length) this.ev.log(`server introduced me to ${msg.ids.join(', ')}: sending offers`);
      }
      if (msg.type === 'peer-joined') this.ev.log(`server: ${msg.id} joined, waiting for its offer`);
      return origOnSignal(msg);
    };
    this.gossip = new Gossip({
      id: this.id,
      send: (pid, env) => this.mesh.send(pid, env),
      neighbours: () => this.mesh.openPeers(),
      deliver: (body, origin) => this.onGossip(body, origin),
    });
  }

  start() {
    this.mesh.connect();
    this.timer = setInterval(() => this.tick(), 250);
    this.ticks = 0;
  }

  // ---- outgoing ---------------------------------------------------------------

  publishState() {
    this.gossip.publish({
      type: 'state',
      id: this.id,
      song: this.song,
      playing: this.playing,
      claim: this.playing ? this.claim : null,
      locked: this.clock.locked,
      roles: [...this.myRoles],
    });
  }

  publishPart(phrase, role, part) {
    // The notes travel with the choice, so every device can show (and react to) the real part.
    this.gossip.publish({ type: 'part', phrase, role, d: part.d, why: part.why, source: part.source, notes: part.notes });
  }

  publish(body) {
    this.gossip.publish(body);
  }

  // ---- incoming ---------------------------------------------------------------

  onPeerOpen(pid) {
    this.ev.log(`data channel open with ${pid} (direct, no server)`);
    const known = this.peers.get(pid);
    if (known) known.lastSeen = this.clock.localNow();
    else this.peers.set(pid, { lastSeen: this.clock.localNow(), state: null });
    this.mesh.send(pid, { d: 1, body: { type: 'hello', id: this.id } });
    this.mesh.send(pid, { d: 1, body: this.clock.ping() });
    this.publishState();
    this.ev.change();
  }

  onPeerClose(pid, why) {
    this.peers.delete(pid);
    this.clock.forget(pid);
    this.ev.log(`${pid} gone (${why})`);
    this.recompute();
    this.ev.change();
  }

  onMessage(from, msg) {
    const p = this.peers.get(from);
    if (p) p.lastSeen = this.clock.localNow();
    if (msg.g) return this.gossip.receive(msg, from);
    if (!msg.d) return;
    const b = msg.body;
    if (b.type === 'ping') this.mesh.send(from, { d: 1, body: this.clock.answer(b) });
    else if (b.type === 'pong') this.clock.onPong(from, b);
    else if (b.type === 'hello') this.onHello(from);
    else if (b.type === 'welcome') this.onWelcome(from, b);
  }

  onHello(from) {
    if (!this.song || !this.playing) return;
    const pos = this.getPosition();
    const { owners: own } = assignment(this.claims(), this.liveIds(), this.mode());
    const taken = Object.fromEntries(Object.entries(own).filter(([, c]) => c).map(([r, c]) => [r, c.id]));
    const free = Object.keys(own).filter((r) => !own[r]);
    this.mesh.send(from, { d: 1, body: { type: 'welcome', from: this.id, song: this.song, at: pos, taken, free, ...this.welcomeExtra() } });
  }

  onWelcome(from, b) {
    const taken = Object.entries(b.taken).map(([r, id]) => `${r}: ${id}`).join(', ') || 'none';
    this.ev.log(
      `<b>welcome from ${from}</b>: seed "${b.song.seed}", we're at phrase ${b.at?.phrase} bar ${(b.at?.bar ?? 0) + 1}; ` +
        `taken: ${taken}; free: ${b.free.join(', ') || 'none'}`,
    );
    this.considerSong(b.song, from);
    this.ev.welcome?.(b, from);
  }

  onGossip(body, origin) {
    if (origin === this.id) return;
    let p = this.peers.get(origin);
    if (!p) {
      p = { lastSeen: 0, state: null }; // reached us through someone else
      this.peers.set(origin, p);
    }
    p.lastSeen = this.clock.localNow();
    if (body.type === 'state') {
      const before = JSON.stringify(p.state?.claim);
      p.state = body;
      if (body.song) this.considerSong(body.song, origin);
      if (JSON.stringify(body.claim) !== before) this.recompute();
      this.ev.change();
    } else if (body.type === 'part') {
      this.ev.part(body, origin);
    } else {
      this.ev.message?.(body, origin);
    }
  }

  considerSong(song, from) {
    if (sameSong(song, this.song)) return;
    if (!this.song || songWins(song, this.song)) {
      const had = this.song;
      this.song = { seed: song.seed, startMs: song.startMs, gen: song.gen ?? 0 };
      this.ev.song(this.song, had ? (this.song.gen > (had.gen ?? 0) ? `${from} moved the band to a new song` : `switched to ${from}'s song (it started earlier)`) : `learned the song from ${from}`);
      this.publishState();
    }
  }

  // ---- local actions ----------------------------------------------------------

  // A new song. While a song is on, it takes the next generation, so it replaces the current song
  // on every device (songWins); it starts 1.2 s ahead so the others hear about it in time.
  startSong(seed) {
    const replacing = !!this.song;
    this.song = { seed, startMs: this.clock.now() + (replacing ? 1200 : 400), gen: replacing ? (this.song.gen ?? 0) + 1 : 0 };
    this.join();
    return this.song;
  }

  join() {
    this.playing = true;
    const role = nextClaim(this.id, this.claims(), this.preferRole, this.mode());
    this.claim = role ? { role, ts: this.clock.now() } : null;
    this.ev.log(role ? `claiming <b>${role}</b>` : 'all roles taken: doubling a part');
    this.recompute();
    this.publishState();
  }

  leave() {
    this.playing = false;
    this.claim = null;
    this.recompute();
    this.publishState();
  }

  // ---- derived state ----------------------------------------------------------

  liveIds() {
    const now = this.clock.localNow();
    const ids = [...this.peers.entries()]
      .filter(([, p]) => now - p.lastSeen < PEER_TIMEOUT_MS && p.state?.playing && sameSong(p.state.song, this.song))
      .map(([id]) => id);
    if (this.playing) ids.push(this.id);
    return ids.sort();
  }

  claims() {
    const live = new Set(this.liveIds());
    const out = [];
    for (const [id, p] of this.peers) if (live.has(id) && p.state?.claim) out.push({ id, ...p.state.claim });
    if (this.playing && this.claim) out.push({ id: this.id, ...this.claim });
    return out;
  }

  // Grow mode rides in the song's seed ("#grow"), so every device sharing parts agrees on it.
  mode() {
    return { grow: !!parseSeed(this.song?.seed).grow };
  }

  recompute() {
    if (this.playing) {
      const want = nextClaim(this.id, this.claims(), this.preferRole, this.mode());
      if ((want ?? null) !== (this.claim?.role ?? null)) {
        const lostTo = this.claim && assignment(this.claims(), this.liveIds(), this.mode()).owners[this.claim.role]?.id;
        this.claim = want ? { role: want, ts: this.clock.now() } : null;
        this.ev.log(lostTo && lostTo !== this.id ? `${lostTo} has the older claim on that part: switching to <b>${want ?? 'doubling'}</b>` : `claiming <b>${want ?? 'doubling'}</b>`);
        this.publishState();
      }
    }
    const roles = this.playing ? rolesFor(this.id, this.claims(), this.liveIds(), this.mode()) : new Set();
    const key = [...roles].sort().join();
    if (key !== [...this.myRoles].sort().join()) {
      this.myRoles = roles;
      this.ev.roles(roles);
      this.publishState();
    }
  }

  tick() {
    this.ticks++;
    const now = this.clock.localNow();
    const open = this.mesh.openPeers();

    if (this.ticks % 2 === 0) for (const p of open) this.mesh.send(p, { d: 1, body: this.clock.ping() });

    if (open.length) this.aloneSince = now;
    const alone = !open.length && ((this.serverPeersSeen && !this.serverPeerCount) || now - this.aloneSince > 3000);
    const lockedPeers = open.filter((p) => this.peers.get(p)?.state?.locked);
    const r = this.clock.step({ lockedPeers, alone, playing: this.playing });
    if (r === 'joined') this.ev.log(`clock synced to the swarm (offset ${Math.round(this.clock.offset)} ms)`);
    if (r === 'first') this.ev.log('no one else here: my clock is the starting point');

    for (const [id, p] of this.peers) {
      if (now - p.lastSeen <= PEER_TIMEOUT_MS) continue;
      if (open.includes(id)) this.mesh.drop(id, 'silent for 4 s'); // link looks open but nothing arrives
      else this.peers.delete(id);
    }
    if (this.ticks % 4 === 0) this.publishState();
    this.recompute();
    if (this.ticks % 4 === 0) this.ev.change();
  }

  view() {
    const { players } = assignment(this.claims(), this.liveIds(), this.mode());
    return {
      whyMine: Object.fromEntries(Object.entries(players).flatMap(([r, list]) => list.filter((p) => p.id === this.id).map((p) => [r, p.why]))),
      id: this.id,
      server: this.server,
      offset: this.clock.offset,
      locked: this.clock.locked,
      worstErr: this.clock.worstError(this.mesh.openPeers()),
      players,
      peers: [...this.peers.entries()].map(([id, p]) => ({
        id,
        direct: this.mesh.isOpen(id),
        relayed: this.mesh.relayed.has(id), // through the server (mesh.js relay fallback)
        rtt: this.clock.error(id)?.rtt,
        err: this.clock.error(id)?.err,
        state: p.state,
      })),
      gossip: this.gossip.stats,
    };
  }
}
