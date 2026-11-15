// Audio: sampled instruments (Tone.Sampler) with the old synths as a fallback while samples load
// or for the "synth" voices. Converts clock time (epoch ms) to the audio clock with
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
const ROLE_GAIN = { drums: -5, bass: 8, chords: 3, melody: 7 };

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

function makeSynths(strip) {
  const hatFilter = new Tone.Filter(7000, 'highpass').connect(strip.hats);
  const drums = {
    kick: new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.03 }).connect(strip.kick),
    snare: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(strip.body),
    hat: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(hatFilter),
    ohat: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).connect(hatFilter),
  };
  drums.snare.volume.value = -10;
  drums.hat.volume.value = -14;
  drums.ohat.volume.value = -18;
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.2 },
    filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.3, baseFrequency: 80, octaves: 2.5 },
  }).connect(strip.bass);
  bass.volume.value = -10;
  const chords = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 0.8 } }).connect(strip.chords);
  chords.volume.value = -15;
  // The melody's delay now lives in the mix (a send on the melody strip), not on the synth.
  const melody = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3 } }).connect(strip.melody);
  melody.volume.value = -17;
  return { drums, bass, chords, melody };
}

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
  const synth = makeSynths(strip);
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

  function playSynth(role, n, t, d, sSec) {
    const v = gainOf(n.vel);
    if (role === 'drums') {
      const kind = n.drum === 'hihat' ? 'hat' : n.drum;
      const s = synth.drums[kind] || (n.drum?.startsWith('tom') ? synth.drums.kick : null);
      if (!s) return;
      if (s === synth.drums.kick) s.triggerAttackRelease(n.drum?.startsWith('tom') ? 'G2' : 'C1', d, t, v);
      else s.triggerAttackRelease(d, t, v);
    } else if (role === 'chords') {
      const ts = strumTimes(n, t, sSec);
      n.midis.forEach((m, k) => synth.chords.triggerAttackRelease(freq(m), d * 0.95, ts[k], v));
    } else if (role === 'bass') synth.bass.triggerAttackRelease(freq(n.midi), d * 0.95, t, v);
    else if (role === 'melody') synth.melody.triggerAttackRelease(freq(n.midi), d * 0.95, t, v);
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
        if (voiceId && !voiceById[voiceId]?.synth) ensure(voiceId); // fall back to the synth until it's loaded
        return playSynth(role, n, t, d, sSec);
      }
      try {
        if (role === 'drums') {
          const drum = drumName(n.drum);
          const part = s.parts?.[DRUM_STRIP[drum]];
          if (!part || !DRUM_NOTE[drum]) return playSynth(role, n, t, d, sSec); // crash/ride: no sample in these kits
          part.triggerAttackRelease(DRUM_NOTE[drum], DRUM_LEN[n.drum] ?? 0.4, t, gainOf(drum === 'ohat' ? n.vel * 0.8 : n.vel));
        } else if (role === 'chords') {
          const ts = strumTimes(n, t, sSec);
          n.midis.forEach((m, k) => s.triggerAttackRelease(noteName(m), d * 0.98, ts[k], gainOf(n.vel)));
        } else s.triggerAttackRelease(noteName(n.midi), d * 0.98, t, gainOf(n.vel));
      } catch (err) {
        playSynth(role, n, t, d, sSec);
      }
    },
  };
}
