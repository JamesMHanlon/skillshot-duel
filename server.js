// Skillshot Duel server: serves the client and runs authoritative matches over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('./public/sim.js');

const PORT = process.env.PORT || 3000;
const TICK = 1 / 60;          // simulation rate
const SEND_EVERY = 2;         // snapshots at 30Hz
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let quickWaiting = null;

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function makeRoom(ws, isPrivate) {
  const room = { code: code(), socks: [ws, null], state: null, cmds: [[], []], events: [], tick: 0, timer: null, rematch: [false, false], isPrivate };
  rooms.set(room.code, room);
  ws.room = room; ws.side = 0;
  return room;
}

function joinRoom(ws, room) {
  room.socks[1] = ws; ws.room = room; ws.side = 1;
  startMatch(room);
}

function startMatch(room) {
  room.state = Sim.newState();
  room.cmds = [[], []];
  room.events = [];
  room.rematch = [false, false];
  room.socks.forEach((s, i) => send(s, { t: 'start', side: i, code: room.code }));
  if (room.timer) clearInterval(room.timer);
  let last = process.hrtime.bigint(), acc = 0;
  room.timer = setInterval(() => {
    const now = process.hrtime.bigint();
    acc += Number(now - last) / 1e9; last = now;
    if (acc > 0.25) acc = 0.25;
    while (acc >= TICK) {
      acc -= TICK;
      const s = room.state;
      Sim.step(s, TICK, room.cmds);
      room.cmds = [[], []];
      room.events.push(...s.events); s.events = [];
      if (++room.tick % SEND_EVERY === 0) broadcast(room);
    }
  }, 1000 / 120);
}

function broadcast(room) {
  const s = room.state;
  const r1 = v => Math.round(v * 10) / 10;
  const msg = JSON.stringify({
    t: 's', time: s.time, phase: s.phase, timer: s.timer, wins: s.wins, round: s.round, winner: s.winner,
    players: s.players.map(p => ({ x: r1(p.x), y: r1(p.y), tx: p.tx, ty: p.ty, lives: p.lives, qcd: p.qcd, ecd: p.ecd, cast: p.cast, face: p.face, hitFlash: p.hitFlash, seq: p.seq })),
    projs: s.projs.map(p => ({ id: p.id, o: p.o, x: r1(p.x), y: r1(p.y), dx: p.dx, dy: p.dy, d: p.d })),
    ev: room.events,
  });
  room.events = [];
  room.socks.forEach(ws => ws && ws.readyState === 1 && ws.send(msg));
}

function leave(ws) {
  if (quickWaiting === ws) quickWaiting = null;
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const other = room.socks[1 - ws.side];
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.code);
  if (other) { other.room = null; send(other, { t: 'left' }); }
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'ping': send(ws, { t: 'pong', n: m.n }); break;
      case 'quick':
        leave(ws);
        if (quickWaiting && quickWaiting !== ws && quickWaiting.readyState === 1) {
          const host = quickWaiting; quickWaiting = null;
          joinRoom(ws, host.room);
        } else {
          makeRoom(ws, false); quickWaiting = ws;
          send(ws, { t: 'wait', quick: true });
        }
        break;
      case 'create':
        leave(ws);
        send(ws, { t: 'wait', code: makeRoom(ws, true).code });
        break;
      case 'join': {
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room || !room.isPrivate || room.socks[1]) { send(ws, { t: 'err', msg: 'Room not found or already full.' }); break; }
        leave(ws);
        joinRoom(ws, room);
        break;
      }
      case 'c': {
        const room = ws.room;
        if (!room || !room.state || !m.c) break;
        const q = room.cmds[ws.side];
        if (q.length < 20) q.push({ type: String(m.c.type), x: +m.c.x, y: +m.c.y, seq: m.c.seq | 0 });
        break;
      }
      case 'rematch': {
        const room = ws.room;
        if (!room || !room.state || room.state.phase !== 'matchEnd') break;
        room.rematch[ws.side] = true;
        send(room.socks[1 - ws.side], { t: 'rematchReq' });
        if (room.rematch[0] && room.rematch[1]) startMatch(room);
        break;
      }
      case 'leave': leave(ws); break;
    }
  });
  ws.on('close', () => leave(ws));
});

// drop dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 10000);

server.listen(PORT, () => console.log(`Skillshot Duel running on http://localhost:${PORT}`));
