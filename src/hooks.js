// Hooks: the chorus should be the same chorus every time (Phase 5 of docs/MUSIC_QUALITY_PLAN.md).
//
// The first time a part plays the first phrase of a hook section, the loop it chose becomes that
// part's hook: the engine records it here and the swarm broadcasts it ({ type: 'hook', ... }), and
// a device that joins later gets the whole book in the welcome. In every later hook section the
// agent puts the hook loop first (agent.js), so the chorus comes back, on whichever device plays
// the part, even after a takeover.
//
// If two devices ever record a hook for the same role, everyone keeps the same one: the earliest
// phrase wins, and on a tie the lowest device id. Pure data, no clock and no randomness.

export const HOOK_ROLES = ['bass', 'chords', 'melody'];

const valid = (e) =>
  e && HOOK_ROLES.includes(e.role) && typeof e.loopId === 'string' && e.loopId.length <= 200 &&
  Number.isInteger(e.phrase) && e.phrase >= 0 && Number.isInteger(e.register ?? 0);

export class HookBook {
  constructor() {
    this.entries = {};
  }

  // Returns true if the entry is now the role's hook.
  record(entry) {
    if (!valid(entry)) return false;
    const e = { role: entry.role, loopId: entry.loopId, register: entry.register ?? 0, phrase: entry.phrase, by: String(entry.by ?? '') };
    const cur = this.entries[e.role];
    if (cur && (cur.phrase < e.phrase || (cur.phrase === e.phrase && cur.by <= e.by))) return false;
    this.entries[e.role] = e;
    return true;
  }

  get(role) {
    return this.entries[role] || null;
  }

  all() {
    return Object.values(this.entries);
  }

  clear() {
    this.entries = {};
  }
}
