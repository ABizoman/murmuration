# Murmuration

A band with no conductor: every device in the room runs its own agents, and together they play one piece.

## Run
```
npm install
node server.js          # or double-click start.command on a Mac
```
Open `http://localhost:8000` on the laptop. Phones on the same Wi-Fi scan the QR code (or open the LAN address the server prints).
Press **Start a song** on the first device; every other device shows **Join the song**.

`npm test` runs the unit tests (Node only, no browser).

## How to A/B a change

Every change to the sound should be compared against what it replaced, on the same music:

1. Open the page with a fixed random stream: `http://localhost:8000/?rng=test1` (works on `classic.html` too).
   With `?rng=` set, every agent samples from a stream fixed by the rng text and its role, so the
   same seed + the same rng make exactly the same music on that device — including which pack
   variant it picks. Without it, everything is random as before.
2. Press **Start**, then **Record 60 s** (Menu → This device; in the header on `classic.html`).
   The clip downloads as `murmuration-<seed>-<HHMM>.webm` (`.mp4` on iPhone).
3. Make the change, reload the same URL, and record again. Keep both clips and listen back to back.

**Meters** (Menu → Under the hood → Meters, a panel on `classic.html`) show the master peak, an
approximate loudness and how many times the master went above −0.3 dBFS. They reset at the start of
every song, so after a mix change check that the loudness is about the same and clips stay at 0.

Other switches for listening work:

| URL | what it does |
|---|---|
| `?rng=test1` | fixes every agent's random stream: same seed + same rng = same music |
| `?solo=bass` | hears one part on its own (`drums`, `bass`, `chords`, `melody`) — how `ROLE_GAIN` is measured |
| `?lite=1` / `?lite=0` | forces the lite mix on or off instead of deciding from the device |
| `?seed=durhack` | start from this seed (otherwise every page load picks a fresh one, so each improvised song is new) |
| `?voice=chords:synth-pad` | pins one part's instrument (comma-separate several: `?voice=bass:synth-bass,melody:synth-pluck`); everything else stays automatic. With `?solo=` it is how a voice's `gain` is measured |
| `?feel=off` | no swing and no humanising on **this device only**: a straight-grid "before" clip for any feel change. Never use it while several devices play together (that device would be out of time with the others) |

**A feel A/B in one URL change:** `?rng=test1` then `?rng=test1&feel=off`. The decisions are
identical; only the swing and the humanising differ.

**Re-measuring `ROLE_GAIN`** (in `src/audio.js`, after any change to `src/mix.js` or a voice's
`gain`): `npm run measure-levels`. It starts the server on a spare port, plays each part on its own
in headless Chrome (`?solo=<role>&lite=0`) for 40 s, reads the master meters and prints the change
each part needs to reach the target balance: **drums and bass equal, chords 2 dB below them, melody
1 dB above the chords**. `--apply` writes the new values into `src/audio.js` (run it again to
confirm), `--full` also plays the whole band and checks the peak stays under −1 dBFS with no clips,
and `--extra voice=chords:synth-pad` adds URL parameters to every run. It uses Playwright's
Chromium if installed (`npx playwright install chromium`) or else the system Chrome, and serves
Tone.js from `node_modules`, so it works offline.

By hand: open `?rng=test1&solo=drums`, press Start, let it play a few phrases and read the loudness
from the meters; repeat for each part; move each `ROLE_GAIN` by the difference; then play everything
together and check the peak stays under −1 dB and the clip counter stays at 0.

**`npm run qa`** runs the whole band in Node for 40 phrases on five seeds (fixed rng, the real pack
library, no browser) and prints the fit of every part, how often each part changes loop and
instrument, and the melody's continuity. `npm run qa -- --save <name>` also writes the report to
`docs/qa/<name>.txt`, so the numbers can be compared from one change to the next.

## Instruments

`src/voices.js` lists every instrument per part. Sampled ones load from `samples/`; synth ones name a
patch built in `src/audio.js` (`PATCHES`): **synth bass** (saw + sine sub an octave down),
**synth pad** (fat saw, lowpass, stereo chorus: the only stereo-wide part), **synth keys** (soft FM
e-piano, strummed like the piano), **synth lead** (mono, portamento, vibrato that fades in) and
**synth pluck**. While a sampled voice is loading, the part plays through its role's default patch.
The kits have no crash sample, so the **crash** and the **riser** (a noise sweep for the bar before
a big section) are always synthesised into the hats strip.

When improvising, the band plays in a **style** (`src/styles.js`; Menu → Song → Style):
**Dance** (the default: mostly minor, 118–124 bpm, four-on-the-floor kick, the bass on the
off-beats, soft synths, short melody riffs on chord notes that repeat and never get busy) or
**Upbeat pop** (104–124 bpm, mostly major, pop grooves and instruments). The style is carried in the
seed (`durhack#pop`), so every device agrees. Styles are soft weights: anything else is rare, not banned. Instruments only change at the
start of a 4-phrase section, one part at a time, and each part keeps its instrument for at least
two sections; the drums and the bass keep their groove for the whole section unless the energy
jumps. Song mode ignores the family: a song brings its own tempo, chords and instruments.

## The song form (improvising)

An improvised song follows a pop form (`src/form.js`), the same on every device because it is a
pure function of the phrase number:

```
intro 1 · verse 2 · pre 1 · chorus 2 · verse2 2 · chorus 2 · breakdown 1 · finalChorus 2 · outro 1
```

(phrases of 4 bars; after the outro it goes round again from verse2). Each section sets the energy
and how much each part plays (sitting out, light, normal, full); the director's suggestions nudge
the energy by up to ±0.2 but never bring in a part the section leaves out. The first time a part
plays the first chorus, its loop becomes its **hook** (`src/hooks.js`): every later chorus plays
it again, on whichever device has the part, and the verses' melody is scored to relate to it. The
drums add a **fill** in the last bar before the pre, choruses and verse2, a **crash** on the first
downbeat of choruses and verse2, and a **riser** under the bar before each chorus
(`src/transitions.js`); in the breakdown's last bar only the chords keep playing.

**End after one pass** (Menu → Song, or the checkbox on `classic.html`) adds `#end` to the seed, so
every device that joins knows: after the outro the band plays one last chord together and every
device leaves the song on its own ("the song ended" in the log). Songs can bring their own form
(sections, see `docs/ADDING_SONGS.md`); songs without one build themselves up as before.

## Demo checklist

The demo song is **Murmur** (`src/songs/murmur.js`, an original minor-key dance-pop first draft,
about 2:22). Its arrangement is the story: the drums start alone, then the bass, then the chords,
then the melody. (`murmur-pop` is the earlier, brighter pop draft.)

1. **Before**: laptop on the speakers, `node server.js`, phones on the same Wi-Fi. Open the page on
   the laptop with `http://localhost:8000/?demo=murmur` (or Menu → Song → **Demo: Murmur**).
   That picks the song, ticks "End after one pass", fixes the random stream (`rng=demo`), so the
   run is the one you rehearsed, and makes the laptop claim the **drums** (`?part=drums`; any
   device can ask for a part this way). Song mode turns the director off (the song's form leads) and keeps
   one instrument per part, on every device, however it joined.
2. **Start** on the laptop: it covers every part at first, but the intro is drums only.
3. **Phones join** (scan the QR code, press **Join the song**) during the intro and verse: the
   first phone takes the chords, the second the bass, the third the melody (the swarm's usual
   order); a part with no phone of its own is covered by one of the devices. The song itself brings
   the bass in on phrase 2, the chords on phrase 3 and the melody on the pre-chorus (phrase 5),
   whichever device has them, so the build-up is the same however fast the phones join.
4. **Resilience moments** (any time after the first chorus):
   - put the melody phone in **airplane mode**: within a beat or two another device takes the
     melody over and the hook carries on; turn airplane mode off and the phone rejoins.
   - **kill the server** (Ctrl+C): the phones already have direct links and the shared clock;
     nothing stops. Jev falls back to the rules (offline), and a song needs no director.
5. **The end**: after the outro everyone plays one last chord, and every device leaves the song on
   its own ("the song ended").

Also available: `?demo=murmur-pop` (the pop draft, about 2:27) and `?demo=ode-to-joy-pop` (a pop
arrangement of Beethoven's theme, about 1:55).

## The mix

`src/mix.js` holds the whole signal flow as data and `src/audio.js` builds the Tone.js graph from it:

```
per part:   sampler/synth → strip (highpass + EQ3 + pan) → bus   (+ sends)
drums bus   → Compressor (ratio 4) ─┐          kick, snare/toms and hats each have their own strip,
bass bus    → duck → Compressor (3) ┤          so the hats can be filtered and panned and the snare
chords bus  → duck ─────────────────┤          can sit further back in the room than the kick
melody bus  ────────────────────────┴→ master: EQ3 → glue Compressor (2) → Limiter (−1) → speaker
sends:      ROOM (0.9 s) · HALL (2.2 s) · DELAY (⅛ dotted ping-pong → highpass 300 Hz)
```

The highpass filters are what stop the parts fighting: nothing but the kick and bass is allowed
below 180–220 Hz. Because the agents know exactly when every kick plays, the bass (−4 dB) and chord
(−2 dB) buses are **ducked by hand** at kick time and come back over 120 ms — the pop "pump" with no
sidechain and no analysis. Each drum kit therefore loads three samplers (kick / snare and toms /
hats), one per route.

Weak devices (four cores or fewer, or the frame watchdog in `src/main.js` noticing that the engine's
ticks are slipping) switch to the **lite** graph: one reverb instead of two, which
keeps a phone in time. `npm test` checks the routing, the ducking and the lite graph against a fake
Tone.js (`test/fake-tone.mjs`), so the signal flow is covered even though the sound is not.

## Instruments
Every part is played by a sampled instrument (`src/voices.js`, `src/audio.js`, samples in `samples/`, credits in `CREDITS.md`):

| part | instruments |
|---|---|
| drums | acoustic, breakbeat, LinnDrum, CR-78, techno, kit 8 (+ synth) |
| bass | electric, upright, fretless, slap, tuba (+ synth) |
| chords | grand piano, electric piano, nylon guitar, steel guitar, organ, choir, strings, brass section (+ synth) |
| melody | trumpet, alto sax, tenor sax, French horn, trombone, clean/jazz/overdriven guitar, choir oohs (+ synth) |

Each agent picks its instrument at the start of every section (4 phrases), with the same rules + Jev + sampling as its other choices:
match the section's energy, avoid the same family as another part (no choir on chords and melody at once), favour lead sounds when featured,
and change instrument after a couple of sections. Levels were set by measuring each part's loudness (LUFS) with the others muted.
Untick "auto" on a card to pick an instrument by hand. Until a sample set has loaded, that part plays on the old synth.

## Song mode
Pick a song in the **Song** menu instead of improvising from a seed. The song fixes the key, tempo, chords and every part's notes;
the swarm builds it up on its own: one part starts alone, and each agent comes in once enough parts are already playing
(in roughly the song's order, with some randomness), then picks its own busyness and instrument. The director can still call a drop.
Built in (public domain): *In the Hall of the Mountain King* (Grieg), *Canon in D* (Pachelbel), *Ode to Joy* (Beethoven).

Add your own songs by hand or from MIDI: see [`docs/ADDING_SONGS.md`](docs/ADDING_SONGS.md). Songs in `songs-local/` are loaded automatically and never committed.

## Loop packs
On top of the hand-written loops, `src/packs/` holds loops built from three openly licensed sources (credits in `CREDITS.md`):

| pack | what | how many |
|---|---|---|
| Groove MIDI (Magenta, CC BY 4.0) | real drummers: rock, funk, soul, hip-hop, latin, afro-cuban, reggae, gospel, punk, jazz, country, pop, New Orleans, dance, afrobeat | 360 two-bar grooves |
| POP909 (MIT) | real pop melodies, bass lines and piano comping rhythms | 330 melodies, 235 bass lines, 180 comping rhythms |
| free-midi-chords (MIT) | mood-tagged progressions and chord rhythms (pop, soul, hip-hop, offbeat) | 92 progressions, 12 rhythms |

Every melodic loop is stored in scale degrees relative to the chord it was played over, so it fits whatever key and chords the seed picked.
The seed now also picks a mood-tagged progression ("Nostalgic Hopeful", "Dark Mysterious"…); the mood is shown in the header and sent to Jev.
Agents pick a pack style like any other pattern; a style is kept for a few phrases so the groove doesn't change every phrase.

Rebuilding the packs (only needed to change them):
```
./fetch-groove.command                       # or: node tools/fetch-groove.mjs   (downloads Groove MIDI into packs-src/)
git clone --depth 1 https://github.com/music-x-lab/POP909-Dataset packs-src/POP909-Dataset
git clone --depth 1 https://github.com/ldrolez/free-midi-chords packs-src/free-midi-chords
(cd packs-src && unzip -o groove-v1.0.0-midionly.zip)
node tools/build-packs.mjs packs-src/groove packs-src/POP909-Dataset/POP909 packs-src/free-midi-chords
```

## Phase 3: agents deciding from what their peers did

For every phrase, each agent makes four choices from the shared score (what every part played last phrase):
how busy, which pattern, which register, and whether to echo or answer another part.

| layer | file | what it does |
|---|---|---|
| Shared score | `src/decide/context.js`, `src/engine.js` | Parts are gossiped with their notes, so every device holds the same score. Agents keep no private history: a device that takes a part over continues from what the last player did. |
| 16. Offline rules | `src/decide/rules.js` | A weight for every option. Balance busyness around the band's target, leave room when the melody is busy, avoid a register someone is in, keep a pattern for a while then change, reply when addressed. Always available. |
| 17. Jev | `src/decide/jev.js`, `ai.js` | Two bars before a phrase, the score goes to Jev with one yes/no question per option. If the probabilities are back before the agents decide (one bar before), they are blended in; otherwise the rules decide alone. |
| 19. Listening before playing | `src/decide/fit.js` | Each agent renders **six candidate parts** per phrase and scores every one against the band: are its notes on the chords, does it clash with another part by a semitone, does it crowd someone's register, does its rhythm lock with the kick or stay out of the melody's way, is it a singable line, is it close enough to its own last phrase, and (for drums) does the kick follow the bass. Every term is 0–1; the total is their weighted mean. |
| Final choice | `src/decide/select.js` | Statistical: `log(rule weight × Jev probability) + 6 × fit`, softmaxed at temperature 0.35, then sampled — so the part played is both likely and fitting. A 9:1 prior needs a fit about 0.37 better to be overturned. The screen shows how sure each choice was, the fit and which of the six won. |
| 18. Echo / answer | `src/decide/transform.js` | Echo copies a part's rhythm (kick locks to the bass, chords comp the melody) or, between bass and melody, its rhythm and contour in the new register. Answer plays in the gaps the other part leaves; a melody answers a melodic gesture with its mirror image half a bar later. |
| Director | `src/decide/director.js`, `ai.js` | Every 4 phrases any device may ask an LLM for a direction (energy, featured part, who drops out, who echoes/answers whom). Proposals are gossiped; a device follows one once more than half of the live devices endorse it. It only shifts rule weights. |

### API keys
Keys stay on the laptop. Put them in a `.env` file next to `server.js` (it is gitignored, so it never reaches GitHub), or in the environment:
```
GEMINI_API_KEY=...     # director LLM: Gemini via the Interactions API
# DIRECTOR_MODELS=gemini-3.5-flash-lite,gemini-3-flash-preview,gemini-3.8-flash   (tried in order; busy models are skipped)
JEV_API_KEY=...        # real Jev: a TypeSafe key, or an OpenRouter key (sk-or-..., model typesafe/jev-1.14 via OpenRouter)
```
Without a key, each route answers with a **stand-in that is not a model** (pseudo-random preferences for Jev, a fixed energy arc for the director),
labelled as such on screen, so the deadlines, blending and voting can be tested. `decideReal()` in `ai.js` was written from public
descriptions of the Jev API and has not been run against it: check the request and answer field names with your first key.

### When the network goes
Server killed or phone in airplane mode: Jev and the director become unreachable, decisions show `[rules]`, and the last adopted direction stays in force.

## Phase 2: agents talking

| step | file | what it does |
|---|---|---|
| 10. Signalling | `server.js` | Node + `ws`. Hosts the page, gives the QR code, relays offers/answers/ICE between devices, tells everyone when one leaves. Never carries music. |
| 11. Mesh | `src/net/mesh.js` | WebRTC data channel to every device. The newcomer sends offers to everyone already there. Reconnects to the server in the background if it dies. |
| 12. Gossip | `src/net/gossip.js` | Each message is flooded to neighbours, who pass it on once (dedupe by message id, TTL). Carries `state` heartbeats and each agent's `part` choice per phrase. |
| Clock sync | `src/net/clocksync.js` | NTP-style pings over data channels. A joiner jumps to the swarm's time; after that every device nudges toward the average of its neighbours. No reference clock. |
| 13. Join handshake | `src/swarm/swarm.js` | Newcomer says `hello`; a playing peer answers `welcome`: seed, start time, "we're at phrase 6 bar 2", which parts are taken and which are free. |
| 14. Role claiming | `src/swarm/roles.js` | Each device claims one role. Earliest claim wins, ties go to the smaller id; the loser takes the next free role. Unclaimed roles are covered by a device chosen by rendezvous hashing, so every role is always heard. |

### What happens when…
- **A device joins mid-song:** it learns the song from the welcome packet, syncs its clock, claims the first free role (chords → drums → bass → melody), and starts on the right step.
- **A device leaves or goes silent for 4 s:** its role becomes unowned and the device picked by rendezvous hashing starts sounding it straight away.
- **The server is killed:** existing data channels keep working (gossip, clock sync, music). New devices can't join until it's back.
- **Two separate songs meet:** the one that started earlier wins everywhere.

### Tested
Three headless Chrome tabs with clocks skewed by 0, +350 and −200 ms:
shared time agreed within ~1 ms; roles chords / drums / bass with melody covered; the third tab joined mid-song from the welcome packet;
the server was killed and gossip kept flowing; a closed tab's drums were picked up by another tab within 4 s.

### Known limits
- Phones need to reach each other directly on the Wi-Fi. Networks with client isolation (eduroam, many venue networks) block this: bring a hotspot or travel router.
- Pages are served over plain http, so the screen wake lock isn't available: keep phones awake by hand.
- A device that comes back after the server is gone can't reconnect (needs signalling through the mesh: later phase).

## Phase 1: one device
`src/seed.js` (seed → key, mode, tempo, progression), `src/clock.js` (phrase/bar/step from time), `src/loops.js` (loops in scale degrees),
`src/render.js` + `src/theory.js` (loop → notes), `src/feel.js` (swing, humanising, the note-field contract),
`src/audio.js` (Tone.js), `src/engine.js` (compose ahead), `src/agent.js` (busyness, style), `src/midi-import.js` (MIDI packs → scale degrees).
