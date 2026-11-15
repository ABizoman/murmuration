// The mix, as data (Phase 2 of docs/MUSIC_QUALITY_PLAN.md). audio.js builds the Tone.js graph
// straight from here, so the whole signal flow can be read -- and tested -- in one place.
//
//   per part:  sampler/synth -> strip (highpass + EQ3 + pan; a widener if a strip asks) -> bus  (+ sends)
//   drums bus  -> Compressor -> master            (kick, snare/toms and hats have their own strips,
//   bass bus   -> duck -> Compressor -> master     so the hats can be filtered and panned and the
//   chords bus -> duck -> master                   snare can have more room than the kick)
//   melody bus -> master
//   master:    EQ3 -> glue Compressor -> Limiter -> Tone.getDestination()
//   sends:     ROOM (short) and HALL (long) reverbs, DELAY -> highpass -> master
//
// Ducking is scheduled by hand at kick time (see audio.js): we know when every kick plays, so the
// pop "pump" needs no sidechain and no analysis.
//
// Weak devices get mixFor(true), the "lite" graph: one reverb instead of two, and no widener.

export const MIX = {
  // hp: highpass in Hz. eq: Tone.EQ3 settings. pan: -1..1. widen: Tone.StereoWidener width.
  // room/hall/delay: send amounts. bus: which bus the strip feeds.
  strips: {
    kick: { bus: 'drums', pan: 0, room: 0.08 }, // the kick is left alone: no filter, dead centre
    body: { bus: 'drums', pan: 0, room: 0.26 }, // snare and toms: more room than the kick
    hats: { bus: 'drums', pan: 0.15, hp: 300, room: 0.12 },
    bass: { bus: 'bass', pan: 0, hp: 35, eq: { mid: -2, lowFrequency: 150, highFrequency: 500 } },
    // No widener: the samples are mono, so StereoWidener added no width and cost level. Width comes
    // from the synth pad's stereo Chorus instead (audio.js).
    chords: { bus: 'chords', pan: 0, hp: 180, hall: 0.22, eq: { mid: -2.5, lowFrequency: 220, highFrequency: 560 } },
    melody: { bus: 'melody', pan: 0, hp: 220, hall: 0.16, delay: 0.18, eq: { high: 1.5, highFrequency: 2500 } },
  },
  buses: {
    drums: { comp: { threshold: -14, ratio: 4, attack: 0.01, release: 0.12, knee: 6 } },
    bass: { duck: -4, comp: { threshold: -18, ratio: 3, attack: 0.012, release: 0.18, knee: 6 } },
    chords: { duck: -2 },
    melody: {},
  },
  master: {
    eq: { low: 1, high: 1.5, lowFrequency: 100, highFrequency: 10000 },
    glue: { threshold: -18, ratio: 2, attack: 0.03, release: 0.2, knee: 10 },
    limiter: -1,
  },
  fx: {
    room: { decay: 0.9, preDelay: 0.01 },
    hall: { decay: 2.2, preDelay: 0.025 },
    delay: { time: '8n.', feedback: 0.22, hp: 300 },
  },
  duckMs: 120, // how long the bass and chords take to come back up after a kick
};

// Which strip each drum goes to. Anything missing here would fall back to the synth, so the tests
// check this against every drum the loop library can produce.
export const DRUM_STRIP = {
  kick: 'kick',
  snare: 'body', clap: 'body', rim: 'body', tom1: 'body', tom2: 'body', tom3: 'body',
  hat: 'hats', hihat: 'hats', ohat: 'hats', ride: 'hats', crash: 'hats',
};

export const dbToGain = (db) => 10 ** (db / 20);

// A phone with four cores or fewer gets the lite graph. An unknown core count is treated as fine:
// better to sound good and let the dropped-frame watchdog in main.js downgrade if it has to.
export const isWeakDevice = (nav = {}) => {
  const cores = Number(nav.hardwareConcurrency);
  return Number.isFinite(cores) && cores > 0 && cores <= 4;
};

// The graph to build. In lite mode there is no HALL and no widener (ROOM and DELAY stay: one
// convolution reverb, which is what a phone can afford).
export function mixFor(lite = false) {
  const strips = {};
  for (const [name, spec] of Object.entries(MIX.strips)) {
    const strip = { ...spec };
    if (lite) {
      delete strip.hall;
      delete strip.widen;
    }
    strips[name] = strip;
  }
  return { ...MIX, strips, fx: { ...MIX.fx, hall: lite ? null : MIX.fx.hall }, lite };
}

// Ground rule 4: at most two convolution reverbs in the whole graph.
export const reverbsIn = (mix) => ['room', 'hall'].filter((k) => mix.fx[k]).length;
