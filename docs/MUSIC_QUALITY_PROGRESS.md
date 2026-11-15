# Murmuration music quality plan: progress report (Phases 0–3)

Implementation report for [`MUSIC_QUALITY_PLAN.md`](MUSIC_QUALITY_PLAN.md), written for whoever
continues the plan. Phases 0, 1, 2 and 3 (3a–3c) are done and on `main`'s history as one branch.
Phase 3d is deliberately deferred; Phases 4–7 are untouched.

`npm test`: **98 tests, all passing** (52 before this work). Runtime ~1.4 s, Node only, no browser.

| phase | state | notes |
|---|---|---|
| 0 Listening tools | **done** | `?rng=`, Record 60 s, meters, README A/B recipe |
| 1 Feel | **done** | swing in the structure, `src/feel.js` humanising baked into the notes |
| 2 Mix | **done except levels** | full graph built from `src/mix.js`; `ROLE_GAIN` still needs ears |
| 3 Candidate scoring | **3a–3c done, 3d deferred** | measured: fit 0.79 → 0.88, melody clash 0.47 → 0.90 |
| 4–7 | not started | hooks they will need are listed at the end |

Everything below is either in the repo or measured from it. Two things could **not** be verified
without a browser and speakers, and are called out explicitly: how it sounds, and `ROLE_GAIN`.

---

## 1. New and changed files

**New modules** (all pure except `audio.js`'s graph, all with header comments pointing at the plan):

| file | lines | what |
|---|---|---|
| `src/listen.js` | 51 | master meter maths (peak hold, loudness average, clip counting), clip file names |
| `src/feel.js` | 148 | `swingOffset`, `humanise`, `sanitiseNotes` + the note-field bounds |
| `src/mix.js` | 80 | the whole signal graph as data, `mixFor(lite)`, `isWeakDevice`, `DRUM_STRIP` |
| `src/decide/fit.js` | 316 | `fitScore` and its eight terms, `describeFit` |

**New tests** (46 of the 98):

| file | tests | what it pins down |
|---|---|---|
| `test/listen.test.mjs` | 5 | meters, clip names, `randomFor`, two engines with one rng playing identical notes |
| `test/feel.test.mjs` | 9 | humanise determinism/bounds per role, strum geometry, lengths, **no flam when doubling** |
| `test/mix.test.mjs` | 8 | routing, EQ/pan/send values, ducking numbers, ground rule 4 (≤2 reverbs), lite graph |
| `test/audio-graph.test.mjs` | 9 | the real `audio.js` graph driven through a fake Tone.js |
| `test/fake-tone.mjs` | – | the fake (records connections and parameter automation); not a test file |
| `test/fit.test.mjs` | 15 | every fit term, candidate generation, softmax choice, the A/B acceptance test, the budget |

**Changed:** `src/audio.js` (+226/−55, rebuilt graph), `src/main.js` (+99/−14), `src/agent.js`
(+81/−17, candidate search), `src/decide/select.js` (+75), `src/engine.js` (+8/−3, swing/nudge),
`src/seed.js` (+12/−2, swing), `src/clock.js` (+3, `MAX_SWING`), `src/decide/rules.js` (+2/−1,
export `runLength`), `README.md` (+58), `docs/ADDING_SONGS.md` (+9, song `swing`),
`index.html`/`classic.html` (Record button + meters), `test/phase1.test.mjs` (+5/−1, `swing` in the
structure assertion).

No element ids were renamed. `classic.html`, `index.html` and the iPod layer were not restructured.

---

## 2. Phase 0 — listening tools

**Built:** `recordClip(seconds)` on `Tone.Recorder` tapping `Tone.getDestination()`, returning the
Blob; a "Record 60 s" button in the iPod Menu (Menu → This device) and in `classic.html`'s header,
downloading `murmuration-<seed>-<HHMM>.webm`; `?rng=<text>`; dev meters (master peak, approximate
loudness, clip count above −0.3 dBFS) in "Under the hood" on both pages; the README's
"How to A/B a change".

**Judgement calls:**

- `?rng=` seeds **every agent** via `randomFor(rng, role)` from `src/seed.js`. That also covers pack
  variant draws (`library.find` uses the agent's `random`) and the song-mode build-up (it samples
  rule weights with the same stream), so no separate wiring was needed. The director's proposal
  jitter is seeded too; the Jev stand-in is server-side and stays excluded, as the plan says.
- Agents are **re-seeded on every `playSong()`**, so pressing Start twice in one tab repeats the
  first run instead of drifting. The meters are reset at the same moment.
- The clip extension is derived from the recorder's actual mime type (`clipExt`), because iOS
  Safari records `audio/mp4`, not webm. The file name is still `murmuration-<seed>-<HHMM>`.
- Peak is read from a 2048-sample `Tone.Analyser` waveform polled every 40 ms (≈46 ms of audio per
  window, so no peak slips between windows); loudness is a slow `Tone.Meter` (smoothing 0.9)
  averaged in the **power** domain; clips are **edge-triggered**, so one long overload counts once.
- Two extra switches were added later, for Phase 2's level work: `?solo=<role>` and `?lite=1|0`.

**Not verified:** the button on a phone. `Tone.Recorder.supported` is checked and the mime type is
handled, but nobody has pressed it on iOS.

---

## 3. Phase 1 — feel

**Built:** `structure.swing` (improvising draws 0–0.06 from the seed; songs may set it, default 0),
applied at schedule time in `Engine.tick()` as
`t0 + (step + swingOffset(step, structure.swing) + (nudge||0)) * sMs`; `src/feel.js`'s `humanise()`
called at the end of `Agent.compose()`; per-pitch chord `offsets` triggered separately in
`audio.js`; velocity through `v ** 1.6`; `validNotes()` now delegates to `sanitiseNotes()`.

Every draw comes from `seededRandom(seed, phrase, role, noteIndex)` — one stream per note, so
`humanise` is a pure function of its arguments and two devices rendering the same part agree.

**Judgement calls and deviations:**

- **`humanise` takes `bpm`.** The plan's signature has no tempo, but the strum is specified in
  milliseconds (8–25 ms) and stored in steps, so the conversion needs it. `bpm` is shared, so
  determinism holds.
- **`MAX_SWING` lives in `src/clock.js`**, not `feel.js`: `seed.js` needs it to clamp, and
  `feel.js` imports `seededRandom` from `seed.js`, so defining it in `feel.js` created a circular
  import. Swing is a grid property, so `clock.js` is a reasonable home. `feel.js` re-exports it.
- **Swing is drawn last in `structureFromSeed()`** so every existing seed keeps the exact key, mode,
  tempo and progression it had before this change.
- **Strum is gated on the voice's `family`** (`keys`, `guitar`) rather than a list of ids, so Phase
  4's new voices get the right behaviour for free. Pads, strings, brass, choir and synths do not
  strum. Offsets are ranked by actual pitch, so an unsorted voicing still strums low → high.
- **"Stab chords" are detected by duration** (`dur ≤ 4` → `× 0.6`), because `humanise` is not told
  the style. Longer chords are treated as pads and keep their length.
- **Bass lengths are only shortened**, never lengthened, to end a 32nd before the next bass note —
  lengthening would turn a staccato pulse into a legato line, which is not what the plan means.
- **`sanitiseNotes` lives in `feel.js`** (with `MAX_NUDGE` / `MAX_OFFSET`) so the gossip contract is
  testable in Node; `validNotes()` in `main.js` is now a one-line wrapper. It keeps an explicit
  field list (`step`, `dur`, `vel`, `drum`/`midi`/`midis`, `nudge`, `offsets`), bounds all of them,
  drops `offsets` whose length does not match `midis`, and also bounds `vel`, `midi` and `dur`,
  which the old filter did not.
- Toms get the snare's treatment; `crash`/`ride` fall through with no nudge.

**Measured:** 4014 of 4458 notes carry a `nudge`, 188 chord notes carry `offsets`; nudge range
−0.030…+0.050 steps; compose cost 0.6 ms per part. **The perceptual velocity curve makes the mix
about 1.7 dB quieter** (mean velocity 0.644 → gain 0.528). Levels were left for Phase 2 as the plan
says, but it means a Phase 1 A/B must be level-matched with the meters or the new clip just sounds
smaller. The drums' dynamic range widens most: a pack ghost hat at velocity 0.25 now plays at
gain 0.107.

---

## 4. Phase 2 — mix

**Built:** `src/mix.js` holds the graph as data and `audio.js` builds it: per-part strips
(highpass → EQ3 → pan or widener) → bus (ducking, compressor) → master (EQ3 → glue → Limiter −1) →
`Tone.getDestination()`, plus ROOM / HALL / DELAY sends, kick-time ducking, panning, and the lite
graph. All EQ, pan, send, compressor and duck values are as specified, with the crossovers chosen so
the mid-band cuts land where the plan asks (bass mid band centred at 274 Hz, chords at 351 Hz).

**Judgement calls and deviations:**

- **Each kit now loads three samplers** (kick / snare+toms / hats). A `Tone.Sampler` has one output,
  and the plan wants the hats highpassed and panned and the snare further back in the room than the
  kick, so the kit has to be split. The url maps are derived from `DRUM_STRIP` so routing and
  loading cannot drift; their union is exactly the old single sampler's note map.
  **Consequence:** the open hat shares the hats strip, so it is panned +0.15 with them rather than
  the +0.2 the plan asks for. A fourth sampler per kit would buy 0.05 of pan; it did not seem worth
  the nodes. Flagging it because it is a (tiny) spec deviation.
- **The melody's `FeedbackDelay` was removed from the synth** — the delay is now a send on the
  melody strip, shared by the sampled and synth melody, which is what the plan's graph says.
- **Compressor thresholds** (drums −14, bass −18) are chosen, not measured: the plan gives ratios
  and times but only one threshold. They aim at the plan's "3–4 dB reduction" at current levels.
- **`ROLE_GAIN` has not been re-measured.** This needs ears and the meters. `?solo=<role>` was added
  for exactly this and the recipe is in the README. Until it is done, a Phase 2 A/B partly measures
  level, not clarity.
- **`Tone.StereoWidener(0.4)` on the chords may do nothing useful, or quietly attenuate.** The
  samples are mono, so there is no side signal to widen, and Tone scales mid by the width factor,
  which can cost several dB on mono content. It is implemented as specified rather than silently
  dropped, but **check the chords' level first**; the honest options are `widen: 0.5` or removing it
  until Phase 4's chorus gives the chords real stereo content.
- **"Dropped frames" is implemented as tick lateness.** `main.js` measures its own 25 ms engine tick
  and calls `audio.setLite()` after ~15 gaps over 75 ms, logging why. The engine's punctuality is
  the thing that actually matters here, and it needs no new rAF loop. `setLite()` fades the hall
  sends and wideners out and disposes the hall convolver.

**Three real bugs, all caught by the new graph test:**

1. **Tone's `connect()` returns the source, not the destination.** The first bus chain
   (`tail = tail.connect(duck)`) wired the bus input straight to the master, bypassing the duck
   *and* the compressor on bass and drums. The chains are now wired explicitly.
2. **`ohat.mp3` does not exist** — the open hat is `hihat.mp3` pitched down to A#2, which the old
   code special-cased. The derived url map asked for `ohat.mp3`, so the whole hats sampler would
   have failed to load and every hat on every kit would have fallen back to the synth.
3. `setLite()` nulled `fx.hall` before its 800 ms disposal timer read it, so the silent convolver was
   never disposed on the device we had just tried to relieve.

`test/fake-tone.mjs` + `test/audio-graph.test.mjs` are the reason these were found. The fake records
connections and parameter automation; the test asserts whole routes as strings, e.g.
`MembraneSynth -> Panner(0) -> Gain(1) -> Compressor(r4) -> EQ3 -> Compressor(r2) -> Limiter(-1) -> destination`,
and checks that the bass passes through **two** gains before its compressor. Worth keeping for
Phases 4 and 5, which both add nodes.

---

## 5. Phase 3 — listen before you play (3a–3c)

**Built:**

- `src/decide/fit.js`: `fitScore(notes, { role, ctx, structure, phrase, d })` → `{ total, terms }`
  with all eight terms at the plan's weights, `metric()` exactly as tabulated, peers weighted
  `fresh ? 1 : 0.5`, and `describeFit()` for the `why` line. Also exports `onsets`, `jaccard`,
  `inRange`, `spread`, `WEIGHTS`, `TERMS`.
- `src/decide/select.js`: `candidateDecisions()` (K draws, always including the **top** and
  **continuity** candidates, deduped on `level|style|register|interaction`, pins forced, up to 10
  extra tries), `candidatePrior()`, `pickCandidate()` (`log(prior) + 6 × fit + bonus`, softmax at
  0.35). `LAMBDA`, `TEMPERATURE`, `CONTINUITY_BONUS` exported.
- `src/agent.js`: `compose()` blends → draws K → `renderCandidate()` each → scores → picks →
  humanises **the winner only**. `renderCandidate` touches no agent state, so a losing candidate
  leaves no trace; `prevVoicing` and `lastLoopId` come from the winner. `K = 6`, 4 on weak devices.
  Meta carries `fit`, `candidates`, `rank`, `chance`; `p` is recomputed for the winner.
- `main.js` shows `fit 88% (2 of 6: harmony 100%, clash 94%, …)` in the dev detail line; `why` gains
  `best of 6: on the chords 100%, no clashes` (longest observed `why`: 97 chars, gossip keeps 120).

**Judgement calls and deviations — these three matter:**

1. **The clash term exempts pairs where both notes are in the chord** (triad + seventh). The plan
   says interval class 1 is a clash, full stop. Implemented literally, the chords' clash score got
   *worse* with scoring on (0.78 → 0.34); instrumenting it showed **90% of the chords' clash weight
   came from pairs where both notes were legitimate chord tones** — an F major 7 pad over an F bass
   is interval class 1 and is ordinary pop harmony. Because every chords candidate at one register
   shares the same voicing, no candidate could escape the penalty. With the exemption, chords clash
   goes to 0.94 and real chromatic notes are still caught (tested both ways). A dominant chord's
   tritone is covered by the same exemption.
2. **A resting candidate (level 0) is scored as the median of the other candidates**, not as the
   0.5 that terms-meant-for-notes would produce. With λ = 6 a fixed 0.5 would have suppressed rests
   by roughly e^−4, which would have broken song-mode build-up (parts wait at level 0 with a large
   prior) and the director's drops. As implemented, the prior decides whether to rest, which is
   today's behaviour, and the fit decides between playing candidates.
3. **Every candidate prefers the loop already playing.** The plan says each candidate calls
   `library.find` "with its own random draw, so pack variants differ"; passing `prefer` only to the
   continuity candidate made the drums swap pack variant almost every phrase (35 of 38 — caught by
   the existing "keeps a groove for a while" test). Each candidate now draws independently *with*
   `prefer`, so `library.find`'s existing 75% keep-rate applies per candidate.

Smaller ones: `fitScore` takes the candidate's `d` (the `rhythm` term needs `interaction`, the
`drums` term needs `level`); the `drums` fill rule is enforced against the last bar of the **phrase**
(sections arrive in Phase 5); `fit.js` already honours `ctx.hook`, so Phase 5 only has to set it;
`runLength` is exported from `rules.js` for the continuity bonus.

**Measured (pack library, which is what the app runs; 40 phrases, seed `durhack`):**

| | rules' most likely (K=1) | best of 6, scored |
|---|---|---|
| overall fit | 0.796 | **0.880** |
| melody clash | 0.47 | **0.90** |
| bass clash | 0.63 | **0.96** |
| chords clash | 0.78 | **0.94** |
| melody harmony | 0.80 | 0.88 |
| bass `bassRoot` | 0.94 | 1.00 |
| drums kick↔bass lock | 0.84 | **1.00** |
| bass `shape` | 0.53 | 0.70 |

Pooled over five seeds: fit 0.794 → 0.862, clash 0.795 → 0.933. The trade is a little register
overlap (bass 1.00 → 0.90) to kill clashes, which is correct given clash is weighted 3 and register
2. With the **builtin-only** library the gain is much smaller (fit +0.03, clash already 1.0): the
hand-written loops are consonant by construction, so the scorer earns its keep on pack loops.

**Budget:** 1.36 ms mean, 1.81 ms worst for **all four roles** at K=6 in Node (plan allowed 40 ms);
≈0.45 ms per agent against the 10 ms phone budget. `test/fit.test.mjs` asserts < 40 ms.

**Calibration fact worth knowing:** with λ = 6 and temperature 0.35, a 9:1 prior is overturned when
the fit gap reaches about log(9)/6 ≈ 0.37. Smaller gaps leave the prior in charge.

### 3d (Jev ranking the candidates) — deferred, not dropped

It needs `compose()` to become two steps (generate candidates → ask Jev → wait ≥600 ms → choose),
and `compose()` is called synchronously inside `Engine.ensureParts()`. Doing it now would mean
generating candidates two bars out, on a staler context, and restructuring the engine's horizons —
which is exactly what **Phase 6** does. Recommendation: implement 3d as part of Phase 6, when
`COMPOSE_AHEAD` / `PLAN_AHEAD` are already per role and the deadline arithmetic is in hand. The
pieces it needs are ready: candidates carry `d`, `kind`, `loop` and `fit`, and `describePart()` is
unchanged.

---

## 6. Open items, in the order they matter

1. **Re-measure `ROLE_GAIN`** (Phase 2's own acceptance step). `?rng=test1&solo=drums`, read the
   loudness meter, repeat per part, move the gains so all four land within ~1 dB, then check the
   peak stays under −1 dB and the clip counter stays 0. Until this is done, no A/B from Phase 1
   onwards is level-fair.
2. **Decide the chords widener** (see §4) — it may be costing several dB for no width.
3. **Listen on a phone**: the lite graph is chosen automatically at ≤4 cores (the meters line says
   `· lite mix`), `?lite=0` forces the full graph, and the Record button has never been pressed on
   iOS.
4. **Drum loop churn**: 18 of 38 phrases change loop at K=6, against 9 of 38 before. It buys a
   perfect kick/bass lock (drums term 0.84 → 1.00) and stays inside the existing test's 70% limit,
   but a pop band might want more inertia. The lever is `CONTINUITY_BONUS` or the `continuity`
   weight.
5. **Melody continuity sits at 0.32** (target 0.4–0.75): the melody varies more than it repeats,
   because `harmony` + `clash` (3 + 3) outweigh `continuity` (1). Phase 5's hooks are the proper
   fix, and `fit.js` is already wired for them.
6. **There is no "before" clip for Phase 1** unless someone recorded the Phase 0 baseline. A
   `?feel=off` switch (straight grid, no humanising) would make every later A/B one URL change;
   it was offered and not built, to avoid unasked-for scope.

## 7. What Phases 4–7 should know

- **Phase 4 (voices, style family):** new synth voices need a `family` in `voices.js` — `feel.js`
  strums `keys` and `guitar` only, and `rules.js` avoids two voices of one family. Pitched voices
  route to `strip[role]` automatically, so no `mix.js` change is needed for `synth-bass`,
  `synth-pad`, `synth-pluck` or `synth-lead`; a **crash** already has a route (`DRUM_STRIP.crash →
  hats`) but no sample and no `DRUM_NOTE` entry, so it currently falls back to the synth. The
  `voice` question is already outside the candidate search, as the plan requires. `test/mix.test.mjs`
  asserts that every drum the library can produce has a route — it will fail usefully if a new kit
  piece is added without one.
- **Phase 5 (form and hooks):** `fitScore` already reads `ctx.hook` and switches the continuity
  target to 0.9–1 (tested). The `drums` term already penalises fills outside the last bar.
  `structure.swing` is already shared, so a form that wants more swing per section only has to put
  it in the structure. The director's directive still flows through `rules.js` untouched.
- **Phase 6 (staggered decisions):** the freshness weighting (`fresh ? 1 : 0.5`) is implemented and
  will start paying off the moment horizons differ per role. Note `engine.audio.play()` now takes a
  sixth argument (`stepMs`, needed by the strum), and `tick()` applies swing and `nudge` — any
  change to scheduling must keep that formula identical on every device. Pick up 3d here.
- **Phase 7 (demo song):** song `swing` is already supported, documented in `ADDING_SONGS.md` and
  defaults to 0.

## 8. How to check this work

```
npm test                                   # 98 tests, Node only
node server.js
open http://localhost:8000/?rng=test1      # reproducible run; Menu → Record 60 s
open http://localhost:8000/?rng=test1&solo=bass   # one part on its own, for levels
open http://localhost:8000/?lite=1         # the weak-device graph on purpose
```

Menu → Under the hood shows the meters, each part's `why` ("best of 6: on the chords 100%, no
clashes") and the full fit breakdown with the winner's rank. `classic.html` shows the same with the
grid. Nothing needs the network: with the server killed, decisions fall back to the rules and the
mix, feel and scoring are unaffected.
