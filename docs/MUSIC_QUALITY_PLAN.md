# Murmuration: music quality plan (v2)

Goal: make Murmuration sound like an **upbeat pop band**, both when the agents improvise and in the
demo (which will most likely run in **song mode**). Speakers are available for the demo.

The plan has two kinds of work:
- **Production fundamentals** every good-sounding system needs: feel, mix, sounds, song form.
- **Two system-level upgrades** that fix the root weakness: today each agent picks options from
  *summaries* of what the others played last phrase, then plays a random loop without ever checking
  its actual notes against the band. Phase 3 makes agents **evaluate real candidate parts against
  the band before playing**; Phase 6 **staggers decisions** so each part hears the others' *next*
  phrase, not their last one.

This file is written for a Claude Code session in this repo. **Work through the phases in order.**
After each phase: run `npm test`, add tests for every new pure function, and record a 60 s
before/after clip with the recorder from Phase 0 so the team can listen. Stop after each phase and
report what changed.

---

## Ground rules (read first)

1. **Nothing that works today may break:** swarm, clock sync, gossip, takeover, doubling, Jev,
   director, song mode, `classic.html`, and `index.html` (the iPod UI in `src/ipod/`). Don't rename
   element ids that `src/main.js` uses.
2. **Shared timing stays shared.** Parts are gossiped as note lists and replayed by other devices
   (takeover, doubling). Anything that changes *when* or *how loud* a note plays must be either
   baked into the note data at compose time (deterministic) or computed identically on every
   device from shared data (the structure). **Never add per-device randomness at playback**, or
   two devices playing the same part will flam.
3. **New note fields must survive gossip.** `validNotes()` in `src/main.js` filters remote notes;
   extend it so new fields (`nudge`, `offsets`) are kept and bounded.
4. **Phones:** no heavy DSP per note, at most two convolution reverbs in the whole graph, no large
   new sample downloads without asking. Composition work (Phase 3) must stay under ~10 ms per
   agent per phrase on a phone.
5. **Everything must still work with no network** (rules only, no Jev, no director).
6. Keep the existing file style: small pure modules with a header comment explaining the idea,
   `node:test` tests in `test/`.

---

## Phase 0: listening tools (do this first)

We can't improve what we can't compare, and nobody on the team is sure yet which part sounds worst.

1. **Record button.** Add `recordClip(seconds)` to `src/audio.js` using `Tone.Recorder` on the
   master output; returns a Blob. In the Menu sheet (`index.html`) and in `classic.html`, add
   "Record 60 s", which downloads `murmuration-<seed>-<HHMM>.webm`.
2. **Reproducible runs.** Add a URL parameter `?rng=<text>`. When it's set, every agent gets
   `seededRandom(rng, role)` (from `src/seed.js`) instead of `Math.random`, and so does anything
   else that samples (loop variants, Jev stand-in excluded). Same seed + same rng on one device gives
   the same music, so before/after comparisons are fair.
3. **Meters (dev only).** In "Under the hood": master peak, an approximate loudness reading from a
   `Tone.Meter`, and a clip counter (peaks above -0.3 dBFS).
4. **README:** add "How to A/B a change": open one tab with `?rng=test1`, press Start, record 60 s,
   change the code, repeat with the same URL.

Acceptance: two recordings with the same seed and rng sound identical. The button works on a phone.

---

## Phase 1: feel (swing, timing, dynamics)

Today every note is exactly on the 16th grid with flat velocities, and even the real-drummer Groove
MIDI loops were quantised (see `CREDITS.md`). This is the main reason the music sounds robotic.

### 1a. Swing (shared, from the structure)
- Add `swing` (0 to 0.3, as a fraction of a 16th) to the structure. Improvising: from the seed,
  **0 to 0.06** for upbeat pop. Songs may set `swing` (default 0).
- In `Engine.tick()`, schedule each note at
  `t0 + (n.step + swingOffset(n.step) + (n.nudge || 0)) * sMs`
  with `swingOffset(step) = step % 2 === 1 ? structure.swing : 0`. Every device computes the same value.

### 1b. Humanising (deterministic, baked into notes)
New module `src/feel.js`:
`humanise(notes, { role, phrase, seed, level, voice })` returns new notes. Every random draw comes
from a hash of `(seed, phrase, role, noteIndex)`, so any device rendering the same part gets
identical output.
- **Timing (`nudge`, in steps, clamped to ±0.25):**
  - drums: kick ±0.01; **snare +0.02 to +0.05** (a laid-back backbeat); hats ±0.03 with alternating push/pull
  - bass: +0.00 to +0.02 (sits just behind the kick)
  - chords: **strum.** For guitar and piano voices, spread the chord's notes low to high by
    8–25 ms total (store as `offsets: [..]` in steps, one per note in `midis`). Pads and strings: none.
  - melody: ±0.03, with a slight late bias on notes longer than 4 steps
- **Velocity:**
  - drums: downbeats strongest; 16th hats alternate 0.9/0.55; ghost notes stay quiet; ±0.06 random;
    fills crescendo to the next downbeat
  - bass and chords: beat 1 of each bar +0.08, others ±0.05
  - melody: louder towards the middle of each 2-bar idea, ±0.05
  - clamp everything to 0.25–1
- **Lengths:** bass notes end 1/32 before the next bass note; stab chords `dur × 0.6`; pads full
  length; melody stays legato when notes touch.
- `audio.js`: when a chord note has `offsets`, trigger each pitch separately at its own time. Use
  gain `vel ** 1.6` (a perceptual curve) instead of linear `vel`.
- Call `humanise` at the **end** of `Agent.compose()` (after Phase 3 selection, so the scoring sees
  clean notes).

Tests: deterministic; offsets bounded; chord `offsets` length matches `midis`.

Acceptance: the A/B clearly grooves more; two devices doubling the same part don't flam.

---

## Phase 2: mix and sound (`src/audio.js`)

Today the whole mix is one reverb (decay 2.4, wet 0.22) and a limiter. There's no EQ, compression or panning.

### Signal graph
```
per part:  sampler/synth → channel strip (EQ3 + highpass + pan) → part bus
drums bus  → Compressor (ratio 4, attack 10 ms, release 120 ms, ~3–4 dB reduction) → master
bass bus   → duck gain (below) → Compressor (ratio 3) → master
chords bus → master, send → HALL
melody bus → master, send → HALL, send → DELAY
drums bus  → send → ROOM (snare more than kick)
master: EQ3 (+1 dB low shelf ~100 Hz, +1.5 dB high shelf ~10 kHz)
      → Compressor "glue" (ratio 2, threshold ~-18 dB, attack 30 ms, release 200 ms)
      → Limiter (-1 dB) → destination
ROOM  = Tone.Reverb decay 0.9, preDelay 0.01
HALL  = Tone.Reverb decay 2.2, preDelay 0.025
DELAY = Tone.PingPongDelay('8n.', feedback 0.22) → highpass 300 Hz → master
```
Keep the existing `Tone.getDestination()` as the final node (the UI taps it for the visuals).

### EQ (removes mud)
- bass: highpass 35 Hz, -2 dB at ~250 Hz
- chords: **highpass 160–200 Hz**, -2 to -3 dB at ~350 Hz
- melody: highpass 220 Hz, +1.5 dB presence at ~3 kHz
- drums: kick untouched; hats highpass 300 Hz

### Ducking (the pop "pump")
We know exactly when every kick plays, so no audio sidechain is needed. When `play()` schedules a
kick, also schedule on the bass bus gain: -4 dB at the kick time, back to 0 over 120 ms. Chords and
pads: -2 dB the same way. This only works when the kick and the ducked part are on the same device,
which is fine.

### Panning (matters when one device or speaker plays several parts)
hats +0.15, open hat +0.2, chords through a light `Tone.StereoWidener` (0.4), melody, bass and kick centred.

### Levels and performance
- Re-measure `ROLE_GAIN` with the Phase 0 meters after the new graph (solo each part).
- Weak devices (`navigator.hardwareConcurrency <= 4`, or dropped frames): a "lite" graph with no
  HALL (ROOM only) and no widener.

Acceptance: clearer and fuller A/B, no new clipping, a phone keeps time with the lite graph.

---

## Phase 3: listen before you play (candidate scoring). The core upgrade

Today `Agent.compose()` samples one option per question (`select.js`), fetches one loop, renders
it and plays it. The rules only see summaries (level, mean pitch, density). Nothing checks the
resulting notes against the chords or the other parts.

**New behaviour:** each agent renders several candidate parts and picks the one that fits the band
best, weighted by how likely the rules (and Jev) thought it was.

### 3a. Generating candidates (`src/agent.js`)
1. Compute `scores = ruleScores(ctx, library)` and the blended distributions as today
   (`decide()` / `blend()` in `select.js`, with Jev advice and pins).
2. **Voice** is decided once, as today (it only changes at section starts), so it's not part of the
   candidate search.
3. Draw **K = 6** candidate decisions by sampling level, style, register and interaction from their
   distributions (pins still force their value). Always include:
   - the **continuity** candidate: last phrase's style, level and register, with `prefer` set to
     the last loop id
   - the **top** candidate: the most likely option for each question
   Remove duplicates; if fewer than 3 remain, sample more (max 10 tries).
4. For each candidate: `library.find(...)` (with its own random draw, so pack variants differ),
   `renderPhrase(...)`, then `applyInteraction(...)`. Level 0 = an empty part (still a valid candidate).
5. Score each candidate (3b), choose (3c), then `humanise` (Phase 1) only the winner.

Budget: K renders + scores must stay under ~10 ms per agent on a phone. Measure in a test with a
timer; reduce K to 4 on weak devices.

### 3b. Scoring (`src/decide/fit.js`, pure, fully tested)
`fitScore(notes, { role, ctx, structure, phrase })` returns `{ total, terms }`, where each term is
0..1 (1 = good) and `total` is the weighted mean. It uses:
- **the chords:** `chordAt(structure, phrase, bar)` from `render.js`
- **the other parts:** `ctx.peers[r].notes`. In Phase 6 these will often be the others' parts *for
  this same phrase*; until then they're usually last phrase's. Weight each peer term by
  `fresh ? 1 : 0.5`, where `fresh` = the peer's part is for the phrase being decided
  (`ctx.peers[r].phrase === ctx.phrase`).
- **own history:** `ctx.history`

Metric strength of a step within a bar: step 0 → 1.0, step 8 → 0.8, steps 4/12 → 0.6, other
even steps → 0.35, odd steps → 0.2.

| term | roles | how | weight |
|---|---|---|---|
| `harmony` | bass, melody | Share of note weight on chord tones, where note weight = duration × metric strength of its onset. Non-chord tones on weak steps that move by step (≤ 2 semitones) to a chord tone count as chord tones (passing/neighbour notes). | 3 |
| `bassRoot` | bass | Share of bars whose first note on step 0–2 is the chord root (or the fifth, at half credit). | 2 |
| `clash` | bass, chords, melody | For every pair of this part's sounding notes and another pitched part's sounding notes that overlap by ≥ 1 step: a semitone or major 7th (interval class 1) is a clash, weighted by overlap length and metric strength; a tritone against the bass counts half. Term = 1 - min(1, clashWeight / 4). | 3 |
| `register` | bass, chords, melody | Compare this part's pitch range (10th–90th percentile) with the others'. Penalise overlap beyond 3 semitones in proportion. Hard rules: the bass's highest note ≤ the chords' lowest + 2; the melody's mean pitch ≥ the chords' mean + 3. | 2 |
| `rhythm` | all | Onset overlap ratio with each other part (Jaccard on 64-step onset arrays). Targets: bass↔kick **0.5–0.9** (lock in); melody↔chords **0.1–0.4**; melody↔bass 0.1–0.5; others 0.1–0.6. With interaction `answer:X` the target vs X is 0–0.25; with `echo:X` it's 0.6–1. Score = 1 inside the target, falling off linearly outside it. | 1.5 |
| `shape` | bass, melody | Leaps > 7 semitones (except octaves) cost; more than 4 repeats of one pitch in a row cost; total range > 19 semitones (melody) costs; reward a stepwise-motion share of 0.4–0.8. | 1.5 |
| `continuity` | all | Similarity to own last phrase (0.5 × onset Jaccard + 0.5 × contour similarity). Target 0.4–0.75 normally; ≥ 0.9 when the form says "hook" (Phase 5). Score = 1 inside the target. | 1 |
| `drums` | drums | If the bass is fresh: share of kicks that land on a bass onset (± 1 step), target ≥ 0.5. At level ≥ 2: snare (or clap) on steps 4/12 of most bars. A fill (dense snare/tom notes) only in the last bar of a section. | 2 |

### 3c. Choosing
For each candidate `c`: `logit(c) = log(prior(c)) + λ · fit(c).total`, where `prior(c)` is the
product of the blended probabilities of its options, and **λ = 6**. Sample with softmax at
**temperature 0.35**, which keeps variety but strongly prefers parts that fit. Pins still apply.
The continuity candidate gets +0.3 to its logit while the style has been held for fewer than 3
phrases (keeps grooves stable).

Store `fit` (total and terms), the number of candidates, and the winner's rank on the part's meta.
Extend `why` with a short phrase, e.g. `"best of 6: on the chords 94%, no clashes"`; the UIs
already show `why`. This is also a nice story for the judges.

### 3d. Jev with candidates (optional, after 3a–3c work)
Jev is a decision model, and the best question it can answer is "which of these parts fits best?".
In `src/decide/jev.js`, add a second, optional question per role at compose time:
`"<role>|candidate"`, with one criterion per candidate, described with `describePart()` (rhythm string,
register, style). Only ask it if the compose deadline leaves ≥ 600 ms (Phase 6 makes that
common). If the answer arrives in time, multiply each candidate's probability by Jev's
probability (floored at 0.03, like `blend()`); otherwise ignore it. Keep the existing per-option
questions as they are.

### Tests
- A melody on chord tones scores higher on `harmony` than the same rhythm on random chromatic notes.
- A held semitone against the chords is detected as a clash; the same note a whole step away isn't.
- A bass above the chords fails `register`.
- With a fixed rng, `compose()` is deterministic and returns one of the generated candidates.
- Performance: K=6 for all four roles under 40 ms total in Node.

Acceptance: A/B on 5 seeds. Fewer sour notes and register collisions, and parts sound like they
respond to each other. Song mode still works (its loops are fixed, but level, register and
interaction still benefit).

---

## Phase 4: sounds and a (soft) pop style family

### 4a. New synth voices (free, small, velocity-responsive, very "pop")
Add to `src/voices.js` and `src/audio.js` as synth voices (no downloads), with measured `gain`:
- `synth-bass`: replace the current saw MonoSynth with a layer of a sine sub (one octave down,
  -6 dB) + filtered saw (cutoff ~900 Hz, fast filter envelope), mono, glide 0.02.
- `synth-pad`: PolySynth `fatsawtooth` (3 voices, spread 25), attack 0.08, release 1.2 → lowpass
  ~3 kHz → Chorus (wet 0.4).
- `synth-pluck`: PolySynth with a very short decay (0.25 s), sustain 0, lowpass ~4 kHz, for pop
  melodies and arps.
- `synth-lead`: mono square/saw lead, portamento 0.03, delayed vibrato (after 300 ms), through the
  DELAY send.
- Add a **crash** to each kit: a sample if one is available in the Tone.js audio repo kits,
  otherwise a synth crash (white noise → highpass 5 kHz, 1.2 s decay).

### 4b. Style family (soft preferences, not hard filters)
New `src/styles.js` with `STYLE_FAMILIES['pop-upbeat']`:
```js
{
  label: 'Upbeat pop',
  bpm: [104, 124], majorChance: 0.75, swing: [0, 0.06],
  progressions: { major: [['I','V','vi','IV'], ['vi','IV','I','V'], ['I','vi','IV','V'], ['IV','I','V','vi']],
                  minor: [['i','VI','III','VII'], ['VI','VII','i','i']] },
  styles: {
    drums:  { 'groove-pop': 3, 'groove-dance': 2, 'groove-rock': 1.5, 'groove-funk': 1, four: 1.5, boombap: 0.5 },
    bass:   { pop909: 2, pulse: 2, roots: 1 },
    chords: { pop909: 2, 'drolez-pop': 1.5, stabs: 1.5, pad: 1 },
    melody: { pop909: 2, motif: 1, call: 1 },
  },
  voices: {
    drums:  { 'kit-breakbeat': 2, 'kit-acoustic': 1.5, 'kit-linn': 1.5, 'kit-8': 1 },
    bass:   { 'bass-electric': 3, 'synth-bass': 2, 'bass-slap': 0.4 },
    chords: { 'keys-piano': 2, 'keys-epiano': 2, 'guitar-steel': 1.5, 'synth-pad': 2, strings: 1 },
    melody: { 'synth-lead': 2, 'synth-pluck': 2, 'guitar-clean': 1.5, 'keys-epiano': 1, 'voice-oohs': 0.5 },
  },
  unlisted: 0.05,   // weight multiplier for anything not listed (soft, not banned)
}
```
- `structureFromSeed()` uses the family for bpm, mode, progressions and swing, and stores
  `structure.family = 'pop-upbeat'` (every device agrees). Later: a Menu choice of family.
- `rules.js`: multiply style and voice weights by the family's weights (`unlisted` for the rest).
  Phase 3 then catches whatever clashes still get through.
- GM voices that sound cheap with single-layer samples (tuba, trumpet, trombone, French horn,
  overdriven guitar, fretless) get `unlisted` weight, but songs can still ask for them explicitly.
- **Stability:** drums and bass keep their groove for a whole section (4 phrases) unless the director
  changes energy by > 0.3. Instruments change at most every 2 sections, and at most one part changes
  instrument at a section boundary (the role with the longest-held voice goes first).
- Add the melody `voice` to the `voices` question's options only from the family list.

Tests: no role ever ends up with zero options; the family weights are applied; voice changes are
limited as described.

---

## Phase 5: song form and hooks (improvisation becomes a song)

### 5a. Form
New `src/form.js`: `formFromSeed(seed, family)` returns sections
`[{ name, phrases, energy, plan: { role: 'out'|'light'|'normal'|'full' }, hook: bool }]`, shared by
every device (pure, from the seed). Default for upbeat pop:

| section | phrases | energy | plan | hook |
|---|---|---|---|---|
| intro | 1 | 0.3 | chords normal, drums light (hats from bar 3), bass out, melody out | no |
| verse | 2 | 0.45 | drums normal, bass normal, chords normal, melody normal | no |
| pre | 1 | 0.65 | drums build (snare 8ths in the last bar), bass pulse, chords normal, melody light | no |
| chorus | 2 | 0.9 | everyone full | **yes** |
| verse 2 | 2 | 0.5 | as verse | no |
| chorus | 2 | 0.95 | everyone full | **yes** |
| breakdown | 1 | 0.35 | drums out, bass out, chords pad, melody light | no |
| final chorus | 2 | 1.0 | everyone full, melody register +1 | **yes** |
| outro | 1 | 0.3 | chords and drums light, then loop to verse 2 (or end, see 5d) | no |

- `sectionAt(phrase, form)` maps any phrase to a section (looping after the outro back to verse 2).
- The form becomes the **base directive**: `energy` from the section, `drop` from 'out' roles, and
  levels clamped by the plan (`light` = level ≤ 1, `normal` = 1–2, `full` = 2–3). The director still
  shifts energy, feature and pairs within the section but cannot override `out` or `full`.

### 5b. Hooks
- The first time a `hook` section starts, the melody agent picks its loop as usual (Phase 3) and
  announces it by gossip: `{ type: 'hook', role, phrase, loopId, register }`. Every device stores
  the first hook it hears (ties: lowest phrase, then lowest device id). Fallback when no message
  arrives: a deterministic pick from the seed.
- In later hook sections, the melody **must** use the hook loop and register (it becomes a pinned
  candidate; Phase 3 scoring is skipped for melody there, except `continuity`). Bass and chords do
  the same with their own chorus loops. This is what makes the chorus recognisable.
- Verses: the melody prefers loops that share the hook's rhythm (a `continuity` target vs the hook of
  0.4–0.7), so verse and chorus feel related.

### 5c. Transitions (on the device that plays drums)
- A **drum fill** in the last bar before every chorus and every section change: use the busy loop's
  fill bar if it has one, otherwise generate one (snare/tom 16ths, rising velocity, last 4–8 steps).
- A **crash** on the first downbeat of each chorus and of the final section.
- A **riser** into choruses: noise through a bandpass sweeping 300 Hz → 6 kHz over the last bar,
  with rising volume.
- A **drop**: before the final chorus, everyone except chords rests for the last bar of the breakdown.

### 5d. Ending
In the Menu: "End after one pass". When ticked, after the outro every device ends on the tonic chord
with a crash in the first bar of the next phrase and then stops cleanly (the end phrase is known
from the form). Otherwise loop to verse 2.

Tests: `sectionAt` is correct across loops; hooks are reused; transitions appear only at boundaries.

Acceptance: a 3-minute improvised recording has recognisable sections, a chorus you can hum on its
second appearance, and fills and crashes in the right places.

---

## Phase 6: staggered decisions (agents hear the next phrase)

Today every agent composes 1 bar before the phrase, at the same time on every device, so it reacts to
the others' *previous* phrase. `buildContext()` already prefers a peer's part for the phrase being
decided when one has been announced (`lookup(phrase, r)` first). Only the timing needs to change.

- In `src/engine.js`, make the horizons per role:
  `COMPOSE_AHEAD = { drums: 2, chords: 2, bass: 1.5, melody: 1 }` bars, and
  `PLAN_AHEAD = COMPOSE_AHEAD + 1` (when Jev is asked).
  Configurable via the constructor; defaults as above.
- `tick()`: for each role this device sounds, call per-role `ensurePart(next, role)` when the
  phrase is within that role's compose horizon (refactor `ensureParts` into a per-role function
  plus a loop; joining mid-song still composes all roles at once, as now).
- `onPlan` is called per horizon group (drums+chords together, then bass, then melody), each with its
  own deadline.
- With Phase 3, the bass now scores against the drums' and chords' real next phrase (`fresh`), and
  the melody against all three. Kick/bass locking and melody/chord fit improve a lot.
- Timing safety: at 124 BPM, half a bar ≈ 0.97 s, far above LAN gossip latency. If a peer's part
  hasn't arrived by compose time, the agent falls back to last phrase's (fresh = false), as today.
- The classic UI caption "decided 1 bar before it starts" should read the role's own horizon.

Tests (with a fake clock and two engines connected in memory): composition happens in the order
drums/chords → bass → melody; the melody's context holds the bass part for the same phrase;
takeover and doubling still work.

Acceptance: A/B with Phase 3 on. The kick and bass lock together more often, and the melody avoids
the chords' notes and rhythm more.

---

## Phase 7: demo song and demo preset (keep it small)

Insurance for the demo. Phases 1–6 make song mode sound better automatically; this adds a pop song
built for the demo story.

### 7a. Song format: sections
Extend `src/songs/format.js` and `docs/ADDING_SONGS.md` so a song can define sections with their own
progressions and parts, plus a form:
```js
sections: {
  verse:  { progression: [...], parts: { melody: {...}, bass: {...}, chords: {...}, drums: {...} } },
  chorus: { progression: [...], parts: { ... } },
},
form: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
swing: 0.04,
end: true,      // stop at the end of the form instead of looping
```
Songs without `sections` keep working. Section boundaries use the Phase 5 transitions.

### 7b. Demo songs
1. **An original upbeat pop song** (~116 BPM, major, chorus I–V–vi–IV, verse vi–IV–I–V, a 2-bar
   singable hook with a variation, a bass line that locks with the kick, piano or e-piano chords with
   anticipated (pushed) chords, a pop groove with four-on-the-floor in the chorus, about 2:30 with an
   ending). The team will supply the notes or ask for them to be written.
2. **"Ode to Joy (pop version)"**: the public-domain melody at 120 BPM with a modern arrangement
   (synth bass, pluck melody, claps on 2 and 4).

### 7c. Demo preset
`?demo=<songId>` (and a Menu item "Demo"): song mode with that song, fixed rng, director off (the
song's form leads), instruments fixed per part, `end: true`, and a build order that matches the demo
script (drums on the speaker device first, then bass, then chords and melody on phones). Takeover,
rejoining and killing the server must still work during the demo.

---

## Deferred (low return for now)

- A velocity-controlled filter on sampled voices
- A "this device has a speaker" toggle (for the demo, give speaker devices drums and bass by hand)
- Multi-velocity sampled piano and e-piano (large downloads)
- A key change in the final chorus
- Motif development (sequence, inversion) for melodies beyond loop selection

---

## Order and effort

| order | phase | type | effort |
|---|---|---|---|
| 1 | 0 Listening tools | needed | 1–2 h |
| 2 | 1 Feel | production | 2–3 h |
| 3 | 2 Mix | production | 2–3 h |
| 4 | **3 Candidate scoring** | **system** | 4–6 h |
| 5 | 4 Sounds + soft style family | production / musical | 3–4 h |
| 6 | 5 Form and hooks | musical | 4–6 h |
| 7 | **6 Staggered decisions** | **system** | 2–3 h |
| 8 | 7 Demo song + preset | demo | 2–4 h |

If time runs short, stop after any phase: each one leaves the system working and better than before.
