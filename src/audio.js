// Audio: sampled instruments (Tone.Sampler) and synth patches (one per synth voice, see PATCHES),
// with the role's default patch covering while a voice's samples load. Converts clock time (epoch ms) to the audio clock with
// getOutputTimestamp(), which pairs "what is coming out of the speaker now" with performance.now().
//
// play() is told the step length in ms as well, because a strummed chord carries one time offset
// per pitch (in steps, baked in by feel.js) and each pitch is triggered at its own moment.
//
// The mix is built from the data in mix.js: read that file for the signal flow. Everything here is
// per part or per bus -- no DSP runs per note, so a phone can hold the whole graph. Each kit loads
// three samplers (kick / snare and toms / hats) because those three go different ways in the mix.

import { VOICES, voiceById, DRUM_FILES } from './voices.js';
import { newMeters, addMeterSample } from './listen.js';
import { MIX, DRUM_STRIP, mixFor, isWeakDevice, dbToGain } from './mix.js';

const Tone = window.Tone;
const DRUM_NOTE = { kick: 'C2', snare: 'D2', hihat: 'F#2', ohat: 'A#2', tom1: 'D3', tom2: 'B2', tom3: 'G2' };
const DRUM_LEN = { kick: 0.6, snare: 0.5, hat: 0.06, ohat: 0.35, tom1: 0.6, tom2: 0.6, tom3: 0.7, crash: 1.2, ride: 0.5 };
// Measured by soloing each part (?solo=<role>) and reading the loudness meter in "Under the hood".
// Re-measure after any change to the graph in mix.js; see "How to A/B a change" in the README.
const ROLE_GAIN = { drums: -14, bass: 7.5, chords: 10.5, melody: 9 };

// Perceptual loudness: velocity 0.5 should sound about half as loud, which is not half the
// amplitude. Flat velocities were part of why the band sounded like a machine.
const gainOf = (v) => Math.min(1, Math.max(0, v || 0)) ** 1.6;

// One time per pitch of a chord: `offsets` (in steps) spreads a strum low to high.
const strumTimes = (n, t, sSec) =>
  n.midis.map((_, k) => (n.offsets?.length === n.midis.length ? t + n.offsets[k] * sSec : t));

const roleOf = (id) => Object.keys(VOICES).find((r) => VOICES[r].some((v) => v.id === id));
const drumName = (drum) => (drum === 'hat' ? 'hihat' : drum);
// The open hat has its own note (A#2) but no sample of its own: it is the hat, pitched down.
const sampleOf = (drum) => (drum === 'ohat' || drum === 'hat' ? 'hihat' : drum);
// Which samples a drum strip loads, derived from the routing in mix.js so the two cannot drift.
const stripFiles = (strip) => DRUM_FILES.concat('ohat').filter((f) => DRUM_STRIP[f] === strip && DRUM_NOTE[f]);

// ---- synth patches (Phase 4) --------------------------------------------------------
// One patch per synth voice (voices.js `synth: '<patch>'`), built the first time it is played and
// routed into its role's channel strip. The role's default patch also covers for a sampled voice
// while its samples are still loading. Level: ROLE_GAIN[role] + PATCH_DB + the voice's `gain`
// (measured with `npm run measure-levels -- --roles <role> --extra voice=<role>:<id>`), so moving
// ROLE_GAIN moves a whole part, samples and synths alike. The drum patch keeps its own levels.
export const PATCH_ROLE = { drums: 'drums', bass: 'bass', pad: 'chords', keys: 'chords', lead: 'melody', pluck: 'melody' };
export const ROLE_PATCH = { drums: 'drums', bass: 'bass', chords: 'pad', melody: 'lead' }; // fallback while loading
const PATCH_DB = { bass: -23, pad: -31, keys: -25, lead: -25.5, pluck: -23.5 };
// The kits have no crash sample: the crash and the riser are always synthesised, into the hats strip.
export const FX_DB = { crash: -16, riserFrom: -36, riserTo: -18 };

const PATCHES = {
  drums(strip) {
    const hatFilter = new Tone.Filter(7000, 'highpass').connect(strip.hats);
    const d = {
      kick: new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.03 }).connect(strip.kick),
      snare: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(strip.body),
      hat: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(hatFilter),
      ohat: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).connect(hatFilter),
      crash: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 1.2, sustain: 0 } })
        .connect(new Tone.Filter(5000, 'highpass').connect(strip.hats)),
    };
    d.snare.volume.value = -10;
    d.hat.volume.value = -14;
    d.ohat.volume.value = -18;
    d.crash.volume.value = FX_DB.crash;
    // A riser is one noise burst per note through a bandpass sweeping 300 Hz -> 6 kHz while the level
    // rises; built per note (one per section at most) and thrown away afterwards.
    d.riser = (t, dur, v) => {
      const out = new Tone.Gain(0).connect(strip.hats);
      const band = new Tone.Filter({ type: 'bandpass', frequency: 300, Q: 1.2 }).connect(out);
      const noise = new Tone.Noise('white').connect(band);
      band.frequency.setValueAtTime(300, t);
      band.frequency.exponentialRampToValueAtTime(6000, t + dur);
      out.gain.setValueAtTime(dbToGain(FX_DB.riserFrom) * v, t);
      out.gain.linearRampToValueAtTime(dbToGain(FX_DB.riserTo) * v, t + dur);
      out.gain.setValueAtTime(0, t + dur);
      noise.start(t).stop(t + dur + 0.05);
      const ms = (t + dur - Tone.getContext().rawContext.currentTime) * 1000 + 1000;
      setTimeout(() => [noise, band, out].forEach((n) => n.dispose()), Math.max(1000, ms));
    };
    return {
      play(n, t, d_, v) {
        const kind = n.drum === 'hihat' ? 'hat' : n.drum;
        if (kind === 'riser') return d.riser(t, Math.max(0.1, d_), v);
        const s = d[kind] || (n.drum?.startsWith('tom') ? d.kick : null);
        if (!s) return;
        if (s === d.kick) s.triggerAttackRelease(n.drum?.startsWith('tom') ? 'G2' : 'C1', d_, t, v);
        else if (s === d.crash) s.triggerAttackRelease(1.2, t, v);
        else s.triggerAttackRelease(d_, t, v);
      },
    };
  },

  // A sine sub an octave down (-6 dB) under a sawtooth with a fast filter envelope.
  bass(strip, out) {
    const env = { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.12 };
    const sub = new Tone.MonoSynth({ oscillator: { type: 'sine' }, portamento: 0.02, envelope: env,
      filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.12, baseFrequency: 2000, octaves: 0 } }).connect(out);
    sub.volume.value = -6;
    const saw = new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, portamento: 0.02, envelope: env, filter: { type: 'lowpass', Q: 1 },
      filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.3, release: 0.12, baseFrequency: 250, octaves: 2.5 } }).connect(out);
    return {
      play(n, t, d, v, freq) {
        saw.triggerAttackRelease(freq(n.midi), d, t, v);
        sub.triggerAttackRelease(freq(n.midi - 12), d, t, v);
      },
    };
  },

  // Fat saw pad -> lowpass 1.6 kHz (dark and soft) -> stereo chorus: where the chords get their width.
  pad(strip, out) {
    const chorus = new Tone.Chorus({ frequency: 2.5, delayTime: 3.5, depth: 0.6, wet: 0.4 }).connect(out);
    chorus.start();
    const filter = new Tone.Filter(1600, 'lowpass').connect(chorus);
    return poly(new Tone.PolySynth(Tone.Synth, { maxPolyphony: 12, oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
      envelope: { attack: 0.15, decay: 0.4, sustain: 0.7, release: 1.2 } }).connect(filter));
  },

  // A soft FM electric piano. Its voice's family is 'keys', so feel.js strums it.
  keys(strip, out) {
    return poly(new Tone.PolySynth(Tone.FMSynth, { maxPolyphony: 12, harmonicity: 3, modulationIndex: 2.5,
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.005, decay: 1.2, sustain: 0.2, release: 0.8 },
      modulationEnvelope: { attack: 0.005, decay: 0.6, sustain: 0.1, release: 0.6 } }).connect(out));
  },

  // Triangle waves (soft, few overtones) through a 2.2 kHz lowpass: round, not buzzy.
  pluck(strip, out) {
    const filter = new Tone.Filter(2200, 'lowpass').connect(out);
    return poly(new Tone.PolySynth(Tone.Synth, { maxPolyphony: 6, oscillator: { type: 'fattriangle', count: 2, spread: 12 },
      envelope: { attack: 0.004, decay: 0.3, sustain: 0.08, release: 0.25 } }).connect(filter));
  },

  // A mono lead with portamento, and a vibrato that fades in 300 ms into every note.
  lead(strip, out) {
    const vibrato = new Tone.Vibrato({ frequency: 5, depth: 0 }).connect(out);
    const synth = new Tone.MonoSynth({ oscillator: { type: 'fatsawtooth', count: 2, spread: 12 }, portamento: 0.03,
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.25 }, filter: { type: 'lowpass', Q: 0.8 },
      filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.6, release: 0.25, baseFrequency: 900, octaves: 0.8 } }).connect(vibrato);
    return {
      play(n, t, d, v, freq) {
        vibrato.depth.cancelScheduledValues(t);
        vibrato.depth.setValueAtTime(0, t);
        if (d > 0.3) vibrato.depth.linearRampToValueAtTime(0.08, t + 0.3);
        synth.triggerAttackRelease(freq(n.midi), d, t, v);
      },
    };
  },
};

// A polyphonic patch plays chords (one trigger per pitch, strummed by `offsets`) or single notes.
function poly(synth) {
  return {
    play(n, t, d, v, freq, sSec) {
      if (Array.isArray(n.midis)) {
        const ts = strumTimes(n, t, sSec);
        n.midis.forEach((m, k) => synth.triggerAttackRelease(freq(m), d, ts[k], v));
      } else if (n.midi != null) synth.triggerAttackRelease(freq(n.midi), d, t, v);
    },
  };
}

// The patch a voice plays through: its own if it is a synth voice, otherwise the role's default.
export const patchFor = (voiceId, role) => {
  const p = voiceById[voiceId]?.synth;
  return typeof p === 'string' && PATCHES[p] ? p : ROLE_PATCH[role];
};

// master -> glue -> limiter -> destination, then the buses, sends and channel strips.
// Returns the strip inputs (what instruments connect to) plus the handles the rest of the file
// needs: the duck gains, and what the lite switch has to silence.
function buildMix(mix) {
  const master = new Tone.EQ3(mix.master.eq);
  const limiter = new Tone.Limiter(mix.master.limiter).toDestination(); // the UI taps the destination
  master.chain(new Tone.Compressor(mix.master.glue), limiter);

  const room = mix.fx.room ? new Tone.Reverb({ ...mix.fx.room, wet: 1 }).connect(master) : null;
  const hall = mix.fx.hall ? new Tone.Reverb({ ...mix.fx.hall, wet: 1 }).connect(master) : null;
  let delay = null;
  if (mix.fx.delay) {
    delay = new Tone.PingPongDelay({ delayTime: mix.fx.delay.time, feedback: mix.fx.delay.feedback, wet: 1 });
    delay.connect(new Tone.Filter(mix.fx.delay.hp, 'highpass').connect(master));
  }
  const fx = { room, hall, delay };

  // Tone's connect() returns the source, not the destination, so each chain is wired explicitly.
  const buses = {};
  const ducks = {};
  for (const [name, spec] of Object.entries(mix.buses)) {
    const chain = [new Tone.Gain(1)];
    if (spec.duck != null) chain.push((ducks[name] = new Tone.Gain(1)));
    if (spec.comp) chain.push(new Tone.Compressor(spec.comp));
    chain.push(master);
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    buses[name] = chain[0];
  }

  const strip = {};
  const hallSends = [];
  const wideners = [];
  for (const [name, spec] of Object.entries(mix.strips)) {
    const chain = [];
    if (spec.hp) chain.push(new Tone.Filter(spec.hp, 'highpass'));
    if (spec.eq) chain.push(new Tone.EQ3({ low: 0, mid: 0, high: 0, ...spec.eq }));
    if (spec.widen != null) {
      const w = new Tone.StereoWidener(spec.widen);
      wideners.push(w);
      chain.push(w);
    } else chain.push(new Tone.Panner(spec.pan || 0));
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    const tail = chain[chain.length - 1];
    tail.connect(buses[spec.bus]);
    for (const send of ['room', 'hall', 'delay']) {
      if (!spec[send] || !fx[send]) continue;
      const g = new Tone.Gain(spec[send]).connect(fx[send]);
      tail.connect(g);
      if (send === 'hall') hallSends.push(g);
    }
    strip[name] = chain[0];
  }
  return { strip, buses, ducks, fx, hallSends, wideners };
}

export async function createAudio({ onStatus = () => {}, lite = null } = {}) {
  await Tone.start(); // must run inside a user gesture
  const raw = Tone.getContext().rawContext;

  let isLite = lite == null ? isWeakDevice(globalThis.navigator) : !!lite;
  const mix = mixFor(isLite);
  const { strip, ducks, fx, hallSends, wideners } = buildMix(mix);
  // Patches are built the first time something plays through them.
  const patches = {};
  function patch(name) {
    if (patches[name]) return patches[name];
    const role = PATCH_ROLE[name];
    const owner = Object.values(VOICES).flat().find((v) => v.synth === name);
    const out = name === 'drums' ? null : new Tone.Gain(dbToGain((ROLE_GAIN[role] ?? 0) + (PATCH_DB[name] ?? -25) + (owner?.gain ?? 0))).connect(strip[role]);
    return (patches[name] = PATCHES[name](strip, out));
  }
  const freq = (m) => Tone.Frequency(m, 'midi').toFrequency();
  const noteName = (m) => Tone.Frequency(m, 'midi').toNote();

  // Drop to the lite graph while playing (the watchdog in main.js calls this when ticks slip).
  function setLite() {
    if (isLite) return false;
    isLite = true;
    const hall = fx.hall;
    fx.hall = null;
    for (const g of hallSends) g.gain.rampTo(0, 0.5);
    for (const w of wideners) w.wet.rampTo(0, 0.5);
    setTimeout(() => hall?.dispose(), 800); // a silent convolver still costs CPU
    return true;
  }

  // The pop "pump": every kick dips the bass and chord buses, which come back over 120 ms.
  function duckAt(t) {
    for (const [name, g] of Object.entries(ducks)) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(dbToGain(mix.buses[name].duck), t);
      g.gain.linearRampToValueAtTime(1, t + MIX.duckMs / 1000);
    }
  }

  // ---- listening tools: master meters and the record button ------------------------
  // Both tap Tone.getDestination() (the final node), so they measure and record exactly what
  // comes out of the speaker, whatever the graph in front of it looks like.
  const peakTap = new Tone.Analyser({ type: 'waveform', size: 2048 });
  const rmsTap = new Tone.Meter({ smoothing: 0.9 }); // slow: an approximate loudness, not a peak
  Tone.getDestination().connect(peakTap);
  Tone.getDestination().connect(rmsTap);
  let meters = newMeters();
  let metering = null;
  // 2048 samples is ~46 ms, so sampling every 40 ms sees the whole signal: no peak slips through.
  metering = setInterval(() => {
    const buf = peakTap.getValue();
    let peak = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
    meters = addMeterSample(meters, { peakDb: Tone.gainToDb(peak), rmsDb: rmsTap.getValue() }, performance.now());
  }, 40);

  let recorder = null;
  let recording = null;
  async function recordClip(seconds = 60) {
    if (!Tone.Recorder.supported) throw new Error('this browser cannot record audio');
    if (recording) return recording; // one at a time: a second press joins the first recording
    if (!recorder) {
      recorder = new Tone.Recorder();
      Tone.getDestination().connect(recorder);
    }
    recording = (async () => {
      await recorder.start();
      await new Promise((done) => setTimeout(done, seconds * 1000));
      return recorder.stop();
    })();
    try {
      return await recording;
    } finally {
      recording = null;
    }
  }

  // ---- sampled voices -------------------------------------------------------------
  const samplers = new Map(); // voice id -> Tone.Sampler, or { parts: { strip: Tone.Sampler } } for kits
  const loading = new Map(); // id -> Promise
  const failed = new Set();
  const status = () => onStatus({ loaded: samplers.size, loading: loading.size - samplers.size - failed.size, failed: failed.size });

  // One Sampler, connected to its channel strip, resolving to null if its samples don't load.
  function loadSampler(urls, baseUrl, { release, volume, out }) {
    return new Promise((resolve) => {
      const s = new Tone.Sampler({
        urls,
        baseUrl,
        attack: 0.005,
        release,
        onload: () => resolve(s),
        onerror: (err) => {
          console.warn(`could not load ${baseUrl}`, err);
          resolve(null);
        },
      });
      s.volume.value = volume;
      s.connect(out);
    });
  }

  function ensure(id) {
    const v = voiceById[id];
    if (!v || v.synth) return Promise.resolve(null);
    if (loading.has(id)) return loading.get(id);
    const role = roleOf(id);
    const volume = (ROLE_GAIN[role] ?? -8) + (v.gain ?? 0);
    const p = (async () => {
      if (v.kit) {
        // Three samplers per kit: the kick, the snare and toms, and the hats all take their own
        // route through the mix (see mix.js), and a Sampler has only one output.
        const names = Object.keys(mix.strips).filter((s) => mix.strips[s].bus === 'drums');
        const loaded = await Promise.all(names.map((name) =>
          loadSampler(Object.fromEntries(stripFiles(name).map((f) => [DRUM_NOTE[f], `${sampleOf(f)}.mp3`])),
            `/samples/kits/${v.kit}/`, { release: 0.08, volume, out: strip[name] })));
        const parts = {};
        names.forEach((name, i) => loaded[i] && (parts[name] = loaded[i]));
        if (!Object.keys(parts).length) {
          failed.add(id);
          status();
          return null;
        }
        samplers.set(id, { parts });
        status();
        return parts;
      }
      const s = await loadSampler(Object.fromEntries(v.files.map((n) => [n, `${n.replace('#', 's')}.mp3`])),
        `/samples/${v.dir}/`, { release: v.release ?? 0.5, volume, out: strip[role] });
      if (!s) failed.add(id);
      else samplers.set(id, s);
      status();
      return s;
    })();
    loading.set(id, p);
    status();
    return p;
  }

  // Load voices one after another in the background (phones on venue Wi-Fi).
  async function preload(ids) {
    for (const id of ids) await ensure(id);
  }

  function playSynth(role, n, t, d, sSec, voiceId) {
    const name = patchFor(voiceId, role);
    const dur = role === 'drums' ? d : d * 0.95;
    patch(name).play(n, t, dur, gainOf(n.vel), freq, sSec);
  }

  function toAudioTime(epochMs) {
    let { contextTime, performanceTime } = raw.getOutputTimestamp ? raw.getOutputTimestamp() : {};
    if (!contextTime || !performanceTime) {
      contextTime = raw.currentTime;
      performanceTime = performance.now();
    }
    return contextTime + (epochMs - performance.timeOrigin - performanceTime) / 1000;
  }

  return {
    ensure,
    preload,
    isReady: (id) => samplers.has(id) || !!voiceById[id]?.synth,
    recordClip,
    canRecord: () => !!Tone.Recorder.supported,
    isRecording: () => !!recording,
    meters: () => meters,
    resetMeters: () => { meters = newMeters(); },
    isLite: () => isLite,
    setLite,
    dispose: () => clearInterval(metering), // only the tests need this; the page lives as long as the tab
    play(role, n, whenMs, durMs, voiceId, stepMs = 0) {
      const t = Math.max(toAudioTime(whenMs), raw.currentTime);
      const d = durMs / 1000;
      const sSec = stepMs / 1000;
      if (role === 'drums' && n.drum === 'kick') duckAt(t); // whichever kit (or synth) plays it
      const s = samplers.get(voiceId);
      if (!s) {
        if (voiceId && !voiceById[voiceId]?.synth) ensure(voiceId); // the role's default patch until it's loaded
        return playSynth(role, n, t, d, sSec, voiceId);
      }
      try {
        if (role === 'drums') {
          const drum = drumName(n.drum);
          const part = s.parts?.[DRUM_STRIP[drum]];
          if (!part || !DRUM_NOTE[drum]) return playSynth(role, n, t, d, sSec, 'synth-drums'); // crash, riser, ride: synthesised
          part.triggerAttackRelease(DRUM_NOTE[drum], DRUM_LEN[n.drum] ?? 0.4, t, gainOf(drum === 'ohat' ? n.vel * 0.8 : n.vel));
        } else if (role === 'chords') {
          const ts = strumTimes(n, t, sSec);
          n.midis.forEach((m, k) => s.triggerAttackRelease(noteName(m), d * 0.98, ts[k], gainOf(n.vel)));
        } else s.triggerAttackRelease(noteName(n.midi), d * 0.98, t, gainOf(n.vel));
      } catch (err) {
        playSynth(role, n, t, d, sSec, role === 'drums' ? 'synth-drums' : null);
      }
    },
  };
}
