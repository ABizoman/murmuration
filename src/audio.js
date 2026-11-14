// Audio: sampled instruments (Tone.Sampler) with the old synths as a fallback while samples load
// or for the "synth" voices. Converts clock time (epoch ms) to the audio clock with
// getOutputTimestamp(), which pairs "what is coming out of the speaker now" with performance.now().

import { VOICES, voiceById, DRUM_FILES } from './voices.js';

const Tone = window.Tone;
const DRUM_NOTE = { kick: 'C2', snare: 'D2', hihat: 'F#2', ohat: 'A#2', tom1: 'D3', tom2: 'B2', tom3: 'G2' };
const DRUM_LEN = { kick: 0.6, snare: 0.5, hat: 0.06, ohat: 0.35, tom1: 0.6, tom2: 0.6, tom3: 0.7, crash: 1.2, ride: 0.5 };
// Set by measuring each part soloed (integrated loudness): drums ~-20, bass ~-22, chords ~-25, melody ~-22 LUFS.
const ROLE_GAIN = { drums: -5, bass: 8, chords: 3, melody: 7 };

function makeSynths(out, rev) {
  const hatFilter = new Tone.Filter(7000, 'highpass').connect(out);
  const drums = {
    kick: new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.03 }).connect(out),
    snare: new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(rev),
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
  }).connect(out);
  bass.volume.value = -10;
  const chords = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 0.8 } }).connect(rev);
  chords.volume.value = -15;
  const melody = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3 } }).connect(new Tone.FeedbackDelay('8n.', 0.25).connect(rev));
  melody.volume.value = -17;
  return { drums, bass, chords, melody };
}

export async function createAudio({ onStatus = () => {} } = {}) {
  await Tone.start(); // must run inside a user gesture
  const raw = Tone.getContext().rawContext;

  const out = new Tone.Limiter(-2).toDestination();
  const rev = new Tone.Reverb({ decay: 2.4, wet: 0.22 }).connect(out);
  const dry = new Tone.Gain(1).connect(out);
  const synth = makeSynths(out, rev);
  const freq = (m) => Tone.Frequency(m, 'midi').toFrequency();
  const noteName = (m) => Tone.Frequency(m, 'midi').toNote();

  // ---- sampled voices -------------------------------------------------------------
  const samplers = new Map(); // id -> Tone.Sampler (ready)
  const loading = new Map(); // id -> Promise
  const failed = new Set();
  const status = () => onStatus({ loaded: samplers.size, loading: loading.size - samplers.size - failed.size, failed: failed.size });

  function ensure(id) {
    const v = voiceById[id];
    if (!v || v.synth) return Promise.resolve(null);
    if (loading.has(id)) return loading.get(id);
    const p = new Promise((resolve) => {
      let urls, baseUrl;
      if (v.kit) {
        baseUrl = `/samples/kits/${v.kit}/`;
        urls = Object.fromEntries(DRUM_FILES.map((f) => [DRUM_NOTE[f], `${f}.mp3`]));
        urls[DRUM_NOTE.ohat] = 'hihat.mp3';
      } else {
        baseUrl = `/samples/${v.dir}/`;
        urls = Object.fromEntries(v.files.map((n) => [n, `${n.replace('#', 's')}.mp3`]));
      }
      const role = Object.keys(VOICES).find((r) => VOICES[r].some((x) => x.id === id));
      const s = new Tone.Sampler({
        urls,
        baseUrl,
        attack: 0.005,
        release: v.kit ? 0.08 : v.release ?? 0.5,
        onload: () => {
          samplers.set(id, s);
          status();
          resolve(s);
        },
        onerror: (err) => {
          console.warn(`could not load ${id}`, err);
          failed.add(id);
          status();
          resolve(null);
        },
      });
      s.volume.value = (ROLE_GAIN[role] ?? -8) + (v.gain ?? 0);
      s.connect(v.kit || role === 'bass' ? dry : rev);
    });
    loading.set(id, p);
    status();
    return p;
  }

  // Load voices one after another in the background (phones on venue Wi-Fi).
  async function preload(ids) {
    for (const id of ids) await ensure(id);
  }

  function playSynth(role, n, t, d) {
    if (role === 'drums') {
      const kind = n.drum === 'hihat' ? 'hat' : n.drum;
      const s = synth.drums[kind] || (n.drum?.startsWith('tom') ? synth.drums.kick : null);
      if (!s) return;
      if (s === synth.drums.kick) s.triggerAttackRelease(n.drum?.startsWith('tom') ? 'G2' : 'C1', d, t, n.vel);
      else s.triggerAttackRelease(d, t, n.vel);
    } else if (role === 'chords') synth.chords.triggerAttackRelease(n.midis.map(freq), d * 0.95, t, n.vel);
    else if (role === 'bass') synth.bass.triggerAttackRelease(freq(n.midi), d * 0.95, t, n.vel);
    else if (role === 'melody') synth.melody.triggerAttackRelease(freq(n.midi), d * 0.95, t, n.vel);
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
    play(role, n, whenMs, durMs, voiceId) {
      const t = Math.max(toAudioTime(whenMs), raw.currentTime);
      const d = durMs / 1000;
      const s = samplers.get(voiceId);
      if (!s) {
        if (voiceId && !voiceById[voiceId]?.synth) ensure(voiceId); // fall back to the synth until it's loaded
        return playSynth(role, n, t, d);
      }
      try {
        if (role === 'drums') {
          const drum = n.drum === 'hat' ? 'hihat' : n.drum;
          const note = DRUM_NOTE[drum];
          if (!note) return playSynth(role, n, t, d); // crash/ride: no sample in these kits
          s.triggerAttackRelease(note, DRUM_LEN[n.drum] ?? 0.4, t, drum === 'ohat' ? n.vel * 0.8 : n.vel);
        } else if (role === 'chords') s.triggerAttackRelease(n.midis.map(noteName), d * 0.98, t, n.vel);
        else s.triggerAttackRelease(noteName(n.midi), d * 0.98, t, n.vel);
      } catch (err) {
        playSynth(role, n, t, d);
      }
    },
  };
}
