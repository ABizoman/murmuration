import { ROLES } from '../src/loops.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { owners, nextClaim, assignment, rolesFor, rendezvous } from '../src/swarm/roles.js';
import { Gossip } from '../src/net/gossip.js';
import { ClockSync } from '../src/net/clocksync.js';

test('claims: earliest wins, ties broken by smaller id', () => {
  const o = owners([
    { id: 'b', role: 'drums', ts: 100 },
    { id: 'a', role: 'drums', ts: 200 },
    { id: 'c', role: 'bass', ts: 50 },
    { id: 'a2', role: 'bass', ts: 50 },
  ]);
  assert.equal(o.drums.id, 'b');
  assert.equal(o.bass.id, 'a2');
  assert.equal(o.melody, null);
});

test('newcomers take free roles in priority order and never steal', () => {
  let claims = [];
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  ids.forEach((id, i) => claims.push({ id, role: nextClaim(id, claims), ts: i }));
  // the core band first, then the extra layers; an eighth device doubles
  assert.deepEqual(claims.map((c) => c.role), ['chords', 'drums', 'bass', 'melody', 'pad', 'arp', 'perc', null]);
  // m1 keeps chords even when re-evaluated
  assert.equal(nextClaim('m1', claims), 'chords');
});

test('two devices claim the same role at the same time: both agree who switches', () => {
  const claims = [{ id: 'zz', role: 'chords', ts: 10 }, { id: 'aa', role: 'chords', ts: 10 }];
  assert.equal(nextClaim('aa', claims), 'chords');
  assert.equal(nextClaim('zz', claims), 'drums');
});

test('every role is sounded by someone; orphan roles are covered the same way by everyone', () => {
  const claims = [{ id: 'p', role: 'chords', ts: 1 }, { id: 'q', role: 'drums', ts: 2 }];
  const live = ['p', 'q'];
  const a = assignment(claims, live);
  for (const r of ROLES) assert.ok(a.players[r].length >= 1, r);
  const union = new Set([...rolesFor('p', claims, live), ...rolesFor('q', claims, live)]);
  assert.equal(union.size, ROLES.length);
  assert.equal(rendezvous('bass', ['p', 'q']), rendezvous('bass', ['q', 'p']), 'order-independent');
});

test('when an owner leaves, its role gets covered', () => {
  const claims = [{ id: 'p', role: 'chords', ts: 1 }, { id: 'q', role: 'drums', ts: 2 }, { id: 'r', role: 'bass', ts: 3 }];
  const after = claims.filter((c) => c.id !== 'q');
  const roles = new Set([...rolesFor('p', after, ['p', 'r']), ...rolesFor('r', after, ['p', 'r'])]);
  assert.ok(roles.has('drums'));
});

test('a lone device sounds every role', () => {
  assert.equal(rolesFor('solo', [{ id: 'solo', role: 'chords', ts: 0 }], ['solo']).size, ROLES.length);
});

test('gossip reaches everyone on a line topology, exactly once each', () => {
  // a - b - c - d (no direct a-d link)
  const links = { a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] };
  const got = { a: [], b: [], c: [], d: [] };
  const nodes = {};
  for (const id of Object.keys(links))
    nodes[id] = new Gossip({
      id,
      neighbours: () => links[id],
      send: (to, env) => queue.push([to, env, id]),
      deliver: (body) => got[id].push(body.n),
    });
  const queue = [];
  nodes.a.publish({ n: 1 });
  nodes.d.publish({ n: 2 });
  while (queue.length) {
    const [to, env, from] = queue.shift();
    nodes[to].receive(env, from);
  }
  assert.deepEqual(got.b.sort(), [1, 2]);
  assert.deepEqual(got.c.sort(), [1, 2]);
  assert.deepEqual(got.d, [1]);
  assert.deepEqual(got.a, [2]);
});

test('clock sync: a joiner snaps to the swarm, then two clocks converge without a leader', () => {
  let t = 0;
  // A is 0 ms off, B's local clock is 437 ms ahead, one-way delay 15 ms
  const A = new ClockSync({ localNow: () => t });
  const B = new ClockSync({ localNow: () => t + 437 });
  const exchange = (x, y) => {
    const ping = x.ping();
    t += 15;
    const pong = y.answer(ping);
    t += 15;
    x.onPong('peer', pong);
  };
  A.step({ lockedPeers: [], alone: true, playing: false });
  assert.ok(A.locked);
  for (let i = 0; i < 4; i++) { exchange(B, A); exchange(A, B); }
  assert.equal(B.step({ lockedPeers: ['peer'], alone: false, playing: false }), 'joined');
  assert.ok(Math.abs(A.now() - B.now()) < 2, `after join: ${A.now() - B.now()}`);

  // now drift B by 30 ms and let both nudge each other while playing
  B.offset += 30;
  for (let i = 0; i < 200; i++) {
    exchange(A, B); exchange(B, A);
    A.step({ lockedPeers: ['peer'], alone: false, playing: true });
    B.step({ lockedPeers: ['peer'], alone: false, playing: true });
  }
  assert.ok(Math.abs(A.now() - B.now()) < 2, `after drift: ${A.now() - B.now()}`);
  assert.ok(Math.abs(A.offset) > 5, 'A moved too: nobody is the reference');
});
