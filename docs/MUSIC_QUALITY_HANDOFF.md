# Murmuration music quality: handoff for Phases 4–7

You are a Claude Code session picking up a half-finished plan. Another session has done Phases 0–3.
This file tells you everything you need to finish the rest: what exists, what to build, in what
order, how to test it, and when to stop and ask the humans.

Read, in this order, before writing any code:
1. this file, all the way through
2. `docs/MUSIC_QUALITY_PLAN.md` (the original plan; this file overrides it where they differ)
3. `docs/MUSIC_QUALITY_PROGRESS.md` (what the previous session built, and its judgement calls)
4. `README.md`, then skim `src/agent.js`, `src/engine.js`, `src/decide/rules.js`, `src/decide/fit.js`,
   `src/decide/select.js`, `src/audio.js`, `src/mix.js`, `src/feel.js`, `src/songs/format.js`

---

## 0. The project in one paragraph

Murmuration is a browser app: every device in a room (laptops, phones) runs `src/main.js`, joins a
peer-to-peer swarm over WebRTC, claims a part (drums, bass, chords, melody) and plays it with
Tone.js. Devices share a clock, gossip what they play, and take over parts when a device drops out.
Each part is an **agent** that composes one 4-bar **phrase** at a time from a library of
chord-relative loops (`src/loops.js`, `src/packs/`), using offline rules (`src/decide/rules.js`),
optional advice from Jev (a decision model behind the server's `/decide` relay) and a director LLM
that sets the energy every 4 phrases. **Song mode** plays a fixed song (`src/songs/`). The UI is
`index.html` + `src/ipod/app.js` (an iPod-style screen over a starling-flock animation);
`classic.html` is the old debug UI. Both run the same `src/main.js`.

The goal of this work: make it sound like an **upbeat pop band**, both when improvising and in the
hackathon demo (which will probably use song mode). Speakers are available at the demo.

---

## 1. Getting set up

```bash
git clone https://github.com/ABizoman/murmuration.git
cd murmuration
git fetch origin
git checkout music-quality-phases-0-3        # Phases 0-3 live here; NOT merged into main yet
git checkout -b music-quality-phases-4-7
npm install
npm test                                     # expect 98 passing
node server.js                               # then open http://localhost:8000
```

- If `main` has moved since `music-quality-phases-0-3` was created, merge `main` into your branch
  first and fix any conflicts, then run `npm test`.
- There may be a `.env` with API keys on the laptop. Never print it, commit it or copy it anywhere.
- Commit after every step that passes its tests (one commit per sub-phase is ideal). Push the
  branch when the humans ask.

---

## 2. Ground rules (unchanged from the plan; they matter)

1. **Nothing that works today may break:** swarm, clock sync, gossip, takeover, doubling, Jev,
   director, song mode, recording, meters, `?rng=`, `?solo=`, `?lite=`, `classic.html` and
   `index.html`. Don't rename element ids that `src/main.js` uses.
2. **Shared timing stays shared.** Parts are gossiped as note lists and replayed by other devices.
   Anything that changes *what*, *when* or *how loud* must be either baked into the note data at
   compose time (deterministic) or computed identically on every device from shared data (the
   structure, the form, the phrase number). **Never add per-device randomness at playback.**
3. **New note fields or drum names must survive gossip:** update `sanitiseNotes()` in
   `src/feel.js` (it keeps an explicit field list and truncates `drum` names to 12 characters).
4. **Phones:** composition under ~10 ms per agent per phrase; at most two convolution reverbs in
   the whole graph; no large sample downloads without asking the humans.
5. **Works with no network:** rules only, no Jev, no director, server killed.
6. **Style:** small pure modules with a header comment explaining the idea; `node:test` tests in
   `test/`; pure functions tested in Node. `test/fake-tone.mjs` + `test/audio-graph.test.mjs` test the
   real audio graph through a fake Tone.js: extend them whenever you add audio nodes.
7. **Nobody can hear the output from inside a Claude session.** Where a decision needs ears, build
   the measurement tool, make the best default, and list it under "needs ears" in your report.

---

## 3. What already exists (summary of Phases 0–3)

| area | where | notes |
|---|---|---|
| Record 60 s, meters, `?rng=`, `?solo=<role>`, `?lite=1/0` | `src/listen.js`, `src/main.js`, `src/audio.js`, Menu → Under the hood | `?rng=` seeds every agent via `randomFor(rng, role)` |
| Swing | `structure.swing` (0–0.06 improvising; songs may set it), applied in `Engine.tick()` | `MAX_SWING` in `src/clock.js` |
| Humanising | `src/feel.js` `humanise()` at the end of `Agent.compose()` | `nudge` and chord `offsets` baked into notes; deterministic per (seed, phrase, role, note) |
| Mix | `src/mix.js` (graph as data), built in `src/audio.js` | per-part strips, buses, ROOM/HALL/DELAY sends, kick-time ducking, lite graph |
| Candidate scoring | `src/decide/fit.js`, `src/decide/select.js`, `src/agent.js` | K=6 candidates (4 on weak devices), 8 fit terms, softmax `log(prior) + 6·fit` at T 0.35 |
| `ctx.hook` support | `fit.js` continuity term | when `ctx.hook` is true the continuity target is 0.9–1 (already tested) |
| `fresh` peers | `fit.js` | a peer part for the same phrase weighs 1, last phrase's 0.5 |
| Song swing | `src/songs/format.js`, `docs/ADDING_SONGS.md` | default 0 |

Key APIs you will touch:
- `Agent.compose(ctx, advice)` → part `{ notes, d, p, dist, fit, candidates, rank, why, loop }`
- `Engine.ensureParts(phrase)` composes **all** local roles at once; `Engine.tick()` uses one
  `composeAheadBars` (1) and `planAheadBars` (2) for every role
- `buildContext()` in `src/decide/context.js`: `peers[r]` = the part for the phrase being decided if
  already announced, otherwise last phrase's
- `audio.play(role, note, whenMs, durMs, voiceId, stepMs)` (6 arguments)
- the library: `createLibrary({ packs, builtins })` with `find(role, style, density, { random, prefer })`
  and `styles(role)`. Song mode uses a separate library of only that song's loops (`main.js` around
  line 55).
- the director: `SECTION_PHRASES = 4`, `director.directiveFor(phrase)`, read by the engine through
  `getDirective(phrase)` in `main.js`
- swarm messages: `swarm.publish(body)` and the `message: (body, origin)` handler in `main.js` (used
  for director `proposal` / `endorse`); use the same channel for new message types

---

## 4. The work, in order

| step | what | type | rough effort |
|---|---|---|---|
| A | Finish Phase 2–3 loose ends + QA tooling | cleanup | 1–2 h |
| B | Phase 4: synth voices, crash, soft pop style family | sound | 3–4 h |
| C | Phase 5: form, hooks, transitions, ending (improvise mode) | musical | 4–6 h |
| D | Phase 6: staggered decisions + 3d (Jev ranks candidates) | system | 3–4 h |
| E | Phase 7: song sections, two demo songs, demo preset | demo | 3–5 h |

**Stop after each step**: run `npm test`, run `npm run qa` (built in step A), update
`docs/MUSIC_QUALITY_PROGRESS.md` (same format as the previous session: built, judgement calls,
measured, not verified), commit, and tell the humans what to listen for. Wait for a go-ahead before
the next step unless they told you to continue without stopping.

If time runs out, the priority for the demo is **A → B → E** (E can work without C and D, see
step E), then C, then D.

---

## Step A: loose ends and QA tooling

### A1. Automated level measurement (replaces "needs ears" for `ROLE_GAIN`)
`ROLE_GAIN` in `src/audio.js` hasn't been re-measured since the new mix graph. Build
`tools/measure-levels.mjs`:
- uses Playwright (add it as a **devDependency** only) to launch Chromium with
  `--autoplay-policy=no-user-gesture-required`, starts `node server.js` on a spare port, and opens
  `/?rng=levels&solo=<role>&lite=0` for each role
- clicks Start, waits for the samples to load (watch `#samples`), lets it play 40 s, and reads the
  meters' loudness and peak. Expose them for the tool through a small read-only hook, e.g.
  `window.murmuration.meters()`, if they aren't reachable already.
- prints a table (role, loudness, peak) and the gain change needed to bring every role within 1 dB
  of the target balance: **drums and bass equal, chords 2 dB below them, melody 1 dB above the
  chords**
- then apply the changes to `ROLE_GAIN`, re-run, and confirm: master peak below -1 dBFS, clip
  counter 0, the four parts within 1 dB of target
- add `"measure-levels": "node tools/measure-levels.mjs"` to `package.json` scripts

If Playwright can't run on this machine, fall back to the manual recipe in the README and say so.

### A2. Chords widener
The samples are mono, so the `StereoWidener(0.4)` on the chords strip adds no width and may cost
level. **Remove `widen` from the chords strip** in `src/mix.js` for now. Step B gives the synth pad a
stereo Chorus, which is where width should come from. Update `test/mix.test.mjs`.

### A3. Open hat pan
Leave it as is (+0.15 with the hats). Not worth a fourth sampler.

### A4. `?feel=off`
Add `?feel=off`: no swing (treat `structure.swing` as 0 at schedule time) and `humanise()` returns
the notes unchanged. **It must be local to the URL that sets it** and is only for A/B listening:
document that it must not be used when several devices play together. Add it to the README's A/B
recipe.

### A5. Drum loop churn
At K=6 the drums change loop in 18 of 38 phrases (9 of 38 before scoring). A pop drummer keeps a
groove for a section. Add a **role-specific continuity bonus**: `CONTINUITY_BONUS_BY_ROLE = { drums:
0.8, bass: 0.5, chords: 0.4, melody: 0.3 }` in `select.js`, used by `agent.js` instead of the single
constant. Target: drums change loop in **≤ 10 of 38** phrases with seed `durhack` and `?rng=` fixed,
while the kick/bass lock (`fit.terms.drums`) stays ≥ 0.95. Tune the numbers to hit that; record what
you chose.

### A6. `npm run qa`: a Node "music QA" report
Build `tools/qa.mjs` (no browser): run the engine for 40 phrases with seeds `durhack`, `pop1`,
`pop2`, `pop3`, `pop4`, all four roles on one engine, the real library (packs), a fixed rng and a
fake audio sink that collects notes. Print:
- mean `fit.total` and each term per role
- loop changes per role (out of 39 transitions)
- voice changes per role
- melody continuity mean
- after step C: share of chorus phrases whose melody loop equals the hook loop; sections seen in
  order; fills in the last bar before each chorus; crashes on chorus downbeats
- after step E: the same for the demo songs

Save the output to `docs/qa/<step>.txt` on each run you report, so the numbers can be compared across
steps. Add `"qa": "node tools/qa.mjs"` to `package.json`.

**Acceptance for A:** levels measured and applied (or manual fallback documented); widener gone;
`?feel=off` works; drum churn ≤ 10/38; `npm run qa` prints the report; tests pass.

---

## Step B (Phase 4): sounds and a soft pop style family

### B1. Synth voices as real patches
Today `audio.js` has one synth per role (`makeSynths()`), used both for `synth: true` voices and as
the fallback while samples load. Change this to **one patch per synth voice id**:
- in `src/voices.js`, synth voices get `synth: '<patch>'` instead of `synth: true`, and a `family`
  (used by `feel.js` strumming and by `rules.js` family clashes):
  - drums: `synth-drums` (patch `drums`, family `kit`), as today
  - bass: `synth-bass` (patch `bass`, family `synth`)
  - chords: `synth-pad` (patch `pad`, family `synth`), **new** `synth-keys` (patch `keys`, family
    `keys`: a soft electric-piano-like FM patch; it strums because its family is `keys`)
  - melody: `synth-lead` (patch `lead`, family `synth`), **new** `synth-pluck` (patch `pluck`,
    family `synth`)
- in `src/audio.js`, `makePatch(name, strip)` builds a patch lazily on first use and routes it into
  the role's strip (pitched voices already route to `strip[role]`). The fallback while samples load
  becomes the role's default patch (`drums`, `bass`, `pad`, `lead`).
- patches (starting points; tune with ears later):
  - **bass**: two voices in parallel, a `Tone.MonoSynth` sine one octave down at -6 dB (sub) + a
    `Tone.MonoSynth` sawtooth with filter cutoff ~900 Hz and a fast filter envelope (attack 0.005,
    decay 0.12, sustain 0.3, octaves 2.5); portamento 0.02; amp envelope attack 0.005, release 0.12
  - **pad**: `Tone.PolySynth(Tone.Synth)` with `fatsawtooth` (count 3, spread 25), attack 0.08,
    decay 0.4, sustain 0.7, release 1.2 → `Tone.Filter` lowpass 3 kHz → `Tone.Chorus(2.5 Hz, 3.5,
    0.6)` with wet 0.4, started (`.start()`). This gives the chords real stereo width (see A2).
  - **keys**: `Tone.PolySynth(Tone.FMSynth)`, harmonicity 3, modulationIndex 4, attack 0.005,
    decay 1.2, sustain 0.2, release 0.8 (a soft e-piano)
  - **pluck**: `Tone.PolySynth(Tone.Synth)` with `fatsquare` (count 2, spread 12), attack 0.002,
    decay 0.25, sustain 0, release 0.2 → lowpass 4.5 kHz
  - **lead**: `Tone.MonoSynth` sawtooth + square blend (or `fatsawtooth`), portamento 0.03, filter
    cutoff ~2.5 kHz, `Tone.Vibrato(5, 0.08)` whose depth ramps in after 300 ms per note (schedule
    the depth with `rampTo` at note start)
- each new voice gets `energy`, `weight` and a measured `gain` (use A1's tool with a URL param that
  pins a voice, e.g. `?voice=<role>:<id>`, which you add; it sets the agent's `voice` pin)
- polyphony: `maxPolyphony` 12 for pad and keys, 6 for pluck

### B2. Crash and riser for the kits
The kits have no crash sample. Add synth drums, routed by `DRUM_STRIP`:
- `crash`: `Tone.NoiseSynth` (white noise, attack 0.001, decay 1.2, sustain 0) → highpass 5 kHz →
  hats strip, -10 dB
- `riser`: white noise → `Tone.Filter` bandpass whose frequency is ramped 300 Hz → 6 kHz over the
  note's duration, gain ramped -30 → -12 dB over the same time, then cut → hats strip (or a new `fx`
  strip with the same sends as hats). Played as a drum note `{ drum: 'riser', dur: 16 }`.
- add `crash` and `riser` to `DRUM_NOTE`/`DRUM_LEN` handling (synth path), `DRUM_STRIP`, and the
  route test in `test/mix.test.mjs`; `sanitiseNotes` already allows any drum string ≤ 12 characters
- `feel.js`: no nudge for `crash`/`riser`; crash velocity 0.8

### B3. Soft pop style family
New `src/styles.js` exporting `STYLE_FAMILIES` with `'pop-upbeat'` exactly as in Phase 4b of
`MUSIC_QUALITY_PLAN.md`, with these changes to the voices:
```js
voices: {
  drums:  { 'kit-breakbeat': 2, 'kit-acoustic': 1.5, 'kit-linn': 1.5, 'kit-8': 1 },
  bass:   { 'bass-electric': 3, 'synth-bass': 2.5, 'bass-slap': 0.4 },
  chords: { 'keys-piano': 2, 'keys-epiano': 2, 'synth-keys': 1.5, 'guitar-steel': 1.5, 'synth-pad': 2, strings: 1 },
  melody: { 'synth-lead': 2, 'synth-pluck': 2.5, 'guitar-clean': 1.5, 'keys-epiano': 1, 'voice-oohs': 0.5 },
},
unlisted: 0.05,
```
Note `keys-epiano` is currently a **chords** voice: if a voice may serve melody too, add it to
`VOICES.melody` as a separate entry with its own id (e.g. `melody-epiano`) pointing at the same
samples, rather than sharing one id across roles.

- `structureFromSeed()` (improvise only, not songs): stores `structure.family = 'pop-upbeat'`, and
  uses the family's `bpm` range, `majorChance`, `progressions` (merge with the mood-tagged pack
  progressions that are major/minor-compatible, weighting the family's own 2:1) and `swing` range.
  **Draw new random values after all existing draws** so the existing parts of the structure stay
  as stable as possible, and note in the report that tempos and modes for old seeds change (that's
  intended).
- `rules.js`: multiply each style weight by `family.styles[role][style] ?? family.unlisted`, and
  each voice weight by `family.voices[role][id] ?? family.unlisted`. Song mode ignores families.
- **Instrument stability:** voices may change only at the start of a director section
  (`phrase % SECTION_PHRASES === 0`, as now), at most every **2** sections per role, and at most
  **one role** per boundary: the role that has held its voice longest goes first; ties go to role
  order drums, bass, chords, melody. Every device must reach the same answer, so base it only on the
  shared score (`ctx.history`, peers' `voice` fields) and the phrase number.
- **Groove stability:** drums and bass keep their style for the section unless the directive's
  energy differs from the previous section's by more than 0.3 (combine with A5's bonus).

**Tests:** family weights applied, no role ever has zero options, unlisted voices still possible
but rare (sample 10,000 draws), the instrument change limits hold, every new patch and drum is
routed (graph test), and `sanitiseNotes` keeps `riser`.

**Acceptance:** `npm run qa` over 5 seeds shows only pop-family styles and voices in > 95% of phrases,
voice changes ≤ 1 per section boundary, and fit not lower than before step B. **Needs ears:** the
patches' sound and `gain` values.

---

## Step C (Phase 5): form, hooks, transitions, ending (improvise mode)

Song mode is untouched in this step (step E gives songs their own sections).

### C1. The form
New `src/form.js` (pure):
- `formFromStructure(structure)` returns `null` for songs, otherwise the upbeat pop form from Phase 5a
  of the plan:
  `intro 1 · verse 2 · pre 1 · chorus 2 · verse2 2 · chorus 2 · breakdown 1 · finalChorus 2 · outro 1`
  (16 phrases; the numbers are phrases). Each section:
  `{ name, phrases, energy, plan: { drums, bass, chords, melody }, hook, transitionIn }` with plan values
  `'out' | 'light' | 'normal' | 'full'` and the energies and plans from the plan's table.
- `sectionAt(form, phrase)` → `{ section, index, phraseInSection, isLastPhrase, isFirstPhrase, pass }`.
  After the outro the form loops back to `verse2` (`pass` counts loops). It must be a pure function of
  `(form, phrase)`.
- `formDirective(form, phrase, directorDirective)` combines them:
  - `energy = clamp(section.energy + 0.4 * (director.energy - 0.5), 0, 1)` (the director nudges,
    the form leads)
  - `feature` and `pair` from the director, unless they feature a role the plan has `out`
  - `drop` from the director only if the plan has that role at `normal`; never drops a `full` role
  - add `plan` (the section's plan), `section` (name) and `hook` (bool)
  - keep `note` from the director
- wire it in `main.js`: `getDirective: (phrase) => formDirective(form, phrase, director.directiveFor(phrase))`
  when a form exists; otherwise as today. Recompute `form` whenever the structure changes (new song,
  new seed). Also use it in `describeForDirector()` so the director LLM knows the section names.
- **The director's own cadence stays 4 phrases.** Its proposals are a nudge layered on the form, so
  they don't need to line up with form sections.

### C2. Rules follow the plan
In `rules.js`, after the existing level weights are computed (improvise branch, not songs), clamp
them with `dir.plan?.[role]`:
- `out`: level `{ 0: 1 }`, with reason "section: sitting out"
- `light`: zero out levels 2–3 (keep 0 small, 0.02)
- `normal`: zero out 3 if energy < 0.6
- `full`: zero out 0 and 1
- `ENTRY` (the old "chords at phrase 0, drums and bass at 1, melody at 2") is replaced by the intro and
  verse plans when a form exists.

### C3. Hooks
- `buildContext()` gets `section` and `hook` from the directive and sets `ctx.hook = directive.hook`
  (fit.js already raises the continuity target when it's true).
- New `src/hooks.js` (pure): a `HookBook` storing `{ role → { loopId, register, phrase, by } }`, with
  `record(entry)` keeping the earliest phrase (ties: lowest device id) and `get(role)`.
- When a part for a hook section's **first phrase** is composed for the **first time** (no entry in the
  book for that role), the engine's `onEvent('part')` path publishes
  `{ type: 'hook', role, phrase, loopId, register }` via `swarm.publish`, and records it locally;
  `main.js`'s `message` handler records incoming hooks. Do this for melody, bass and chords.
- Fallback if no hook message arrives: a deterministic choice, `seededRandom(seed, 'hook', role)`
  over the loops the agent would consider at that section's level, recorded the first time it's needed.
- In hook sections, `Agent.compose()` puts a **pinned hook candidate** first: style/level/register from
  the stored loop, using the exact loop (add `library.get(id)` to `src/loops.js`). If the loop exists
  in the library, that candidate wins outright for melody (skip the softmax); for bass and chords
  give it a +2 bonus and let the fit still veto a clash-heavy choice. If the loop is missing (a
  device without that pack loop), fall back to normal scoring.
- Verses: give the melody's candidates a continuity target relative to the **hook's** onsets of
  0.4–0.7 (pass `ctx.hookRef` with the hook's rendered notes for the current phrase; extend the
  `continuity` term to use it when present). This makes verses relate to the chorus.
- Takeover: a device taking over a part reads the same `HookBook` (it's shared by gossip and by the
  deterministic fallback), so hooks survive a device dropping out.

### C4. Transitions (added by the drums agent, deterministic)
In a new `src/transitions.js` (pure), called by `Agent.compose()` for the drums role after the winner is
chosen and before `humanise()`:
- **fill:** in the last bar of a section whose next section's `transitionIn` includes `'fill'`
  (every section boundary into pre, chorus, finalChorus and verse2): replace bar 4's last 4–8 steps
  with a fill. Use the busy loop's fill bar if the current loop has one; otherwise generate snare/tom
  16ths with velocity rising 0.5 → 0.95. Seeded by `(seed, phrase, 'fill')`.
- **crash:** on step 0 of the first phrase of chorus, finalChorus and verse2: add `{ drum: 'crash',
  step: 0, dur: 4, vel: 0.85 }`, and remove the hat on that step.
- **riser:** in the last phrase before chorus and finalChorus: add `{ drum: 'riser', step: 48, dur:
  16, vel: 0.8 }` (the whole last bar).
- **drop:** in the last bar of the breakdown, every role except chords rests: the rules' `plan`
  handles the section; for the bar-level drop, `transitions.js` also strips notes from steps 48–63 for
  bass and melody when `isLastPhrase` of the breakdown (call it for those roles too).
- fit.js's `drums` term already penalises fills outside the last bar: make it accept fills where
  `transitions.js` put them (pass the transition flags in `ctx`).

### C5. Ending
- Menu checkbox "End after one pass" (ids: `endAfterPass`), stored in the swarm's shared song state so
  every device agrees (add it to the song object `swarm.song` when the song starts: `end: true/false`).
  If the shared state can't carry it cleanly, put it in the seed string (`<seed>#end`) and parse it in
  `structureFromSeed()`. Pick one and document it.
- When `end` is true: the phrase after the first outro is the **end phrase**: every part plays only
  step 0 (chords hold the tonic chord for 2 bars, bass the root, drums kick + crash), then the engine
  stops scheduling, and `main.js` leaves the song the same way the Leave button does, with a log line
  "the song ended". The iPod UI should show the end (its status already follows `swarm.playing`).

**Tests:** `sectionAt` across loops; `formDirective` combinations; plan clamping; HookBook
earliest-wins and the deterministic fallback; hook reuse across choruses (≥ 95% of chorus phrases use
the hook loop for melody); fills/crashes/risers only at boundaries; the end phrase; and the
two-engines-in-memory test style from `test/listen.test.mjs` to show two devices agree on hooks and
transitions.

**Acceptance (`npm run qa`):** sections appear in order; melody continuity in choruses ≥ 0.9; the
hook is reused in ≥ 95% of chorus phrases; a fill before every chorus; a crash on every chorus
downbeat; fit not lower than after step B. **Needs ears:** whether the form's energy curve feels
right, and riser/crash levels.

---

## Step D (Phase 6): staggered decisions + Jev ranking candidates (3d)

### D1. Per-role horizons
In `src/engine.js`:
- `composeAhead = { drums: 2, chords: 2, bass: 1.5, melody: 1 }` bars (constructor option,
  these defaults); `planAhead[role] = composeAhead[role] + 1`.
- Split `ensureParts(phrase)` into `ensurePart(phrase, role)` (the body of today's loop, for one
  role) plus `ensureParts(phrase)` that loops over roles (still used for the current phrase when
  joining mid-song or after a takeover).
- In `tick()`: for each local, non-doubling role, call `onPlan` once per **horizon group** (drums +
  chords, bass, melody) when `untilNext <= planAhead * barMs`, with that group's contexts and deadline
  `untilNext - composeAhead * barMs`; and call `ensurePart(next, role)` when `untilNext <=
  composeAhead[role] * barMs`. Track `planned` per `phrase|group`.
- Doubling roles: keep copying the owner's part as soon as it's announced (no horizon).
- The classic UI caption that says "decided 1 bar before it starts" should read the role's horizon.

Because `buildContext()` already prefers a peer's part for the phrase being decided, and `fit.js`
already weights fresh peers 1 vs 0.5, the bass will now score against the drums' and chords' real next
phrase, and the melody against all three.

### D2. Jev ranks candidates (Phase 3d)
Only now does the timing allow it.
- `Agent.compose()` becomes two steps without breaking the sync API:
  `prepare(ctx, advice)` returns `{ cands, dist, ... }` (everything up to and including scoring), and
  `finish(prepared, extra)` picks and humanises. `compose()` = `finish(prepare(...))` (used by
  takeover, joining, tests).
- In the engine, for a role whose compose horizon is ≥ 1.5 bars (drums, chords, bass at default
  horizons): call `prepare()` at `composeAhead + 0.5` bars, send a Jev question
  `"<role>|candidate"` with one criterion per candidate (`describePart()` of each candidate's notes +
  its style/register/interaction in words), and call `finish()` at the compose horizon with Jev's
  probabilities if they arrived, multiplying each candidate's softmax weight by
  `max(jevP, 0.03) * K` (the same floor and normalisation idea as `blend()`). Otherwise finish without
  them.
- Melody (1 bar horizon) doesn't use 3d by default, to keep its context freshest.
- Re-prepare if a fresh peer part arrives between prepare and finish (the cheap path: just re-run
  `prepare`; it costs < 1 ms).
- `src/decide/jev.js`: add `buildCandidateQuestion(role, cands)` and a decode map, reusing
  `buildState()`; extend the stats (`asked`, `inTime`) so the UI's Jev line counts these too.
- The server (`ai.js` `/decide`) needs no change: it already forwards arbitrary choice questions.
  The stand-in answers too, so this works offline in dev.

**Tests:** with a fake clock and two engines connected in memory, composition happens in the order
drums/chords → bass → melody; the melody's context holds the bass part for the same phrase (fresh);
takeover and doubling still work; `prepare` + `finish` equals `compose` with no Jev answer; a Jev
answer that strongly prefers one candidate makes it win more often (statistically, fixed rng).

**Acceptance (`npm run qa`, which must simulate the horizons):** bass `fresh` share ≈ 100% for drums
and chords, melody fresh for all three; the kick/bass lock and melody clash terms equal or better than
after step C. **Needs ears:** whether parts sound more "together".

---

## Step E (Phase 7): song sections, demo songs, demo preset

### E1. Songs with sections
Extend `src/songs/format.js` and `docs/ADDING_SONGS.md`:
```js
export default {
  id, title, composer, licence, key, mode, bpm, swing,
  build: ['drums', 'bass', 'chords', 'melody'],
  voices: { drums: [...], bass: [...], chords: [...], melody: [...] },
  sections: {
    intro:  { progression: ['I','V','vi','IV'], parts: { chords: {...}, drums: {...} } },
    verse:  { progression: ['vi','IV','I','V'], parts: { melody: {...}, bass: {...}, chords: {...}, drums: {...} } },
    chorus: { progression: ['I','V','vi','IV'], hook: true, parts: { ... } },
    bridge: { ... }, outro: { ... },
  },
  form: [['intro', 1], ['verse', 2], ['chorus', 2], ['verse', 2], ['chorus', 2], ['bridge', 1], ['chorus', 2], ['outro', 1]],
  end: true,
}
```
- Each section's parts compile to loops with style `song-<id>-<section>` (same compiler as today).
  A role missing from a section's parts rests in that section.
- **Chords per phrase:** `chordAt(structure, phrase, bar)` in `src/render.js` must use the current
  section's progression when `structure.sections` exists (via `sectionAt` on the song's form). It
  must stay a pure function of `(structure, phrase, bar)`: render, fit, transform and both UIs call it.
  Put `form` and `sections` (progressions only, not loops) on the structure in `structureFromSeed()`.
- `rules.js` song mode: the style options for a phrase are only that phrase's section style;
  `songLevel()` (the build-up) still decides when each part first comes in, but once in, a part follows
  the section's presence (a role missing from the section rests).
- Reuse step C: `formDirective`, hooks (a `hook: true` section's loops are fixed anyway),
  `transitions.js` (fills, crash, riser at section boundaries) and the ending (`end: true`). If step C
  wasn't done, build only `sectionAt` and `transitions.js` from it now.
- Songs without `sections` must keep working exactly as today (tests in `test/songs.test.mjs`).

### E2. Two demo songs
1. **An original upbeat pop song** (we own it), e.g. id `murmur-pop`, ~116 BPM, major key (e.g. A
   major), chorus `I V vi IV`, verse `vi IV I V`, intro 1 phrase, a 2-bar singable hook repeated with a
   variation in bars 3–4, a bass line that locks with the kick (eighth-note pulse in the chorus,
   roots and fifths in the verse), chords on piano/e-piano with pushed chords (hits on the "and" of 4,
   step 14, tied into the next bar), drums: half-time feel in verse 1, four-on-the-floor + claps/snare
   on 2 and 4 + 16th hats in the chorus. About 2:30 with `end: true`.
   **Write it, but mark it clearly as a first draft and ask the humans to approve or change the
   melody before the demo**; they may supply their own.
2. **`ode-to-joy-pop`**: Beethoven's public-domain melody at 120 BPM in D major, modern arrangement:
   synth bass, synth pluck melody, piano chords, pop drums with claps on 2 and 4. Verse = the first 8
   bars of the theme sparse; chorus = the same theme with the full band; a breakdown with chords only.
   Keep the existing `ode-to-joy` song unchanged.

Both: `voices` lists only voices that sound good in pop (synth bass, electric bass, piano, e-piano,
synth keys, synth pad, synth pluck, synth lead, clean guitar; kits breakbeat/acoustic/linn).

### E3. Demo preset
URL `?demo=<songId>` (and a Menu item "Demo" that selects the song and ticks the right options):
- song mode with that song, `?rng=demo` behaviour, **director off** (the song's form leads; keep the
  director's UI line saying "song form"), instruments fixed per part (first entry of the song's
  `voices`), `end: true`
- the song's `build` order is the demo story: drums first (the speaker device), then bass, then chords
  and melody (phones)
- takeover, rejoining after airplane mode, and killing the server must all still work mid-demo
- add a "Demo checklist" section to the README: which device starts, which joins when, what to
  turn off for the resilience moments

**Tests:** section compilation and errors (a bar not adding up to 16 still gives the same helpful
message); `chordAt` per section; a 2-engine run of `murmur-pop` start to end (ends on the right phrase,
every section in order); old songs unchanged.

**Acceptance:** `npm run qa` for both demo songs shows sections in order, the hook in every chorus,
transitions at boundaries and a clean ending. **Needs ears:** everything about the song itself.

---

## 5. Reporting

After every step, update `docs/MUSIC_QUALITY_PROGRESS.md` with a new section in the same style as the
existing one:
- **Built** (files, functions)
- **Judgement calls and deviations** from this handoff, with the reason
- **Measured** (paste the relevant `npm run qa` numbers and test count)
- **Not verified / needs ears** (a short checklist the humans can tick while listening)

Then tell the humans:
1. what changed, in two or three sentences
2. what to listen for, and the exact URL to open (always with `?rng=` so runs are comparable; use
   `?feel=off` or the previous commit for a "before" clip)
3. anything you need them to decide

## 6. Questions to ask the humans (only when you reach them)

- Step B: if a patch or `gain` sounds wrong to them, which one.
- Step C: "End after one pass": shared song state or seed suffix, if both are hard.
- Step E: approve or replace the original song's melody; which device starts the demo; how long the
  judging slot is (the song should end inside it).
