// A fake Tone.js for the graph tests: every node records what it is connected to and every
// parameter records its automation, so test/audio-graph.test.mjs can check the signal flow and
// the ducking without a browser or an audio context. Not a test file itself (npm test globs
// test/*.test.mjs).

export const DEST = { kind: 'destination', outs: [] };
export const nodes = [];
export const triggers = [];

const show = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);

class Param {
  constructor(value = 1) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push({ op: 'set', v, t }); return this; }
  linearRampToValueAtTime(v, t) { this.events.push({ op: 'ramp', v, t }); return this; }
  cancelScheduledValues(t) { this.events.push({ op: 'cancel', t }); return this; }
  rampTo(v, s) { this.events.push({ op: 'rampTo', v, s }); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push({ op: 'exp', v, t }); return this; }
}

class Node {
  constructor(kind, opts = {}) {
    this.kind = kind;
    this.opts = opts;
    this.outs = [];
    this.gain = new Param(typeof opts === 'number' ? opts : opts.gain ?? 1);
    this.wet = new Param(opts.wet ?? 1);
    this.volume = new Param(0);
    this.frequency = new Param(opts?.frequency ?? (typeof opts === 'number' ? opts : 0));
    this.depth = new Param(opts?.depth ?? 0);
    nodes.push(this);
  }
  connect(dest) { this.outs.push(dest); return this; } // Tone returns the source, not the target
  toDestination() { this.outs.push(DEST); return this; }
  chain(...rest) {
    let from = this;
    for (const n of rest) { from.connect(n); from = n; }
    return this;
  }
  triggerAttackRelease(...args) { triggers.push({ node: this, args }); return this; }
  start(t) { this.started = t ?? 0; return this; }
  stop(t) { this.stopped = t ?? 0; return this; }
  dispose() { this.disposed = true; return this; }
  get label() {
    const o = this.opts;
    if (this.kind === 'Filter') return `Filter(${show(o.frequency ?? o)} ${o.type ?? this.type ?? 'highpass'})`;
    if (this.kind === 'Panner') return `Panner(${show(o.pan ?? o)})`;
    if (this.kind === 'Gain') return `Gain(${show(this.gain.value)})`;
    if (this.kind === 'Compressor') return `Compressor(r${o.ratio})`;
    if (this.kind === 'Limiter') return `Limiter(${show(o)})`;
    if (this.kind === 'Reverb') return `Reverb(${o.decay})`;
    if (this.kind === 'EQ3') return `EQ3(mid ${o.mid ?? 0}, high ${o.high ?? 0})`;
    if (this.kind === 'StereoWidener') return `Widener(${show(o.width ?? o)})`;
    return this.kind;
  }
}

const node = (kind) => class extends Node {
  constructor(opts) { super(kind, opts === undefined ? {} : opts); }
};
// new Tone.Filter(freq, type) passes two arguments
class Filter extends Node {
  constructor(opts, type) { super('Filter', opts === undefined ? {} : opts); this.type = type; }
}
// new Tone.PolySynth(VoiceClass, options)
class PolySynth extends Node {
  constructor(voice, opts = {}) { super('PolySynth', opts); this.voice = voice?.kindName ?? 'Synth'; }
  get label() { return `PolySynth(${this.voice})`; }
}
const voiceClass = (kind) => { const C = node(kind); C.kindName = kind; return C; };

class Sampler extends Node {
  constructor(opts) {
    super('Sampler', opts);
    this.urls = opts.urls;
    this.baseUrl = opts.baseUrl;
    queueMicrotask(() => (Sampler.failUrls?.test(opts.baseUrl) ? opts.onerror?.(new Error('no')) : opts.onload?.()));
  }
}

export const makeFakeTone = () => {
  nodes.length = 0;
  triggers.length = 0;
  DEST.outs.length = 0;
  Sampler.failUrls = null;
  const raw0 = { currentTime: 0, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: performance.now() }) };
  let current = { rawContext: raw0 };
  // Tone.getDestination() is where the meters and the recorder tap; DEST is the speaker itself.
  const destination = new Node('destination-tap');
  return {
    start: async () => {},
    getContext: () => current,
    setContext: (c) => { current = c; },
    Context: class { constructor(o = {}) { this.opts = o; this.rawContext = { ...raw0, latencyHint: o.latencyHint }; } },
    getDestination: () => destination,
    gainToDb: (g) => 20 * Math.log10(g || 1e-9),
    dbToGain: (db) => 10 ** (db / 20),
    Frequency: (m) => ({ toFrequency: () => 440 * 2 ** ((m - 69) / 12), toNote: () => `midi${m}` }),
    Analyser: class extends Node {
      constructor(o) { super('Analyser', o); }
      getValue() { return new Float32Array(8); }
    },
    Meter: class extends Node {
      constructor(o) { super('Meter', o); }
      getValue() { return -20; }
    },
    Recorder: class extends Node {
      constructor(o) { super('Recorder', o); }
      static supported = true;
      async start() { this.recording = true; }
      async stop() { return { type: 'audio/webm', size: 1234 }; }
    },
    Sampler,
    Gain: node('Gain'), Filter, EQ3: node('EQ3'), Compressor: node('Compressor'),
    Limiter: node('Limiter'), Reverb: node('Reverb'), PingPongDelay: node('PingPongDelay'),
    StereoWidener: node('StereoWidener'), Panner: node('Panner'), MembraneSynth: node('MembraneSynth'),
    NoiseSynth: node('NoiseSynth'), MonoSynth: node('MonoSynth'), PolySynth, Synth: voiceClass('Synth'),
    FMSynth: voiceClass('FMSynth'), FrequencyEnvelope: node('FrequencyEnvelope'), Chorus: node('Chorus'), Vibrato: node('Vibrato'), Noise: node('Noise'),
  };
};

// Every route from a node to the speaker, as "Label -> Label -> ..." strings.
export function routes(from) {
  const out = [];
  const walk = (n, acc, seen) => {
    if (n === DEST) return out.push(acc.join(' -> ')); // acc already ends with its label
    if (seen.has(n)) return;
    for (const d of n.outs) walk(d, [...acc, d.label ?? d.kind], new Set([...seen, n]));
  };
  walk(from, [from.label ?? from.kind], new Set());
  return out;
}

export const lastTrigger = (kind) => [...triggers].reverse().find((t) => t.node.kind === kind);
export const triggersOn = (node) => triggers.filter((t) => t.node === node);
