// Shared game simulation — runs on the server (authoritative) and in the browser (solo mode + prediction).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Sim = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    W: 1600, H: 900,
    R: 30,            // champion hitbox radius
    SPEED: 345,       // move speed (units/s)
    Q_SPEED: 1550,    // Mystic Shot travel speed
    Q_RANGE: 1150,
    Q_W: 26,          // projectile half-width
    Q_CD: 1.25,
    Q_CAST: 0.18,     // windup before the shot leaves
    E_RANGE: 300,     // Arcane Shift blink
    E_CD: 7,
    LIVES: 5,
    WINS: 2,          // best of 3
    COUNTDOWN: 3,
    ROUND_END: 3,
  };

  function mkP(i, old) {
    return {
      x: i ? C.W * 0.8 : C.W * 0.2, y: C.H / 2,
      tx: null, ty: null,
      lives: C.LIVES, qcd: 0, ecd: 0,
      cast: 0, castX: 0, castY: 0,
      face: i ? Math.PI : 0, hitFlash: 0,
      seq: old ? old.seq : 0,
    };
  }

  function newState() {
    return {
      players: [mkP(0), mkP(1)], projs: [],
      phase: 'countdown', timer: C.COUNTDOWN,
      wins: [0, 0], round: 1, winner: -1,
      events: [], nextId: 1, time: 0,
    };
  }

  function bounds(i) {
    return i === 0
      ? { x0: C.R, x1: C.W / 2 - C.R, y0: C.R, y1: C.H - C.R }
      : { x0: C.W / 2 + C.R, x1: C.W - C.R, y0: C.R, y1: C.H - C.R };
  }
  function clampTo(i, x, y) {
    const b = bounds(i);
    return { x: Math.max(b.x0, Math.min(b.x1, x)), y: Math.max(b.y0, Math.min(b.y1, y)) };
  }

  function resetRound(s) {
    s.players = [mkP(0, s.players[0]), mkP(1, s.players[1])];
    s.projs = [];
    s.phase = 'countdown';
    s.timer = C.COUNTDOWN;
  }

  function num(v) { return typeof v === 'number' && isFinite(v); }

  function applyCmd(s, i, c) {
    const p = s.players[i];
    if (c.seq) p.seq = c.seq;
    if (s.phase !== 'play') return;
    if (c.type !== 'stop' && !(num(c.x) && num(c.y))) return;
    if (c.type === 'move') {
      const t = clampTo(i, c.x, c.y);
      p.tx = t.x; p.ty = t.y;
    } else if (c.type === 'stop') {
      p.tx = p.ty = null;
    } else if (c.type === 'q') {
      if (p.qcd > 0 || p.cast > 0) return;
      p.cast = C.Q_CAST; p.castX = c.x; p.castY = c.y; p.qcd = C.Q_CD;
      p.face = Math.atan2(c.y - p.y, c.x - p.x);
      s.events.push({ t: 'cast', p: i });
    } else if (c.type === 'e') {
      if (p.ecd > 0) return;
      const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(C.E_RANGE, d) / d;
      const fx = p.x, fy = p.y;
      const t = clampTo(i, p.x + dx * k, p.y + dy * k);
      p.x = t.x; p.y = t.y; p.ecd = C.E_CD;
      p.face = Math.atan2(dy, dx);
      // keep walking to the old destination if one was set
      s.events.push({ t: 'blink', p: i, fx, fy, x: p.x, y: p.y });
    }
  }

  function updatePlayer(s, i, dt) {
    const p = s.players[i];
    p.qcd = Math.max(0, p.qcd - dt);
    p.ecd = Math.max(0, p.ecd - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (p.cast > 0) {
      p.cast -= dt;
      if (p.cast <= 0) {
        p.cast = 0;
        let dx = p.castX - p.x, dy = p.castY - p.y;
        let d = Math.hypot(dx, dy);
        if (d < 1) { dx = Math.cos(p.face); dy = Math.sin(p.face); d = 1; }
        dx /= d; dy /= d;
        s.projs.push({ id: s.nextId++, o: i, x: p.x + dx * C.R, y: p.y + dy * C.R, dx, dy, d: 0 });
        s.events.push({ t: 'shot', p: i });
      }
      return; // rooted during windup
    }
    if (p.tx !== null) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const step = C.SPEED * dt;
      p.face = Math.atan2(dy, dx);
      if (d <= step) { p.x = p.tx; p.y = p.ty; p.tx = p.ty = null; }
      else { p.x += dx / d * step; p.y += dy / d * step; }
    }
  }

  function updateProjs(s, dt, hitTest = true) {
    const keep = [];
    for (const pr of s.projs) {
      const step = C.Q_SPEED * dt;
      // swept collision: test segment from old to new position
      const ox = pr.x, oy = pr.y;
      pr.x += pr.dx * step; pr.y += pr.dy * step; pr.d += step;
      let hit = false;
      if (hitTest && s.phase === 'play') {
        const t = s.players[1 - pr.o];
        if (segDist(ox, oy, pr.x, pr.y, t.x, t.y) <= C.R + C.Q_W) {
          hit = true;
          t.lives--; t.hitFlash = 0.35;
          s.events.push({ t: 'hit', p: 1 - pr.o, x: pr.x, y: pr.y, id: pr.id });
        }
      }
      if (!hit && pr.d < C.Q_RANGE) keep.push(pr);
    }
    s.projs = keep;
  }

  function segDist(ax, ay, bx, by, px, py) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    let t = ((px - ax) * vx + (py - ay) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + vx * t - px, ay + vy * t - py);
  }

  // cmds: [arrayForP0, arrayForP1]. Events accumulate in s.events; caller clears them.
  function step(s, dt, cmds) {
    s.time += dt;
    for (let i = 0; i < 2; i++) for (const c of (cmds[i] || [])) applyCmd(s, i, c);
    if (s.phase === 'countdown') {
      s.timer -= dt;
      if (s.timer <= 0) { s.phase = 'play'; s.events.push({ t: 'go' }); }
      return;
    }
    if (s.phase === 'roundEnd') {
      updateProjs(s, dt, false);
      s.timer -= dt;
      if (s.timer <= 0) { s.round++; resetRound(s); }
      return;
    }
    if (s.phase !== 'play') { updateProjs(s, dt, false); return; }
    updatePlayer(s, 0, dt);
    updatePlayer(s, 1, dt);
    updateProjs(s, dt, true);
    const dead = s.players.map(p => p.lives <= 0);
    if (dead[0] || dead[1]) {
      // simultaneous KO: nobody scores, replay round
      if (dead[0] && dead[1]) {
        s.events.push({ t: 'round', w: -1 });
        s.phase = 'roundEnd'; s.timer = C.ROUND_END; s.round--;
        return;
      }
      const w = dead[0] ? 1 : 0;
      s.wins[w]++;
      s.events.push({ t: 'round', w });
      if (s.wins[w] >= C.WINS) { s.phase = 'matchEnd'; s.winner = w; s.events.push({ t: 'match', w }); }
      else { s.phase = 'roundEnd'; s.timer = C.ROUND_END; }
    }
  }

  return { C, newState, step, applyCmd, updatePlayer, updateProjs, clampTo, bounds, resetRound };
});
