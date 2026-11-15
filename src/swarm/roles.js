// Role claiming without a leader. Every device runs the same pure functions on the same gossiped
// claims, so they all reach the same answer.
//
// - Each device claims one role: { role, ts } where ts is shared-clock time of the claim.
// - Tie-break: for each role, the earliest claim wins; equal times -> the smaller device id wins.
//   A device that loses claims the next free role (priority order below). Old claims always beat
//   new ones, so a newcomer never takes a part away from someone already playing it.
// - A role nobody owns is covered by one device chosen by rendezvous hashing over the live
//   devices (highest hash(role, id) wins). Everyone computes the same winner, no election needed.
// - With more devices than roles, spare devices double a role (also chosen by hash).

import { ROLES } from '../loops.js';

export const ROLE_PRIORITY = ['chords', 'drums', 'bass', 'melody'];

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const beats = (a, b) => a.ts < b.ts || (a.ts === b.ts && a.id < b.id);

// claims: [{ id, role, ts }] from live devices only
export function owners(claims) {
  const out = Object.fromEntries(ROLES.map((r) => [r, null]));
  for (const c of claims) {
    if (!c.role || !(c.role in out)) continue;
    if (!out[c.role] || beats(c, out[c.role])) out[c.role] = c;
  }
  return out; // role -> winning claim or null
}

export function rendezvous(key, ids) {
  let best = null, bestH = -1;
  for (const id of ids) {
    const h = hash(`${key}|${id}`);
    if (h > bestH || (h === bestH && id < best)) { best = id; bestH = h; }
  }
  return best;
}

// What should `me` claim, given everyone's claims? Returns a role or null (spare).
// prefer (optional, ?part=<role>): the part this device would like, if nobody owns it yet.
export function nextClaim(me, claims, prefer = null) {
  const own = owners(claims);
  const mine = claims.find((c) => c.id === me);
  if (mine?.role && own[mine.role]?.id === me) return mine.role; // keep it
  if (prefer && ROLES.includes(prefer) && (!own[prefer] || own[prefer].id === me)) return prefer;
  return ROLE_PRIORITY.find((r) => !own[r] || own[r].id === me) ?? null;
}

// The full picture: who sounds which role. liveIds includes me.
export function assignment(claims, liveIds) {
  const own = owners(claims);
  const players = Object.fromEntries(ROLES.map((r) => [r, []]));
  for (const r of ROLES) {
    if (own[r]) players[r].push({ id: own[r].id, why: 'owner' });
    else if (liveIds.length) players[r].push({ id: rendezvous(r, liveIds), why: 'covering' });
  }
  const owning = new Set(Object.values(own).filter(Boolean).map((c) => c.id));
  for (const id of liveIds) {
    if (owning.has(id)) continue;
    const covers = ROLES.some((r) => players[r].some((p) => p.id === id));
    if (!covers) {
      const r = ROLE_PRIORITY[hash(id) % ROLE_PRIORITY.length];
      players[r].push({ id, why: 'doubling' });
    }
  }
  return { owners: own, players };
}

export function rolesFor(me, claims, liveIds) {
  const { players } = assignment(claims, liveIds);
  return new Set(ROLES.filter((r) => players[r].some((p) => p.id === me)));
}
