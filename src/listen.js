// Listening tools (Phase 0 of docs/MUSIC_QUALITY_PLAN.md): we can't improve what we can't compare.
//
// Two jobs, both pure so they can be tested without an audio context:
//   * master meters: audio.js samples a waveform analyser and a Tone.Meter every few ms and feeds
//     the dB numbers in here; this file keeps the peak, an approximate loudness and a clip count.
//   * clip names: "murmuration-<seed>-<HHMM>.webm" for the Record button.

export const CLIP_DB = -0.3; // a peak at or above this counts as clipping
export const LOUD_TAU_MS = 2000; // time constant of the loudness average

const dbToPower = (db) => (Number.isFinite(db) && db > -200 ? 10 ** (db / 10) : 0);
const powerToDb = (p) => (p > 0 ? 10 * Math.log10(p) : -Infinity);
// Averaging has to happen in the power domain, not in dB.
const mixDb = (a, b, k) => powerToDb(dbToPower(a) * (1 - k) + dbToPower(b) * k);

export const newMeters = () => ({ at: null, peakDb: -Infinity, loudDb: -Infinity, clips: 0, over: false, samples: 0 });

// One reading. `over` makes the clip counter edge-triggered, so a long overload counts once.
export function addMeterSample(m, { peakDb, rmsDb }, nowMs) {
  const peak = Number.isFinite(peakDb) ? peakDb : -Infinity;
  const rms = Number.isFinite(rmsDb) ? rmsDb : -Infinity;
  const over = peak >= CLIP_DB;
  const first = m.at == null;
  const k = first ? 1 : 1 - Math.exp(-Math.max(0, nowMs - m.at) / LOUD_TAU_MS);
  return {
    at: nowMs,
    peakDb: Math.max(m.peakDb, peak),
    loudDb: mixDb(m.loudDb, rms, k),
    clips: m.clips + (over && !m.over ? 1 : 0),
    over,
    samples: m.samples + 1,
  };
}

export function describeMeters(m) {
  const n = (db) => (Number.isFinite(db) ? `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB` : '–');
  if (!m || !m.samples) return 'master: no audio yet';
  return `master peak ${n(m.peakDb)} · loudness ~${n(m.loudDb)} · clips ${m.clips}`;
}

// MediaRecorder gives us "audio/webm;codecs=opus" (Chrome, Android) or "audio/mp4" (Safari, iOS).
export function clipExt(mimeType = '') {
  const t = (/^(?:audio|video)\/([a-z0-9-]+)/i.exec(String(mimeType))?.[1] || 'webm').toLowerCase();
  return { mpeg: 'mp3', 'x-m4a': 'm4a', 'x-matroska': 'mkv' }[t] ?? t;
}

export function clipName(seed, date = new Date(), mimeType = 'audio/webm') {
  const slug = String(seed ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'improvised';
  const two = (x) => String(x).padStart(2, '0');
  return `murmuration-${slug}-${two(date.getHours())}${two(date.getMinutes())}.${clipExt(mimeType)}`;
}
