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
- Imported MIDI loops only exist on the device that imported them; other devices show "not in my library".

## Phase 1: one device
`src/seed.js` (seed → key, mode, tempo, progression), `src/clock.js` (phrase/bar/step from time), `src/loops.js` (loops in scale degrees),
`src/render.js` + `src/theory.js` (loop → notes), `src/audio.js` (Tone.js), `src/engine.js` (compose ahead), `src/agent.js` (busyness, style), `src/midi-import.js` (MIDI packs → scale degrees).
