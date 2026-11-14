// An agent owns one role. Each phrase it decides how busy to be and which style to play,
// then renders its loop against the shared structure. These decisions use the agent's own
// randomness, not the seed. In Phase 3 they will also take the other agents' parts into account.

import { DENSITIES } from './loops.js';
import { renderPhrase } from './render.js';

// When each role comes in, for a nicer arrangement when playing alone.
const ENTRY_PHRASE = { chords: 0, drums: 1, bass: 1, melody: 2 };

export class Agent {
  constructor(role, library, random = Math.random) {
    this.role = role;
    this.library = library;
    this.random = random;
    this.level = 2; // 0 = silent, 1 sparse, 2 medium, 3 busy
    this.auto = true; // agent decides its own level
    this.register = 0; // octaves
    this.style = null;
    this.styleUntil = -1;
    this.prevVoicing = null;
  }

  decideLevel(phrase) {
    if (!this.auto) return;
    const entry = ENTRY_PHRASE[this.role];
    if (phrase < entry) this.level = 0;
    else if (phrase === entry || this.level === 0) this.level = 1;
    else if (this.random() < 0.4) this.level = Math.min(3, Math.max(1, this.level + (this.random() < 0.6 ? 1 : -1)));
  }

  compose(phrase, structure) {
    this.decideLevel(phrase);
    if (this.level === 0) return { notes: [], why: 'resting' };

    if (phrase >= this.styleUntil || !this.style) {
      const styles = this.library.styles(this.role);
      this.style = styles[Math.floor(this.random() * styles.length)];
      this.styleUntil = phrase + 2 + Math.floor(this.random() * 3);
    }
    const density = DENSITIES[this.level - 1];
    const loop = this.library.find(this.role, this.style, density);
    if (!loop) return { notes: [], why: `no ${this.style} loop` };

    const { notes, voicing } = renderPhrase(loop, { structure, phrase, register: this.register, prevVoicing: this.prevVoicing });
    this.prevVoicing = voicing;
    return { notes, loop, register: this.register, level: this.level, why: `${loop.id}${this.register ? ` (register ${this.register > 0 ? '+' : ''}${this.register})` : ''}` };
  }
}
