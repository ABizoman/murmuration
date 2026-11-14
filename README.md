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
| Final choice | `src/decide/select.js` | Statistical: rule weight × Jev probability, then sample. The screen shows how sure each choice was and which sources were used. |
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
`src/render.js` + `src/theory.js` (loop → notes), `src/audio.js` (Tone.js), `src/engine.js` (compose ahead), `src/agent.js` (busyness, style), `src/midi-import.js` (MIDI packs → scale degrees).
