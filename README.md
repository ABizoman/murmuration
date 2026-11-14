# Murmuration: Phase 1, one device playing alone

Four agents (drums, bass, chords, melody) on one page. The seed gives the structure; the agents decide what to play.

## Run
```
python3 -m http.server 8000      # from this folder (ES modules don't load from file://)
open http://localhost:8000       # phones on the same Wi-Fi: http://<laptop-ip>:8000
npm test                         # Node tests, no browser or audio needed
```

## Pipeline
| step | file | what it does |
|---|---|---|
| 4. Seed → structure | `src/seed.js` | key, mode, tempo, default 4-chord progression. Nothing else comes from the seed. |
| 5. Clock and grid | `src/clock.js` | phrase/bar/step = f(now, startMs, bpm). 16 steps/bar, 4 bars/phrase. |
| 6. Loop library | `src/loops.js` | 2 styles per role × sparse/medium/busy, written as scale degrees relative to the chord root |
| 7. Loop → notes | `src/render.js`, `src/theory.js` | current chord + register + loop → MIDI notes; chord voicings use voice leading |
| 8. Audio | `src/audio.js` | Tone.js synths; clock time → audio time via `getOutputTimestamp()` |
| 9. Compose ahead | `src/engine.js` | next phrase composed `composeAheadBars` before it starts; notes sent to Web Audio 150 ms ahead |
| Agents | `src/agent.js` | each agent picks its own busyness (auto mode: enter one by one, then random walk) and style, with its own randomness |
| MIDI packs | `src/midi-import.js` | `.mid` → relative loop: you give the file's key, mode and chords per bar; notes become degrees + octave, chords become rhythm, drums use the GM map |

## Degree notation (loops.js)
`deg` is relative to the current chord root: 0 root, 2 third, 4 fifth, 6 seventh, 7 octave, -1 scale step below.
Even degrees use the chord's real tones (so V in a minor key gets its major third); odd degrees are passing tones from the scale.

## What Phase 2 plugs into
- `clock.js#localNow` gets a per-device offset (clock sync).
- `engine.start(structure, startMs)`: every device uses the same seed and startMs.
- `engine.myRoles`: which parts this device sounds (role assignment).
- `Agent.compose()` gets the other agents' last phrase as input (Phase 3: playing together).
