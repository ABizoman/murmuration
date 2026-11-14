// The director: a slow LLM layer that proposes a general direction for the next section
// (4 phrases): how much energy, who to feature, who drops out, who should echo or answer whom.
//
// Every device can propose. There is no leader: proposals are gossiped, every device endorses
// the earliest proposal it has seen (ties: smaller id), and a proposal takes effect on a device
// once more than half of the live devices endorse it. A device that is cut off keeps the last
// direction it knew (or follows its own proposals if it can still reach an LLM).

import { DEFAULT_DIRECTIVE, sanitiseDirective, describeDirective } from './directive.js';

export const SECTION_PHRASES = 4;
export const sectionOf = (phrase) => Math.floor(phrase / SECTION_PHRASES);

export class Director {
  // request(state) -> Promise<{ directive, source }>; publish(body) gossips; liveCount() includes me
  constructor({ id, now, publish, liveCount, request, log = () => {}, random = Math.random, onChange = () => {}, maxDelayMs = 1500 }) {
    Object.assign(this, { id, now, publish, liveCount, request, log, random, onChange, maxDelayMs });
    this.proposals = new Map(); // section -> Map(pid -> proposal)
    this.endorsements = new Map(); // section -> Map(deviceId -> pid)
    this.adopted = new Map(); // section -> proposal
    this.requested = new Set();
    this.status = 'idle';
  }

  reset() {
    this.proposals.clear();
    this.endorsements.clear();
    this.adopted.clear();
    this.requested.clear();
  }

  // Called when a phrase is planned. In the third phrase of a section, think about the next one.
  maybePropose(phrase, describeState) {
    if (phrase % SECTION_PHRASES !== SECTION_PHRASES - 2) return;
    const section = sectionOf(phrase) + 1;
    if (this.requested.has(section)) return;
    this.requested.add(section);
    setTimeout(async () => {
      if (this.proposals.get(section)?.size) return; // someone already proposed: endorse theirs instead
      try {
        this.status = 'thinking';
        this.onChange();
        const res = await this.request(describeState());
        const directive = sanitiseDirective(res?.directive);
        if (!directive) throw new Error('unusable answer');
        this.status = `proposing (${res.source})`;
        const proposal = { type: 'proposal', section, pid: `${this.id}:${section}`, by: this.id, ts: this.now(), directive, source: res.source };
        this.onProposal(proposal);
        this.publish(proposal);
      } catch (err) {
        this.status = 'unreachable';
      }
      this.onChange();
    }, this.random() * this.maxDelayMs);
  }

  onProposal(p) {
    const directive = sanitiseDirective(p.directive);
    if (!directive || !Number.isInteger(p.section) || typeof p.pid !== 'string') return;
    if (!this.proposals.has(p.section)) this.proposals.set(p.section, new Map());
    const known = this.proposals.get(p.section);
    if (known.has(p.pid)) return;
    known.set(p.pid, { section: p.section, pid: p.pid, by: p.by, ts: Number(p.ts) || 0, directive, source: String(p.source || 'llm').slice(0, 40) });
    // endorse the earliest proposal seen so far
    const best = [...known.values()].sort((a, b) => a.ts - b.ts || (a.pid < b.pid ? -1 : 1))[0];
    const mine = this.endorsements.get(p.section)?.get(this.id);
    if (mine !== best.pid) {
      this.onEndorse({ section: p.section, pid: best.pid }, this.id);
      this.publish({ type: 'endorse', section: p.section, pid: best.pid });
    }
    this.tally(p.section);
  }

  onEndorse(e, from) {
    if (!Number.isInteger(e.section) || typeof e.pid !== 'string') return;
    if (!this.endorsements.has(e.section)) this.endorsements.set(e.section, new Map());
    this.endorsements.get(e.section).set(from, e.pid);
    this.tally(e.section);
  }

  tally(section) {
    const votes = new Map();
    for (const pid of this.endorsements.get(section)?.values() || []) votes.set(pid, (votes.get(pid) || 0) + 1);
    for (const [pid, n] of votes) {
      const proposal = this.proposals.get(section)?.get(pid);
      if (!proposal || n * 2 <= this.liveCount()) continue;
      if (this.adopted.get(section)?.pid === pid) return;
      this.adopted.set(section, { ...proposal, votes: n });
      this.log(`<b>direction adopted</b> for section ${section + 1} (${n} of ${this.liveCount()} devices, proposed by ${proposal.by}, ${proposal.source}): ${describeDirective(proposal.directive)}${proposal.directive.note ? ` — “${proposal.directive.note}”` : ''}`);
      for (const s of this.adopted.keys()) if (s < section - 3) { this.adopted.delete(s); this.proposals.delete(s); this.endorsements.delete(s); }
      this.onChange();
      return;
    }
  }

  // The newest adopted direction at or before this phrase's section.
  current(phrase) {
    const s = sectionOf(phrase);
    let best = null;
    for (const [sec, p] of this.adopted) if (sec <= s && (!best || sec > best.section)) best = p;
    return best;
  }

  directiveFor(phrase) {
    return this.current(phrase)?.directive || DEFAULT_DIRECTIVE;
  }

  // From a welcome packet: take the swarm's current direction if we have nothing for that section.
  adoptFromPeer(p) {
    const directive = sanitiseDirective(p?.directive);
    if (!directive || !Number.isInteger(p.section) || this.adopted.has(p.section)) return;
    this.adopted.set(p.section, { section: p.section, pid: String(p.pid), by: p.by, ts: Number(p.ts) || 0, directive, source: String(p.source || 'llm').slice(0, 40), votes: p.votes });
    this.onChange();
  }
}
