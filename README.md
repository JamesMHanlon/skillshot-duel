# Skillshot Duel

A 1v1 dodgeball game styled after League of Legends. Both players are Ezreal throwing Mystic Shots across a center line. Each player has 5 lives per round, and the match is best of 3. You can play online against another person or solo against a bot (Easy, Normal or Hard).

## Controls
| Input | Action |
|---|---|
| Right-click (hold to keep moving) | Move |
| Q | Mystic Shot toward the cursor (1.25s cooldown) |
| E | Arcane Shift: blink up to 300 units toward the cursor (7s cooldown) |
| S | Stop |
| Esc | Leave the match |

## Run locally
```
npm start
```
Then open http://localhost:3000. Opening `public/index.html` directly also works for solo play.

## Online play (no server needed)
- Online play is peer-to-peer over WebRTC, using PeerJS.
- The player who creates the room, or who waits in the Quick Match lobby, runs the authoritative match in their own browser. That player has zero lag and the other player gets the same prediction and smoothing as before.
- PeerJS's free public broker is used only to introduce the two browsers. Game traffic then goes directly between the players.
- A small number of very strict networks (some school or corporate networks) block direct connections.
- Because nothing runs on a server, the whole game is static files. It's served by GitHub Pages and can be embedded anywhere, including Squarespace.

## Netcode
- The host simulates the game at 60 Hz and sends snapshots at 30 Hz. The host decides every hit.
- Your own movement, shots and blinks are predicted locally, so they feel instant.
- The opponent is drawn 100 ms in the past and interpolated between snapshots.
- `public/sim.js` is the single game simulation, used for both hosting and prediction.

## Embedding on Squarespace
Add a **Code** block to a page with:
```html
<iframe src="https://skillshotduel.james-mh.com/public/" style="width:100%;aspect-ratio:16/9;border:0" allow="autoplay; fullscreen"></iframe>
```

## Tuning
All gameplay numbers are in `C` at the top of `public/sim.js`.
