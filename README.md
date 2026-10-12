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
npm install
npm start
```
Then open http://localhost:3000.

## Netcode
- The server is authoritative. It runs the simulation at 60 Hz and sends snapshots at 30 Hz, and it decides every hit.
- Your own movement, shots and blinks are predicted on your machine, so they respond instantly. Your position is then smoothly corrected toward what the server reports.
- The opponent is drawn 100 ms in the past and interpolated between snapshots, so their movement looks smooth even with jitter. Enemy shots are extrapolated forward to the present.
- The same `public/sim.js` file runs on the server and in the browser, which is also how solo mode works offline.

## Hosting on your website
The game needs a Node.js host that supports WebSockets. Static hosting is not enough. Options include Render, Railway, Fly.io or a VPS.
1. Deploy this folder and use `npm start` as the start command. The server reads the `PORT` environment variable.
2. Players visit the deployed URL. It serves both the game page and the WebSocket.

**If your main site is static** (for example GitHub Pages or Netlify):
- Host `public/` there.
- Run `server.js` on a Node host.
- Point the page at that server, either with `?server=wss://your-game-server.example.com` in the URL or by setting `window.GAME_SERVER` in `index.html`.
- You can also embed the game with an `<iframe>`.

## Tuning
All gameplay numbers are in `C` at the top of `public/sim.js`: speeds, range, cooldowns, hitbox sizes, lives and rounds to win.
