// AI opponent for solo mode. Produces the same commands a human would send.
(function (root) {
  const C = Sim.C;
  const LEVELS = {
    easy:   { react: 0.42, err: 0.30, fireDelay: [0.6, 1.6], dodge: 0.45, lead: 0.3, useE: false },
    normal: { react: 0.24, err: 0.14, fireDelay: [0.25, 0.9], dodge: 0.75, lead: 0.7, useE: true },
    hard:   { react: 0.13, err: 0.05, fireDelay: [0.05, 0.45], dodge: 0.93, lead: 1.0, useE: true },
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

  function Bot(level, side) {
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.side = side;
    this.fireT = 1;
    this.wanderT = 0;
    this.dodgeLock = 0;
    this.seen = new Map(); // proj id -> will dodge?
  }

  Bot.prototype.think = function (s, dt) {
    const out = [];
    if (s.phase !== 'play') { this.fireT = rnd(0.4, 1); return out; }
    const cfg = this.cfg, me = s.players[this.side], foe = s.players[1 - this.side];
    this.fireT -= dt; this.wanderT -= dt; this.dodgeLock -= dt;

    // --- Dodge incoming shots ---
    let threat = null, best = Infinity;
    for (const pr of s.projs) {
      if (pr.o === this.side) continue;
      if (pr.d / C.Q_SPEED < cfg.react) continue; // hasn't "seen" it yet
      if (!this.seen.has(pr.id)) this.seen.set(pr.id, Math.random() < cfg.dodge);
      if (!this.seen.get(pr.id)) continue;
      const rx = me.x - pr.x, ry = me.y - pr.y;
      const along = rx * pr.dx + ry * pr.dy;
      if (along < 0 || along > C.Q_RANGE - pr.d + C.R) continue;
      const px = rx - pr.dx * along, py = ry - pr.dy * along;
      const perp = Math.hypot(px, py);
      if (perp > C.R + C.Q_W + 12) continue;
      const t = along / C.Q_SPEED;
      if (t < best) { best = t; threat = { pr, px, py, perp, t }; }
    }
    if (threat) {
      const { pr, perp, t } = threat;
      let nx = threat.px, ny = threat.py;
      if (perp < 1) { nx = -pr.dy; ny = pr.dx; if (Math.random() < 0.5) { nx = -nx; ny = -ny; } }
      const l = Math.hypot(nx, ny); nx /= l; ny /= l;
      const need = C.R + C.Q_W + 18 - perp;
      const b = Sim.bounds(this.side);
      const inB = (x, y) => x > b.x0 + 5 && x < b.x1 - 5 && y > b.y0 + 5 && y < b.y1 - 5;
      if (!inB(me.x + nx * (need + 30), me.y + ny * (need + 30))) {
        // flip: dodging the other way means crossing the line
        nx = -nx; ny = -ny;
      }
      // if we flipped to the far side, we must cross the shot's line first
      const dist = nx * threat.px + ny * threat.py < 0 ? perp + C.R + C.Q_W + 18 : need;
      const canWalk = C.SPEED * t > dist;
      if (!canWalk && cfg.useE && me.ecd <= 0 && t < 0.35) {
        out.push({ type: 'e', x: me.x + nx * C.E_RANGE, y: me.y + ny * C.E_RANGE });
      } else if (this.dodgeLock <= 0) {
        out.push({ type: 'move', x: me.x + nx * (dist + 60), y: me.y + ny * (dist + 60) });
        this.dodgeLock = 0.08;
      }
      this.wanderT = rnd(0.3, 0.6);
      return out; // don't shoot while dodging (shot windup roots us)
    }

    // --- Shoot ---
    if (me.qcd <= 0 && me.cast <= 0 && this.fireT <= 0) {
      let vx = 0, vy = 0;
      if (foe.tx !== null && foe.cast <= 0) {
        const dx = foe.tx - foe.x, dy = foe.ty - foe.y, d = Math.hypot(dx, dy) || 1;
        vx = dx / d * C.SPEED; vy = dy / d * C.SPEED;
        // don't lead past their destination
        const tt = d / C.SPEED;
        const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
        const tHit = dist / C.Q_SPEED + C.Q_CAST;
        if (tHit > tt) { vx *= tt / tHit; vy *= tt / tHit; }
      }
      const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
      const tHit = dist / C.Q_SPEED + C.Q_CAST;
      const lead = cfg.lead * rnd(0.6, 1.1);
      let ax = foe.x + vx * tHit * lead, ay = foe.y + vy * tHit * lead;
      const ang = Math.atan2(ay - me.y, ax - me.x) + gauss() * cfg.err;
      if (dist < C.Q_RANGE + C.R) {
        out.push({ type: 'q', x: me.x + Math.cos(ang) * 500, y: me.y + Math.sin(ang) * 500 });
        this.fireT = rnd(...cfg.fireDelay);
        return out;
      }
    }

    // --- Wander / reposition ---
    if (this.wanderT <= 0) {
      const b = Sim.bounds(this.side);
      const x = rnd(b.x0 + 40, b.x1 - 40), y = rnd(b.y0 + 60, b.y1 - 60);
      out.push({ type: 'move', x, y });
      this.wanderT = rnd(0.5, 1.4);
    }
    if (this.seen.size > 200) this.seen.clear();
    return out;
  };

  root.Bot = Bot;
})(self);
