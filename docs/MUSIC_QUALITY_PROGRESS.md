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

---

# Phases 4–7 (from `docs/MUSIC_QUALITY_HANDOFF.md`)

## Step A — loose ends and QA tooling

### Built
- `tools/measure-levels.mjs` (`npm run measure-levels`): Playwright + headless Chrome, server on a
  spare port, `classic.html?rng=levels&solo=<role>&lite=0`, waits for every sample, reads the
  master meters for 40 s (energy average of the loudness), prints the change per role to reach the
  target balance; `--apply`, `--full`, `--extra`, `--roles`, `--seconds`. Tone.js is served from
  `node_modules/tone` (devDependency) instead of unpkg, so it runs offline.
- `window.murmuration.meters()`, `.resetMeters()`, `.samples()`: read-only hooks for the tool.
- `ROLE_GAIN` re-measured and applied: `{ drums: -11.5, bass: 9, chords: 9, melody: 6.5 }`
  (was `{ drums: -5, bass: 8, chords: 3, melody: 7 }`).
- Chords strip: no widener (`src/mix.js`), centred; tests updated.
- `?feel=off`: `Agent({ feel: false })` skips `humanise()`, `Engine({ swing: false })` ignores
  `structure.swing` at schedule time. Logged and shown on the meters line. README documents it as
  single-device only.
- Groove stability: `CONTINUITY_BONUS_BY_ROLE` (`select.js`) and `CONTINUITY_TARGET` per role
  (`fit.js`); see judgement calls.
- `tools/sim.mjs` (a whole band on one engine in Node) and `tools/qa.mjs` (`npm run qa`,
  `--save <name>` writes `docs/qa/<name>.txt`). `docs/qa/before-A.txt` is main before this step,
  `docs/qa/A.txt` after.
- `test/stepA.test.mjs`: `?feel=off`, the drum continuity target, the QA change counter, and a guard
  that both pages carry every element id `main.js` looks up.

### Judgement calls and deviations
1. **The real cause of drum churn was the continuity term, not the bonus.** Its target was
   0.4–0.75 for every role, so a drummer repeating the groove exactly scored **0.17** and the
   scorer actively pushed the drums off their own groove. Targets are now per role: drums 0.8–1,
   bass 0.5–0.9, chords 0.5–0.9, melody 0.4–0.75 (unchanged). A hook still overrides with 0.9–1.
2. **The bonus goes to any candidate that replays last phrase's exact loop** (not only the
   "continuity" candidate, which `library.find` re-rolls 25% of the time), with the handoff's
   numbers 0.8 / 0.5 / 0.4 / 0.3. It is **off on the first phrase of each director section**
   (`phrase % 4 === 0`), so the band can still change at section starts; for chords and melody it
   also stops once the pattern has been held 3 phrases, as before (otherwise chords and melody sat
   on one loop for 10+ phrases). All of it depends only on the phrase number and the shared score.
3. **"`fit.terms.drums` ≥ 0.95" was not a reachable reading of the old number.** With `?rng=`-style
   streams the drums term was 0.80–0.85 before this step, and its kick-lock half is never computed
   yet (the bass is never "fresh" for the drums until Phase 6). It went *up*, 0.82 → 0.88.
4. Tests changed on purpose: the drums no longer have to change busyness without a director
   (they hold the groove and change pattern; a new test shows they follow an energy change and
   rarely change loop inside a section), and best-of-6 vs most-likely is now "no worse per seed,
   +0.015 pooled" (the bonus trades a little fit for stability; the clash test is unchanged).
5. **Fixed a pre-existing bug:** `classic.html` had no `#song` picker, so `main.js` threw on load
   and the classic UI has been dead since song mode was merged. Added the picker and the id guard.
6. The whole band is now ~2.5 dB quieter (loudness −21.2 vs −18.7) because the drums were carrying
   it. There is 4 dB of headroom left (peak −5.2 dBFS); a master gain could take some if needed.

### Measured
- Tests: **103 passing**.
- Levels (40 s each, `rng=levels`): drums −24.1, bass −25.1, chords −27.3, melody −26.3 dB; worst
  0.8 dB from the target balance. Full band: loudness −21.2 dB, **peak −5.2 dBFS, 0 clips**.
- `npm run qa`, 5 seeds × 40 phrases (before → after):

| | before | after |
|---|---|---|
| drums loop changes | 114/190 | **26/190** (durhack **7/38**) |
| bass / chords / melody loop changes | 80 / 93 / 67 | 48 / 63 / 66 |
| drums fit | 0.81 | 0.90 |
| band fit | 0.87 | 0.89 |
| melody continuity | 0.33 | 0.32 |

### Not verified / needs ears
- [ ] The new balance on real speakers (chords up 6 dB, drums down 6.5 dB): is the piano/guitar now
      audible under the melody? Are the drums still punchy enough?
- [ ] Grooves held for a section: does it feel like a band, or too static?
- [ ] `?feel=off` vs on: is the humanising audible and better?
- [ ] `classic.html` loads and plays again.

## Step B (Phase 4) — synth voices, crash and riser, the upbeat-pop family

### Built
- **B1 patches** (`src/audio.js` `PATCHES`, `patchFor`, `PATCH_ROLE`, `ROLE_PATCH`): one patch per
  synth voice, built lazily on first use into the role's strip. `drums` (the old synth kit + crash +
  riser), `bass` (sawtooth with fast filter envelope + sine sub an octave down at −6 dB, portamento
  0.02), `pad` (fatsawtooth ×3 spread 25 → lowpass 3 kHz → Chorus 2.5 Hz/3.5/0.6, wet 0.4, started;
  12 voices), `keys` (FM e-piano, harmonicity 3, index 4; 12 voices), `pluck` (fatsquare ×2 →
  lowpass 4.5 kHz; 6 voices), `lead` (mono fatsawtooth, portamento 0.03, lowpass ~1.8–2.7 kHz,
  Vibrato 5 Hz whose depth is ramped 0 → 0.08 over 300 ms at every note). A sampled voice that is
  still loading plays through its role's default patch (drums/bass/pad/lead).
- `src/voices.js`: `synth: '<patch>'`; new `synth-keys` (chords, family `keys`, so it strums),
  `synth-pluck` (melody), `melody-epiano` (melody, the e-piano samples under its own id). Synth
  voices' base `weight` is now 1 (they were 0.3 placeholders); measured `gain`s.
- `?voice=<role>:<id>[,…]`: `Agent.pinVoice` pins only the instrument.
- **B2** `crash` (NoiseSynth, decay 1.2 → highpass 5 kHz → hats strip) and `riser` (per note:
  Noise → bandpass swept 300 Hz → 6 kHz exponentially over the note → gain ramped up, cut at the
  end, disposed afterwards). Both always synthesised (the kits have no crash), `DRUM_STRIP` routes
  them to `hats`; `feel.js` gives them no nudge (crash velocity 0.8). The classic grid draws them,
  and a crash ripples the flock on the iPod screen.
- **B3** `src/styles.js`: `STYLE_FAMILIES['pop-upbeat']` (the handoff's version), `familyOf`,
  `familyWeight`. `structureFromSeed()` re-draws mode, tempo, progression and swing from the family
  after all the old draws (keys unchanged, tempos/modes of old seeds change) and stores
  `structure.family`. `rules.js` multiplies style and voice weights by the family (songs ignore it).
- **Instrument stability** (`rules.js` `voiceTurn`): at a section start at most one part may change
  instrument: among parts that have held theirs ≥ 2 sections, the longest-held (ranked up to 3
  sections), ties in role order rotated by one place per section. It reads only last phrase's
  parts, their new `d.voiceSince` (the phrase the instrument started, carried in the gossiped `d`
  and kept through takeover) and the phrase number, so every device agrees.
- **Groove stability**: drums and bass keep their style inside a section unless the directive's
  energy moved > 0.3 from the previous phrase's (`ctx.prevDirective`, new in `buildContext`).
- `npm run qa` now reports, per seed, the share of on-family styles and instruments, instrument
  changes at every section start, and which instruments were used.
- `test/stepB.test.mjs` (14 tests), fake Tone extended (Chorus, Vibrato, FMSynth, Noise, PolySynth
  with its options, two-argument Filter, start/stop, exponential ramps).

### Judgement calls and deviations
1. **Synth levels follow `ROLE_GAIN`.** A patch's level is `ROLE_GAIN[role] + PATCH_DB + gain`, so a
   re-balance moves a whole part. The first, fixed patch levels came out 13–19 dB too quiet
   (measured: pluck −46, keys −45, pad −43, lead −40 dB vs −28 for the sampled voices); the
   measured `gain`s fix that.
2. **"Longest-held goes first" alone stalls.** A part that is offered the turn and keeps its
   instrument stays longest-held, so it got every turn and the band stopped changing after three
   section starts. Ranking by held time capped at 3 sections, with ties rotating, keeps the rule
   and lets the turn move on; and when it is a part's turn, keeping the current instrument has
   weight ×0.3 (was ×0.5).
3. The "default instrument" bonus (the alto sax for the melody) no longer applies with a family:
   the family picks the first instrument.
4. The family's progressions get **2/3 of the chance as a group**, the mood-tagged pack ones the
   rest (the handoff's "2:1" read as group weights; per progression the 92 pack ones would swamp
   the 4–6 family ones).
5. **`npm run qa` now uses one random stream per seed** (`rng-<seed>`): with one shared stream every
   seed made the same first choices, so five seeds were not five runs. `docs/qa/A.txt` was
   re-generated from the step A commit this way so A and B compare fairly.
6. The crash and riser levels are guesses (`FX_DB`: crash −16, riser −36 → −18 dB, a little under
   the handoff's numbers because the drums came down 9 dB across steps A and B). Needs ears.

### Measured
- Tests: **117 passing**.
- Patch levels, each pinned and soloed: synth-bass −23.2, synth-pad −28.0, synth-keys −27.9,
  synth-lead −27.8, synth-pluck −28.0 dB (targets −23.3 / −28.1 / −28.1 / −27.8 / −27.8).
- Balance after re-measuring under the family: drums −24.8, bass −24.5, chords −26.9, melody
  −25.8 dB (worst 0.2 dB off); `ROLE_GAIN = { drums: -14, bass: 7.5, chords: 10.5, melody: 9 }`.
  Full band: loudness −21.1 dB, **peak −4.4 dBFS, 0 clips**.
- `npm run qa` (5 seeds × 40 phrases, A → B): band fit **0.88 → 0.90**; styles on the family list
  **100%**, instruments **99%** (one seed opened on tenor sax for two sections); **at most 1**
  instrument change per section start (typically 1 at most starts); instrument changes per role
  28/18/33/32 → 10/4/10/10; drums fit 0.87 → 0.93; melody fit 0.86 → 0.85 (harmony 0.94 → 0.82,
  clash 0.84 → 0.90). Weighting POP909 melodies 1 instead of 2 would bring melody harmony back to
  0.90; kept at 2 because the builtin melody styles are a handful of hand-written lines that would
  repeat, and the harmony term penalises the passing notes real pop melodies use. Ears decide.

### Not verified / needs ears
- [ ] Each patch on its own: `?rng=b&solo=chords&voice=chords:synth-pad` (and `synth-keys`;
      `bass:synth-bass`; `melody:synth-lead`, `melody:synth-pluck`). Too bright, too dull, too thin?
- [ ] The pad's chorus: does the chords part now sound wide on speakers?
- [ ] The lead's vibrato fade-in: too much, too little?
- [ ] Crash and riser levels (they appear once step C places them; until then only songs or tests
      would play them).
- [ ] Does the band sound like upbeat pop at 104–124 bpm? Melody: POP909 lines vs the builtin ones.
- [ ] One instrument change per section: too often or not often enough?

## Step C (Phase 5) — form, hooks, transitions, ending (improvising)

### Built
- **C1** `src/form.js`: `POP_FORM` (the handoff's sections, energies and plans; `transitionIn` per
  section), `formFromStructure` (null for songs), `sectionAt` (pure, loops back to verse2 with a
  `pass` count; with `structure.end` one `end` coda phrase and then `ended`), `formDirective` (form
  leads, director nudges: `energy = section + 0.4·(director − 0.5)`, feature/pair dropped if they
  involve a part that sits out, drop only for a `normal` part; adds `plan`, `section`, `hook`,
  first/last-phrase flags, `transitionIn`, `nextTransitionIn`, `dropLastBar`, `end`),
  `describeSection`. Wired in `main.js` (`getDirective`), recomputed in `playSong`; the director
  LLM is told the upcoming section names; the director panel shows "song form: chorus (1 of 2)".
- **C2** `rules.js` `clampToPlan` (out / light / normal / full as specified); `ENTRY` only applies
  without a form.
- **C3** `src/hooks.js` `HookBook` (earliest phrase wins, ties lowest device id, junk rejected).
  The engine records a part's loop as its hook on the first phrase of the first hook section and
  emits `{ type: 'hook' }`; `main.js` publishes it (`{ type: 'hook', seed, ... }`), records incoming
  ones for the same seed, and sends the whole book in the welcome to joiners. `buildContext` gets
  `hook`, `section`, `hookEntry`. `Agent.compose` puts the pinned hook candidate first in hook
  sections (exact loop via the new `library.get(id)`): it wins outright for the melody, +2 for bass
  and chords. In verses the melody gets `ctx.hookRef` (the hook rendered over this phrase) and
  `fit.js` continuity also scores the relation to it (target 0.4–0.7, averaged with the usual term).
- **C4** `src/transitions.js` (`applyTransitions`, `makeFill`, `endNotes`, `transitionsIn`), applied
  to the winner before `humanise()`: fill (last 4 or 8 steps, seeded by (seed, phrase, 'fill'),
  snare then toms walking down, velocity 0.5 → 0.95; kept as is when the loop's last bar is already
  a fill), crash on step 0 (hat removed, kick ensured), riser at step 48 for 16 steps (also when the
  drums sit out), and the breakdown's last-bar drop for bass and melody (notes ringing into it cut).
- **C5** "End after one pass": checkbox `#endAfterPass` on both pages; carried as a **seed suffix**
  `<seed>#end` (`parseSeed`, `withEnd`; `songFromSeed` ignores it). The coda: chords hold the tonic
  (root, third, fifth, octave) for two bars, the bass the root, the melody the tonic, the drums kick
  + crash. After three bars of it the engine stops and emits `{ type: 'end' }`; `main.js` leaves the
  song like the Leave button and logs "the song ended".
- `npm run qa` checks the form: sections in order against the written form, the hook in later
  chorus phrases, chorus melody continuity, fills / crashes / risers where the form says (and
  nowhere else). `tools/sim.mjs` drives the engine with `formDirective` like `main.js`.
- `test/stepC.test.mjs` (11 tests, including two engines in memory agreeing on hooks and
  transitions and the hook surviving a takeover).

### Judgement calls and deviations
1. **`#end` in the seed, not the swarm's song state**: `swarm.considerSong` copies only `seed` and
   `startMs`, and the seed already reaches every device (and survives rejoining). The music is
   identical with or without the suffix.
2. **The first phrase of a section is not judged on continuity.** Every section change changed the
   level and so the loop, and continuity scored ~0 there (band fit fell 0.90 → 0.83). A new
   section is meant to change; the hook section's first phrase has the hook as its reference.
3. **The hook is chosen carefully, once:** the first chorus phrase draws twice the candidates and
   takes the best fit instead of a sample (it will be repeated every chorus). Before this the
   melody hooks had harmony 0.68.
4. **No seeded "deterministic fallback" hook.** Only the device that owns a part composes it, so the
   first chorus's winner is unambiguous; a device that takes over later gets the hook from the
   hook message or the welcome. If a device has no entry when it reaches a hook section, its own
   winner becomes the hook (and is published) — the HookBook's earliest-wins rule then settles any
   disagreement. If the hook loop is missing from a device's library, it falls back to normal
   scoring (as specified).
5. **`fit.js` is not told about transitions**: they are added *after* scoring, so the candidates
   are scored on their own loops and a generated fill can never cost a candidate points.
6. Groove stability and the A5 groove bonus now also release on the first phrase of a **form**
   section (they used to release only every 4 phrases, which the form's 1–2-phrase sections
   don't line up with). Instrument changes stay on the director's 4-phrase grid.
7. The handoff's form adds up to **14 phrases** (not 16): about two minutes at 110 bpm.

### Measured
- Tests: **128 passing**.
- `npm run qa` (5 seeds × 40 phrases): band fit **0.91** (B 0.90); sections in order **yes**; hook
  in later chorus phrases **100%**; chorus melody continuity **0.93**; fills **60/60**, crashes
  **70/70**, risers **50/50**; on-family styles 100%, instruments 98%; ≤ 1 instrument change per
  section start.
- End to end in headless Chrome (`/?rng=c`, End after one pass): the form shows on the director
  panel, hooks are reused, the song stops by itself after 130 s ("the song ended"), no page errors,
  master peak −4.0 dBFS, 0 clips.

### Deferred, decided with the humans
- **The melody sounds sour** (heard after step B). To be fixed at the end, together with any other
  sound changes: candidates are lowering the POP909 melody weight (`styles.js`), raising the clash
  weight for the melody, or choosing the hook with clash as a hard limit. The end-to-end run shows
  chosen hooks still reporting "some clash (34%)".
- No more time on level measurements unless the mix changes.

### Not verified / needs ears
- [ ] The energy curve: intro → verse → pre → chorus → … → final chorus. Does the chorus lift?
- [ ] The hook: is the chorus recognisably the same each time? (Tick "End after one pass" to hear
      a full song in ~2 minutes: `/?rng=c`.)
- [ ] Fills, crash and riser: levels (`FX_DB` in `audio.js`) and whether the riser is too long.
- [ ] The breakdown's last-bar drop and the final chord.

## Step D (Phase 6) — staggered decisions, and Jev ranks the candidates (3d)

### Built
- **D1** `src/engine.js`: `COMPOSE_AHEAD = { drums: 2, chords: 2, bass: 1.5, melody: 1 }` bars
  (constructor option `composeAhead`; the old `composeAheadBars` still sets one horizon for all),
  `planAhead = compose + 1`. `ensureParts(phrase)` is now `entryFor` + `ensurePart(phrase, role)`
  per role (still used for the current phrase when joining or after a takeover). `tick()` plans
  once per **horizon group** (roles with the same horizon: drums + chords, bass, melody; one plan
  when all horizons are equal) with deadline `untilNext − compose`, and composes each role at its
  own horizon. Doubling roles copy the owner's part as soon as it is announced. `horizonText()`
  for the classic grid caption. Parts now carry `fresh` (which peers' same-phrase parts the
  decision heard).
- **D2** `Agent.prepare(ctx, advice)` (everything up to and including scoring) and
  `Agent.finish(prepared, { jev })` (pick, arrange, humanise, update state); `compose()` is
  `finish(prepare())`. For roles composing ≥ 1.5 bars ahead, when `onCandidates` is given, the engine
  prepares at compose + 0.5 bar, the app asks Jev to rank (`Jev.rank`: one `"<role>|candidate"`
  choice question, one criterion per candidate in `describePart` words plus its fit), and the
  engine finishes at the compose horizon with `select.jevMultipliers` (`max(p, 0.03)`, normalised
  over the ranked candidates, × K) multiplying the softmax weights (`pickCandidate({ extra })`).
  If a peer's same-phrase part arrived in between, the engine re-prepares (cheap) and Jev's ranking
  still applies to candidates with the same `candidateKey`. The melody never asks (1-bar horizon).
  Jev's stats count the rankings (`ranked`); the director panel shows them.
- `tools/sim.mjs` `devices: 4` (a device per part, gossip with 60 ms latency), `ensembleStats`
  (each part re-scored against what the others actually played that phrase) and `freshStats`.
  `npm run qa` defaults to four devices; `--devices 1` and `--horizons uniform` for comparisons.
- `test/stepD.test.mjs` (8 tests).

### Judgement calls and deviations
1. **The QA had to change to see Phase 6 at all.** With one engine playing every part, the parts
   already composed in order in the same tick and later ones heard earlier ones; staggering helps
   when the parts are on *different* devices. And "fit at decision time" gets stricter as the
   context gets fresher (fresh peers weigh 1, stale 0.5), so it cannot compare set-ups; the
   after-the-fact ensemble score can.
2. Plans are grouped **by horizon value** rather than a fixed list, so equal horizons still give one
   plan per phrase (the old behaviour and its test).
3. The ranking is **only used when the app provides `onCandidates`** (main.js does). Tests and the
   QA, without it, run `compose()` at the horizon as before, so `?rng=` runs are unchanged by 3d's
   timing.
4. Jev's ranking can swing close calls only: like `blend()`, it multiplies the softmax weights, and
   λ = 6 at temperature 0.35 makes a large fit gap worth far more than the ranking. That is
   deliberate (Jev can't pick something sour); a test checks it moves the runner-up a lot.

### Measured
- Tests: **136 passing**.
- `npm run qa`, four devices (`docs/qa/D-uniform-horizons.txt` vs `docs/qa/D.txt`):

| | uniform 1-bar horizons | staggered |
|---|---|---|
| bass heard drums / chords (same phrase) | 0% / 0% | **98% / 98%** |
| melody heard drums / bass / chords | 0% / 0% / 0% | **98% / 98% / 98%** |
| ensemble band fit | 0.88 | **0.91** |
| melody clash (ensemble) | 0.74 | **0.86** |
| chords clash (ensemble) | 0.77 | **0.94** |
| bass rhythm (locks with the kick) | 0.85 | **0.90** |

  Form checks unchanged: sections in order, hook 100%, fills/crashes/risers all in place.
  (The 2% is phrase 0, composed when the song starts.)
- Headless Chrome, `classic.html?rng=d`, 45 s: Jev asked 30, all in time (stand-in, ~250 ms),
  15 candidate sets ranked, parts show "ranked by jev stand-in", no page errors.

### Not verified / needs ears
- [ ] With a phone per part: do the parts sound more "together"? Especially the melody against the
      chords (the clash numbers above suggest the sourness should be less across devices).
- [ ] The drums and chords now decide 2 bars ahead: a director change lands 1 bar later for them.

## Step E (Phase 7) — songs with sections, two demo songs, the demo preset

### Built
- **E1** `src/songs/format.js`: `sections` + `form` (+ `end`, `register`, `loopFrom`). Each
  section's parts compile to loops of style `song-<id>-<section>`, each part written once (every
  density is the part as written); errors name song, section, part and bar. `src/form.js`
  `songForm(song)` turns the song's form into the same kind of form object as the pop form
  (defaults by section name for energy, plan and transitions; each overridable per section);
  `seed.js` puts `form` and the sections' progressions on the structure; `formFromStructure`
  returns it. `render.js` `chordAt` uses the current section's progression counted from the
  section start (the coda is the tonic), and `loopPhrase` makes an 8-bar part start at its
  section's start. `rules.js` song mode with sections: the section's style only, the form's plan
  decides who plays (a role missing from a section rests), one instrument per part (the first the
  song lists), and the song's `register`. Songs without sections are unchanged (tested).
- **E2** `src/songs/murmur-pop.js` — **"Murmur", an original first draft** (A major, 116 bpm,
  ~2:27): intro (drums) · intro2 (+ bass) · verse (+ chords, half-time drums) · pre (+ melody) ·
  chorus (hook) · verse2 · pre · chorus · bridge · finalChorus · outro · last chord. Chorus hook
  `C#-C#-C#-B-C#-E | B-G#-E-B`, answered in bars 3–4 reaching up to F#; verse melody on the same
  rhythm, lower; bass roots/fifths in the verse and an eighth-note pulse with four-on-the-floor in
  the chorus; chords on piano with a push on the "and" of 4. `src/songs/ode-to-joy-pop.js` —
  Beethoven's theme at 120 bpm in D: synth bass, synth pluck an octave above the piano, pop drums,
  a chords-only breakdown (~1:55). The old `ode-to-joy` is unchanged.
- **E3** `?demo=<songId>` (and Menu → Song → **Demo: Murmur**): picks the song, ticks "End after
  one pass", `rng=demo` unless given, and the device claims the drums (`?part=<role>`, new: the
  swarm's `nextClaim` takes a preferred role if nobody owns it). Songs with a form switch the
  director off on every device (`getDirective` passes the default directive; no proposals) and the
  director panel says "the song leads (director off)". README: **Demo checklist**.
  `docs/ADDING_SONGS.md`: "Songs with sections".
- `npm run qa` checks songs against their own written form and compares the chorus melody notes.
  `test/stepE.test.mjs` (8 tests).

### Judgement calls and deviations
1. **With sections, the form is the arrangement**: who plays when comes from the sections, not
   from `songLevel()`'s randomised build-up (the handoff kept the build-up for first entries). The
   demo has to be repeatable and on time; the random entry could leave the melody out of the first
   chorus. Songs without sections still build themselves up.
2. **The director is off and instruments are fixed for every song with sections**, not only with
   `?demo=`: a phone that joins from the QR code (no URL parameters) must decide the same way as the
   laptop, so these can only depend on the shared seed.
3. **`?part=drums` was needed for "the speaker device plays the drums"**: the swarm's claim order is
   chords, drums, bass, melody, so the first device used to take the chords.
4. **"Pushed chords tied into the next bar"** can't be written in the chord-rhythm notation (`x`
   plays the *current* bar's chord, and bars don't tie), so the push is a hit on the "and" of 4 of
   the same chord.
5. The fit scores of written songs are low in places (Ode to Joy: melody clash 0.39): the clash
   term counts Beethoven's passing tones (a G over the held F# on beat 3) as clashes. A song's notes
   are fixed, so the score changes nothing; noted rather than "fixed".
6. A song's notes are fixed per section, so the hook book does not pin anything in songs.

### Measured
- Tests: **144 passing**.
- `npm run qa -- --seeds song:murmur-pop,song:ode-to-joy-pop --phrases 20`: sections in order
  **yes**; chorus melody identical in every later chorus **100%**; fills 9/9, crashes 10/10,
  risers 6/6; every device kept one instrument per part; both songs end on the coda.
- Improvising (`npm run qa`) unchanged from D.
- **Demo rehearsal in headless Chrome, two devices over WebRTC**: laptop `?demo=murmur-pop`
  claimed the drums; a second page joined from `/`, claimed the chords and covered bass and
  melody; every section played in order with "the song leads (director off)"; both devices logged
  "the song ended" at the same moment, 2:27 into the song; no page errors.

### Needs the humans
- [ ] **Approve or replace Murmur's melody** (`src/songs/murmur-pop.js`, `CHORUS_MELODY` and the
      verse2 / pre / bridge melodies). It is a first draft.
- [ ] Listen to the whole demo: `http://localhost:8000/?demo=murmur-pop`, press Start.
- [ ] Rehearse the resilience moments from the README checklist on real phones (airplane mode on
      the melody phone; killing the server).
- [ ] The melody sourness (deferred from step B) — still to do at the end.

## After step E — softer sounds, a Dance style, a minor-key Murmur

Asked for after listening: "the notes sound a bit too harsh", with Stromae's *Alors on danse* as
the feel to aim for (not to copy). What that track does differently: a minor key (C♯ minor, ~118–120
bpm), a melody of a few neighbouring notes repeated, dark and soft synth sounds, and a lot of
repetition and space. Ours was mostly major, with wide POP909 melodies, buzzy square-wave plucks
and treble boosts on the lead and the master.

### Built
- **Softer sounds** (`audio.js`, `mix.js`): pluck now triangle waves through a 2.2 kHz lowpass
  (was square waves at 4.5 kHz); lead lowpass ~0.9–1.6 kHz (was 1.8–2.7); pad lowpass 1.6 kHz
  (was 3) with a slower attack; FM keys modulation index 2.5 (was 4); synth bass filter 250 Hz
  base (was 400); the melody strip now has a −2 dB top cut (was a +1.5 dB boost) and the master
  no treble boost (was +1.5). Synth gains re-measured against a sampled voice of the same part:
  synth-bass −2.5, pad 11.5, keys 13.5, lead 13.5, pluck 20.5.
- **Dance style** (`styles.js` `STYLE_FAMILIES.dance`, now the improvising default): 118–124 bpm,
  85% minor, progressions like i–VI–III–VII; four-on-the-floor drums; new builtin loops
  `bass/offbeat` (the house bass on the off-beats) and `melody/riff` (one-bar riffs of chord
  notes only); synth bass, pad, e-piano and synth keys, pluck and lead; `continuity` lets the
  melody repeat itself (fit target 0.6–1); `maxLevel` keeps the melody at medium or below;
  off-style instruments almost never (`unlistedVoices` 0.004). **Menu → Song → Style** (Dance /
  Upbeat pop), carried in the seed as `#pop` (`parseSeed` now reads any `#tags`).
- **Murmur (dance)** `src/songs/murmur.js`, id `murmur`: A minor, 120 bpm, ~2:22, i–VI–III–VII
  (Am F C G); a one-bar hook rhythm climbing through each chord's notes; the off-beat bass, a
  bouncing octave bass in the chorus; pad and syncopated stabs; four-on-the-floor with open hats on
  the off-beats; the same demo story (drums → bass → chords → melody). The demo (`?demo=murmur`,
  Menu → Demo) now plays it; the pop draft stays as `murmur-pop` ("Murmur (pop draft)").

### Measured
- Tests: **146 passing** (dance style, riffs only chord notes, off-beat bass on the off-beats,
  Murmur's melody inside the chord ≥ 88% of notes).
- `npm run qa` (dance, four devices, `docs/qa/F-dance.txt`): band fit **0.96**; melody harmony
  **1.00** and clash **1.00** (upbeat pop: 0.84 / 0.86); ensemble band 0.95; styles and
  instruments 100% on-style; the form checks all pass.
- `song:murmur` (`docs/qa/F-murmur.txt`): sections in order, chorus identical every time, every
  fill, crash and riser in place. Headless Chrome `?demo=murmur`: plays, no page errors.

### Notes
- The URL fragment trap: `?rng=x#pop` cuts the URL at `#`. Style and end tags live in the seed
  (Menu), never in a URL parameter.

### Needs ears
- [ ] Is it still harsh? The pluck and lead are much darker now; if too dull, raise the pluck's
      lowpass (2200 in `PATCHES.pluck`) or the lead's `baseFrequency` (900).
- [ ] Improvise in Dance (`/?rng=dance1`): does it have the feel you wanted?
- [ ] Murmur (dance) on the speakers: `/?demo=murmur`.

## Dance sound overhaul (after "it doesn't feel closer to Alors on danse")

The listener's answers: the instruments sound cheap, there is no catchy riff, the bass is weak or
plain, the beat is wrong, and it is too happy or bright. So:

- **A synthesised house kit** `kit-house` (`PATCHES.house`): deep sine kick with a fast pitch
  drop, a handclap (three noise bursts 11 ms apart through a 1.5 kHz bandpass) for snares and claps,
  crisp closed and open hats, membrane toms; crash and riser from the standard synth drums.
- **The pump** (`mix.js` `PUMP`, `audio.setPump`): `dance` ducks the bass −10 dB and the chords
  −7 dB on every kick, back over 220 ms (normal: −4 / −2 / 120 ms). Chosen in `playSong` from the
  song's `pump` or the style's (dance), so every device pumps alike.
- **Riff and stab synths** (`synth-riff`, `synth-stab`): saw waves whose filter snaps shut within
  ~0.2 s of each note (the "pluck" of dance music); the stab is three detuned saws. **Deeper synth
  bass**: the sine sub up 4 dB, the saw darker. Gains measured (kit −4.5, bass −6, stab 16.5,
  riff 10.5); the full Murmur demo peaks at −3.7 dBFS, 0 clips.
- **Dance style voices** now prefer the house kit, synth bass, stab/pad and the riff synth.
- **Murmur rewritten** (`src/songs/murmur.js`): Am – Am – Dm – Em (minor v: darker), a syncopated
  3+3+2 riff that runs from the pre-chorus to the end, a moving bass groove, off-beat stabs, the
  house kit with claps on 2 and 4, light shuffle (0.03), the dance pump. Clash 1.00 for every part.
- **Variety** (the listener: "it always goes with the same melody, even after reloading"):
  30 generated riffs (12 syncopated rhythms × 5 shapes, chord notes only) instead of 3, and a fresh
  seed on every page load (`?seed=` to choose one). The demo and `?rng=` runs stay identical on
  purpose.
- Tests: **147 passing**.

### Needs ears
- [ ] `?demo=murmur`: closer? Which of beat / bass / riff / sounds still feels off?
- [ ] The pump depth (−10 / −7 dB): too much "breathing"?

## Round 2, step 1 — different chords per section (improvising)

"It feels like it is just in a loop": one progression ran under the whole improvised song.
- `seed.js` `withSectionChords`: the improvised structure now carries the pop form and a
  progression per section, from its own random stream (`seededRandom(seed, 'sections')`, so the key,
  tempo, mode and the main progression of every seed are unchanged). The chorus (and intro, outro,
  final chorus) keep the seed's progression; the verse (and verse2) get another from the style's
  list; the pre-chorus climbs (`SECTION_PROGRESSIONS.pre`, ending on V or VII); the breakdown
  calms down (`SECTION_PROGRESSIONS.breakdown`). `chordAt` already followed sections.
- Hooks still apply when improvising (the "nothing to pin" rule is for written songs only), and 8-bar
  loops now start with their section.
- The Menu shows "verse … · chorus …".
- Tests **149**; `npm run qa` (`docs/qa/H1-section-chords.txt`): ensemble band fit 0.95 (unchanged),
  sections, hooks and transitions all in place. Headless Chrome: no page errors.
