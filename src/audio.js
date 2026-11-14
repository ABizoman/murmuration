// Tone.js instruments. Converts clock time (epoch ms) to the audio clock using
// getOutputTimestamp(), which pairs "what is coming out of the speaker now" with performance.now().
// That mapping is what lets two devices with synced clocks sound together later.

const Tone = window.Tone;

export async function createAudio() {
  await Tone.start(); // must run inside a user gesture
  const raw = Tone.getContext().rawContext;

  const out = new Tone.Limiter(-1).toDestination();
  const rev = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(out);
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

  const chords = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.5, release: 0.8 },
  }).connect(rev);
  chords.volume.value = -15;

  const delay = new Tone.FeedbackDelay('8n.', 0.25).connect(rev);
  const melody = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3 },
  }).connect(delay);
  melody.volume.value = -17;

  function toAudioTime(epochMs) {
    let { contextTime, performanceTime } = raw.getOutputTimestamp ? raw.getOutputTimestamp() : {};
    if (!contextTime || !performanceTime) {
      contextTime = raw.currentTime;
      performanceTime = performance.now();
    }
    return contextTime + (epochMs - performance.timeOrigin - performanceTime) / 1000;
  }

  const freq = (m) => Tone.Frequency(m, 'midi').toFrequency();

  return {
    play(role, n, whenMs, durMs) {
      const t = Math.max(toAudioTime(whenMs), raw.currentTime);
      const d = durMs / 1000;
      if (role === 'drums') {
        const s = drums[n.drum];
        if (!s) return;
        if (n.drum === 'kick') s.triggerAttackRelease('C1', d, t, n.vel);
        else s.triggerAttackRelease(d, t, n.vel);
      } else if (role === 'chords') chords.triggerAttackRelease(n.midis.map(freq), d * 0.95, t, n.vel);
      else if (role === 'bass') bass.triggerAttackRelease(freq(n.midi), d * 0.95, t, n.vel);
      else if (role === 'melody') melody.triggerAttackRelease(freq(n.midi), d * 0.95, t, n.vel);
    },
  };
}
