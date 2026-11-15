# Murmuration — handoff for the next session (round 2, steps 3 and 4)

You are a fresh Claude session picking up a hackathon project mid-flight (DurHack 2026, Durham,
14–15 Nov). Read this whole file first. Then read, in order: `README.md`,
`docs/MUSIC_QUALITY_PROGRESS.md` (everything built so far, with judgement calls),
`docs/MUSIC_QUALITY_HANDOFF.md` (the original plan for steps A–E, all done), and skim the source
files named below.

## 0. The humans and how to work with them

- The person you talk to is **not a musician**. Explain sound in plain words ("the chorus lifts",
  "the melody rubs against the chords"), and translate their descriptions ("too harsh", "missing a
  layer", "feels like a loop") into concrete changes.
- They want: **one step at a time, push after each step, a write-up per step** that goes through
  every sub-step (what was built, deviations and why, what to listen for, exact URLs), and an
  **estimate of coding time at the start of every step**. They listen between steps.
- Before anything that runs for more than ~2 minutes (level measurements, browser runs), send a
  one-line "running X, about N minutes" message first. Don't spend lots of time on level
  measurements: only re-measure when a sound or the mix changes, and only the voices affected.
- **Never mention Claude or Claude Code in git commits, branches or PRs** (their standing rule).
  Commit as the repo's existing author (`git -c user.name=... user.email=...` from `git log -1`).
- They have about 6 hours left before judging (as of 04:45 Sun 15 Nov). Demo: 6–7 devices
  (a laptop on speakers + phones). The song should end inside the judging slot (~2:30 is fine).
- Windows 11 laptop, VS Code, Node 22+. They run `git pull`, `npm install`, `node server.js`.

## 1. The repo

- GitHub `ABizoman/murmuration`, branch **`music-quality-phases-4-7`** (all work is here; `main`
  has only phases 0–3). Push to this branch. No PR yet; ask before opening one.
- `npm test` — **162 passing** (after step 3) (Node only, `node --test test/*.test.mjs`).
- `npm run qa` — music QA report in Node (5 seeds × 40 phrases, one simulated device per part with
  60 ms gossip; `--devices 1`, `--horizons uniform`, `--seeds "song:murmur" --phrases 20`,
  `--save <name>` writes `docs/qa/<name>.txt`). Reports fit per part, loop/instrument changes,
  "ensemble" fit (each part re-scored against what the others really played), the form checks
  (sections in order, hook reuse, fills/crashes/risers), and style-family shares.
- `npm run measure-levels` — headless Chrome (Playwright; system Chrome is used if Playwright's
  Chromium isn't installed; Tone.js served from `node_modules`): solos each part
  (`?solo=<role>&lite=0`) and prints loudness. `--roles x,y`, `--extra voice=<role>:<id>` to pin
  an instrument, `--gate 15` to ignore silent stretches, `--full` to check the whole band's peak,
  `--apply` to write `ROLE_GAIN`. NB: never put `#` in a URL parameter (it starts a fragment).
- `.env` may hold API keys (Jev / Gemini director). Never print, commit or copy it.

## 2. What the app is

Every device in a room opens the page, joins a WebRTC swarm, claims a **part** and plays it with
Tone.js on a shared clock. Parts are composed one 4-bar **phrase** at a time by an agent per part
that picks from a library of chord-relative loops (`src/loops.js` builtins + `src/packs/`),
scores K candidates (`src/decide/fit.js`) and humanises the winner (`src/feel.js`). Parts are
gossiped as note lists so any device can double or take over a part. `index.html` (iPod-style UI
over a starling flock) and `classic.html` (debug UI) run the same `src/main.js`.

**Seven parts now** (`ROLES` in `src/loops.js`): `drums, bass, chords, melody` (core) + `pad, arp,
perc` (extra layers; `kindOf`: pad renders like chords, arp like a melody, perc like drums).
Claim order: chords, drums, bass, melody, pad, arp, perc; fewer devices cover the rest.

## 3. Everything done (newest last; details in `docs/MUSIC_QUALITY_PROGRESS.md`)

**Handoff steps A–E (all done):**
- **A** `measure-levels` tool, `ROLE_GAIN` balanced, no chords widener, `?feel=off`, groove
  stability (per-role continuity targets + bonus), `npm run qa`, fixed `classic.html` (missing
  `#song`), test that both pages have every id `main.js` uses.
- **B** synth patches per voice (`audio.js` `PATCHES`: bass, pad (stereo chorus), FM keys,
  pluck, lead with vibrato), crash + riser, style families (`src/styles.js`), instrument stability
  (`rules.js` `voiceTurn`: one part changes instrument per section start, ≥2 sections; via
  `d.voiceSince` in the gossiped part), groove stability, `?voice=<role>:<id>`.
- **C** `src/form.js` (pop form: intro · verse · pre · chorus · verse2 · chorus · breakdown ·
  finalChorus · outro; plans out/light/normal/full; `formDirective`: form leads, director nudges),
  `src/hooks.js` (first chorus sets each part's hook; gossiped + in the welcome; later choruses
  replay it), `src/transitions.js` (fills, crash, riser, breakdown drop, the coda), "End after one
  pass" (`#end` seed suffix).
- **D** staggered decisions (`engine.js` `COMPOSE_AHEAD`: drums/chords/pad 2 bars, perc/bass 1.5,
  melody 1, arp 0.75), `Agent.prepare`/`finish`, Jev ranks candidates (`jev.rank`), QA simulates
  a device per part.
- **E** songs with sections (`src/songs/format.js`: `sections`, `form`, `end`, `register`,
  `pump`), `chordAt` per section, demo songs, `?demo=<songId>` + Menu → Demo, `?part=<role>`
  (the demo laptop claims the drums), README **Demo checklist**, `docs/ADDING_SONGS.md` sections.

**After E, from listening (round 1):**
- Softer sounds (darker patches; no treble boosts on the lead or master).
- **Dance style** is the default when improvising (`styles.js` `dance`: mostly minor, 118–124
  bpm, four-on-the-floor, off-beat bass, chord-note riffs that may repeat, melody never busy,
  pump `dance`). Upbeat pop via Menu → Song → Style (seed tag `#pop`).
- House kit `kit-house`, deep pump (`mix.js` `PUMP`, `audio.setPump`), `synth-riff`,
  `synth-stab`, deeper synth bass.
- **Murmur** (`src/songs/murmur.js`, id `murmur`): original minor dance-pop first draft, the demo
  song (`?demo=murmur`). A minor, 120 bpm, Am Am Dm Em, syncopated 3+3+2 riff, moving bass groove,
  off-beat stabs, house kit, ~2:22. Builds drums → bass → chords (+pad) → riff (+arp, shaker).
  Older drafts: `murmur-pop` (bright pop), `ode-to-joy-pop`.
- 30 generated riffs (were 3); a fresh random seed on every page load (`?seed=` to choose).

**Round 2 (the person's "it feels like a loop / missing a layer" feedback):**
- **Step 1 done:** each improvised section gets its own chords (`seed.js` `withSectionChords`,
  `styles.js` `SECTION_PROGRESSIONS`); the improvised structure carries `form` + `sections`.
- **Step 2 done:** the three extra parts (pad, arp, perc) with their own devices, loops, voices,
  mix strips, form plans, Murmur parts; clash judged against same-phrase parts only. Levels set
  (pad-warm 11, arp-pluck 24, arp-riff 8.5 estimated, perc-shaker 13). **The person has not
  listened to step 2 yet** — start by asking how it sounds.

## 4. Steps left (agreed with the person; do them in this order, push + write-up after each)

### Step 3 — build-ups and drops — DONE (see `MUSIC_QUALITY_PROGRESS.md`, round 2 step 3)
Make sections feel like they arrive, not loop. All of it must be deterministic and shared (baked
into note data at compose time, or computed identically from the structure/phrase — never
per-device randomness at playback; see ground rules in `MUSIC_QUALITY_HANDOFF.md` §2).
- **Filter sweep up through the pre-chorus**: a brightness ramp on the chords/pad/arp (or a master
  lowpass) opening over the pre's last bars. Simplest shared way: at schedule time in `audio.js`,
  given the directive's section and bar (pass it via the note, e.g. a `sweep` field baked by
  `transitions.js`, or compute from structure + phrase in the engine), ramp a per-strip lowpass.
  Must survive gossip (add any new note field to `sanitiseNotes` in `src/feel.js`).
- **Drop before the chorus**: the drums (and maybe bass) rest for the last half bar / bar of the
  pre-chorus, so the chorus hits harder (add in `transitions.js` as a rule for the last phrase
  before a hook section; keep the riser).
- **Bass walk-ups** into new sections: replace the bass's last 2–4 notes of a section with a
  stepwise approach to the next section's first chord root (`transitions.js`, use `chordAt` for
  the next phrase).
- Tests in the style of `test/stepC.test.mjs`; check with `npm run qa` (form checks must still pass).

### Step 4 — a melody that develops (estimate ~60–90 min)
"It always plays the same riff": make the melody part *write* its line from a motif instead of
only picking fixed loops. Suggested design: a pure `src/motif.js` that, from (seed, section) and
the chords, generates a 1–2-bar motif (rhythm from a set of syncopated patterns, chord-note-led
contour) and develops it phrase by phrase: repeat, vary the ending, transpose to the next chord,
answer (call/response), rhythmic displacement, and a bigger version in the final chorus. Output as
generated loops (same shape as `loops.js` loops, style e.g. `motif-gen`) so the existing candidate
scoring, hooks (chorus motif becomes the hook), transitions and gossip all keep working. Register
it in the library at structure time or generate per phrase inside `Agent.renderCandidate`.
Keep it deterministic from the seed. Weight it in the dance and pop styles. Measure with `npm run
qa` (melody harmony/clash should stay ≥0.95 in dance).

### Also open / deferred
- **The melody sounds sour in upbeat pop** (POP909 melodies weighted ×2; harmony 0.84). Deferred
  "to the end": lower `pop909` weight in `styles.js` `pop-upbeat.styles.melody`, or raise clash.
- **Murmur's melody is a first draft**; the person may want to change it.
- Optional: a few improvised **form variants** chosen by the seed (no pre-chorus, double final
  chorus, longer intro) — ~20–30 min.
- Rehearse on real phones (README checklist): airplane mode on a phone mid-song, kill the server.
- After step 2: check performance on phones with 7 parts on one device (the lite graph exists;
  CANDIDATES_LITE = 4).

## 5. Ground rules that still matter
1. Nothing that works may break: swarm, clock, gossip, takeover, doubling, Jev, director, song
   mode, recording, meters, `?rng=`, `?solo=`, `?lite=`, `?demo=`, `?part=`, `?seed=`, `?voice=`,
   `?feel=off`, both pages. Don't rename element ids `main.js` uses (a test checks).
2. Shared timing stays shared: deterministic, baked into notes or computed from shared data.
3. New note fields / drum names must survive `sanitiseNotes` (`src/feel.js`); new drum names need
   a route in `mix.js` `DRUM_STRIP` (a test checks).
4. Phones: ≤ ~10 ms composition per agent per phrase; ≤ 2 convolution reverbs.
5. Works offline (rules only).
6. Small pure modules with header comments; `node:test` tests; extend `test/fake-tone.mjs` for new
   audio nodes.
7. Nobody can hear from inside the session: build the measurement, pick defaults, list "needs ears".

## 6. Key files (where things live)
`src/loops.js` (ROLES, kinds, builtin loops incl. riffs/pad/arp/perc), `src/voices.js`,
`src/styles.js` (families, SECTION_PROGRESSIONS), `src/seed.js` (structure, tags `#end` `#pop`,
section chords), `src/form.js`, `src/hooks.js`, `src/transitions.js`, `src/agent.js`
(prepare/finish, hooks, transitions, coda), `src/engine.js` (horizons, hooks, end),
`src/decide/rules.js`, `src/decide/fit.js`, `src/decide/select.js`, `src/decide/jev.js`,
`src/audio.js` (PATCHES, pump, ROLE_GAIN), `src/mix.js` (strips, PUMP, DRUM_STRIP),
`src/render.js` (chordAt per section, loopPhrase), `src/songs/*.js`, `src/main.js`,
`src/ipod/app.js`, `src/swarm/roles.js`, `tools/qa.mjs`, `tools/sim.mjs`,
`tools/measure-levels.mjs`.

## 7. Useful URLs (with `node server.js`)
- `http://localhost:8000/?demo=murmur` — the demo song (press Start).
- `http://localhost:8000/` — improvise (fresh seed each load; Menu → Song → Style, End after one pass).
- `http://localhost:8000/?rng=x1&seed=durhack` — a reproducible improvised run.
- `?solo=pad`, `?voice=arp:arp-riff` — listen to one part / pin an instrument.
