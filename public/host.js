// Runs an authoritative match inside the host player's browser (replaces a dedicated server).
// sendTo(side, msg) delivers a message to player `side` (0 = host itself, 1 = remote guest).
(function (root) {
  const TICK = 1 / 60, SEND_EVERY = 2;

  function HostRoom(sendTo) {
    this.sendTo = sendTo;
    this.timer = null;
  }

  HostRoom.prototype.start = function () {
    this.state = Sim.newState();
    this.cmds = [[], []];
    this.events = [];
    this.rematch = [false, false];
    this.tick = 0;
    this.sendTo(0, { t: 'start', side: 0 });
    this.sendTo(1, { t: 'start', side: 1 });
    if (this.timer) clearInterval(this.timer);
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += (now - last) / 1000; last = now;
      if (acc > 0.25) acc = 0.25;
      while (acc >= TICK) {
        acc -= TICK;
        const s = this.state;
        Sim.step(s, TICK, this.cmds);
        this.cmds = [[], []];
        this.events.push(...s.events); s.events = [];
        if (++this.tick % SEND_EVERY === 0) this.broadcast();
      }
    }, 1000 / 120);
  };

  HostRoom.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  HostRoom.prototype.broadcast = function () {
    const s = this.state;
    const r1 = v => Math.round(v * 10) / 10;
    const msg = {
      t: 's', time: s.time, phase: s.phase, timer: s.timer, wins: s.wins.slice(), round: s.round, winner: s.winner,
      players: s.players.map(p => ({ x: r1(p.x), y: r1(p.y), tx: p.tx, ty: p.ty, lives: p.lives, qcd: p.qcd, ecd: p.ecd, cast: p.cast, face: p.face, hitFlash: p.hitFlash, seq: p.seq })),
      projs: s.projs.map(p => ({ id: p.id, o: p.o, x: r1(p.x), y: r1(p.y), dx: p.dx, dy: p.dy, d: p.d })),
      ev: this.events,
    };
    this.events = [];
    this.sendTo(0, msg);
    this.sendTo(1, msg);
  };

  HostRoom.prototype.handle = function (side, m) {
    if (!m || typeof m !== 'object' || !this.state) return;
    switch (m.t) {
      case 'ping': this.sendTo(side, { t: 'pong', n: m.n }); break;
      case 'c': {
        const q = this.cmds[side];
        if (m.c && q.length < 20) q.push({ type: String(m.c.type), x: +m.c.x, y: +m.c.y, seq: m.c.seq | 0 });
        break;
      }
      case 'rematch':
        if (this.state.phase !== 'matchEnd') break;
        this.rematch[side] = true;
        this.sendTo(1 - side, { t: 'rematchReq' });
        if (this.rematch[0] && this.rematch[1]) this.start();
        break;
    }
  };

  root.HostRoom = HostRoom;
})(self);
