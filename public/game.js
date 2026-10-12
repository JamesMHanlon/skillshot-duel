// Skillshot Duel client: input, networking (prediction + interpolation), rendering, solo mode.
(() => {
  const C = Sim.C;
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const $ = id => document.getElementById(id);

  const INTERP = 0.1;           // render remote player 100ms in the past
  let mode = null;              // 'solo' | 'online' | null
  let me = 0;
  let solo = null;              // { s, bot, queue, acc, level }
  let ws = null, net = null;
  let view = { scale: 1, ox: 0, oy: 0 };
  const mouse = { x: C.W / 2, y: C.H / 2, sx: 0, sy: 0 };
  let rmb = false, lastMoveSend = 0;
  const fx = { parts: [], shake: 0, marker: null, banner: null, flashes: [] };
  let rtt = 0;

  // ---------------------------------------------------------------- audio
  let actx = null;
  function beep(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
    try {
      actx = actx || new AudioContext();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
    } catch { /* audio unavailable */ }
  }

  // ---------------------------------------------------------------- layout
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const s = Math.min(innerWidth / C.W, innerHeight / (C.H + 40));
    view = { scale: s, ox: (innerWidth - C.W * s) / 2, oy: (innerHeight - C.H * s) / 2 + 12 * s, dpr };
  }
  addEventListener('resize', resize); resize();
  function toWorld(sx, sy) { return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale }; }

  // ---------------------------------------------------------------- input
  cv.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('mousemove', e => { mouse.sx = e.clientX; mouse.sy = e.clientY; Object.assign(mouse, toWorld(e.clientX, e.clientY)); });
  cv.addEventListener('mousedown', e => {
    if (!mode) return;
    Object.assign(mouse, toWorld(e.clientX, e.clientY));
    if (e.button === 2 || e.button === 0) { rmb = true; moveCmd(true); }
  });
  addEventListener('mouseup', () => { rmb = false; });
  addEventListener('blur', () => { rmb = false; });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (!mode) return;
    if (k === 'q') cmd({ type: 'q', x: mouse.x, y: mouse.y });
    else if (k === 'e') cmd({ type: 'e', x: mouse.x, y: mouse.y });
    else if (k === 's') cmd({ type: 'stop' });
    else if (k === 'escape') toMenu();
  });

  function moveCmd(click) {
    lastMoveSend = performance.now();
    const t = Sim.clampTo(me, mouse.x, mouse.y);
    if (click) fx.marker = { x: t.x, y: t.y, t: 0.4 };
    cmd({ type: 'move', x: mouse.x, y: mouse.y });
  }

  function cmd(c) {
    if (mode === 'solo') { solo.queue.push(c); return; }
    if (mode === 'online' && net && ws && ws.readyState === 1) {
      c.seq = ++net.seq;
      ws.send(JSON.stringify({ t: 'c', c }));
      // apply locally for instant feedback
      Sim.applyCmd(net.pred, me, c);
      handleEvents(net.pred.events.splice(0), true);
    }
  }

  // ---------------------------------------------------------------- events & effects
  function burst(x, y, color, n = 18, sp = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random());
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, max: 0.8, color, r: 2 + Math.random() * 3 });
    }
  }
  function banner(text, sub, dur = 1.6, color = '#f2c45a') { fx.banner = { text, sub, t: dur, max: dur, color }; }

  // local=true for events produced by our own prediction
  function handleEvents(evs, local = false) {
    for (const e of evs) {
      const mine = e.p === me;
      // in online mode our own cast/shot/blink are shown from prediction, skip the server echo
      if (mode === 'online' && !local && mine && (e.t === 'cast' || e.t === 'shot' || e.t === 'blink')) continue;
      switch (e.t) {
        case 'cast': if (mine) beep(520, 0.08, 'triangle', 0.05); break;
        case 'shot': beep(mine ? 880 : 660, 0.14, 'sawtooth', 0.035, 500); break;
        case 'blink':
          for (let i = 0; i <= 8; i++) burst(e.fx + (e.x - e.fx) * i / 8, e.fy + (e.y - e.fy) * i / 8, '#9fe0ff', 3, 80);
          beep(300, 0.18, 'sine', 0.06, 900);
          break;
        case 'hit':
          burst(e.x, e.y, '#ffd66b', 24, 320);
          burst(e.x, e.y, e.p === me ? '#ff5a5a' : '#ffffff', 10, 180);
          if (e.p === me) { fx.shake = 0.25; beep(140, 0.25, 'square', 0.08, -60); }
          else beep(1200, 0.12, 'triangle', 0.07, 400);
          if (mode === 'online' && e.p !== me) dropLocalProj(e.x, e.y);
          break;
        case 'go': banner('FIGHT!', '', 0.9); beep(990, 0.2, 'triangle', 0.08); break;
        case 'round':
          if (e.w === -1) banner('DOUBLE KO', 'Round replays', 2.4, '#cfd8e3');
          else banner(e.w === me ? 'ROUND WON' : 'ROUND LOST', '', 2.4, e.w === me ? '#7dffb0' : '#ff7070');
          break;
        case 'match': showEnd(e.w); break;
      }
    }
  }

  function dropLocalProj(x, y) {
    const ps = net.pred.projs;
    let bi = -1, bd = 220;
    ps.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) ps.splice(bi, 1);
  }

  // ---------------------------------------------------------------- solo
  function startSolo(level) {
    mode = 'solo'; me = 0;
    solo = { s: Sim.newState(), bot: new Bot(level, 1), queue: [], acc: 0, level };
    hideAll(); resetFx();
  }
  function updateSolo(dt) {
    solo.acc += Math.min(dt, 0.1);
    const step = 1 / 60;
    while (solo.acc >= step) {
      solo.acc -= step;
      Sim.step(solo.s, step, [solo.queue.splice(0), solo.bot.think(solo.s, step)]);
      handleEvents(solo.s.events.splice(0));
    }
  }

  // ---------------------------------------------------------------- online
  function connect(onOpen) {
    if (ws && ws.readyState === 1) return onOpen();
    if (location.protocol === 'file:' && !window.GAME_SERVER) { $('menuMsg').textContent = 'Online play needs the server running (npm start).'; return; }
    const url = window.GAME_SERVER || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    $('menuMsg').textContent = 'Connecting…';
    ws = new WebSocket(url);
    ws.onopen = () => { $('menuMsg').textContent = ''; onOpen(); };
    ws.onerror = () => { $('menuMsg').textContent = 'Could not reach the game server.'; };
    ws.onclose = () => {
      ws = null;
      if (mode === 'online') { toMenu(); $('menuMsg').textContent = 'Disconnected from server.'; }
      $('wait').classList.add('hidden');
    };
    ws.onmessage = ev => onMsg(JSON.parse(ev.data));
  }
  setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', n: performance.now() })); }, 1000);

  function onMsg(m) {
    switch (m.t) {
      case 'pong': { const r = performance.now() - m.n; rtt = rtt ? rtt * 0.8 + r * 0.2 : r; break; }
      case 'wait':
        hideAll(); $('wait').classList.remove('hidden');
        if (m.quick) { $('waitTitle').textContent = 'Finding opponent…'; $('waitCode').textContent = ''; $('waitSub').textContent = 'You will be matched with the next player who presses Quick Match.'; }
        else { $('waitTitle').textContent = 'Private room'; $('waitCode').textContent = m.code; $('waitSub').textContent = 'Send this code to your friend so they can join.'; }
        break;
      case 'err': $('menuMsg').textContent = m.msg; break;
      case 'start': startOnline(m.side); break;
      case 'rematchReq': $('endMsg').textContent = 'Opponent wants a rematch!'; break;
      case 'left':
        if (mode === 'online') { toMenu(true); $('menuMsg').textContent = 'Your opponent left the match.'; }
        break;
      case 's': onSnapshot(m); break;
    }
  }

  function startOnline(side) {
    mode = 'online'; me = side;
    const pred = Sim.newState();
    pred.players[1 - me].x = -99999; // dummy opponent; prediction never scores hits
    net = { snaps: [], pred, seq: 0, base: null, round: 1, last: null, lastRecv: 0 };
    hideAll(); resetFx();
  }

  function onSnapshot(m) {
    const now = performance.now() / 1000;
    const target = m.time - now;
    net.base = net.base === null ? target : (target > net.base ? net.base + (target - net.base) * 0.3 : net.base + (target - net.base) * 0.05);
    net.snaps.push(m);
    if (net.snaps.length > 40) net.snaps.shift();
    net.last = m; net.lastRecv = now;
    handleEvents(m.ev || []);

    const pred = net.pred, pp = pred.players[me], sp = m.players[me];
    pred.phase = m.phase;
    pp.lives = sp.lives; pp.hitFlash = Math.max(pp.hitFlash, sp.hitFlash);
    if (m.phase !== 'play' || m.round !== net.round) {
      // between rounds: hard sync
      Object.assign(pp, { x: sp.x, y: sp.y, tx: sp.tx, ty: sp.ty, qcd: sp.qcd, ecd: sp.ecd, cast: sp.cast, face: sp.face });
      if (m.phase === 'countdown') pred.projs = [];
      net.round = m.round;
      return;
    }
    const lat = rtt / 2000 + 1 / 60;
    if (sp.seq >= net.seq) {
      // server has seen all our inputs: extrapolate its position to "now" and ease toward it
      let tx = sp.x, ty = sp.y;
      if (sp.tx !== null && sp.cast <= 0) {
        const dx = sp.tx - sp.x, dy = sp.ty - sp.y, d = Math.hypot(dx, dy);
        const k = Math.min(d, C.SPEED * lat) / (d || 1);
        tx += dx * k; ty += dy * k;
      }
      const ex = tx - pp.x, ey = ty - pp.y, err = Math.hypot(ex, ey);
      if (err > 140) { pp.x = tx; pp.y = ty; }
      else if (err > 1) { pp.x += ex * 0.2; pp.y += ey * 0.2; }
      pp.qcd = Math.max(0, sp.qcd - lat);
      pp.ecd = Math.max(0, sp.ecd - lat);
    } else if (Math.hypot(sp.x - pp.x, sp.y - pp.y) > 400) {
      pp.x = sp.x; pp.y = sp.y;
    }
  }

  function updateOnline(dt) {
    const pred = net.pred;
    if (pred.phase === 'play') {
      Sim.updatePlayer(pred, me, dt);
      Sim.updateProjs(pred, dt, false);
      handleEvents(pred.events.splice(0), true);
    } else {
      Sim.updateProjs(pred, dt, false);
      pred.events.length = 0;
    }
  }

  // Build a renderable state for online mode.
  function onlineView() {
    const m = net.last;
    if (!m) return null;
    const now = performance.now() / 1000;
    const serverNow = now + net.base;
    const rt = serverNow - INTERP;
    const o = 1 - me;
    // interpolate opponent
    let a = null, b = null;
    for (let i = net.snaps.length - 1; i >= 0; i--) {
      if (net.snaps[i].time <= rt) { a = net.snaps[i]; b = net.snaps[i + 1] || a; break; }
    }
    if (!a) a = b = net.snaps[0];
    const k = b.time > a.time ? Math.min(1, Math.max(0, (rt - a.time) / (b.time - a.time))) : 0;
    const pa = a.players[o], pb = b.players[o];
    let ox = pa.x + (pb.x - pa.x) * k, oy = pa.y + (pb.y - pa.y) * k;
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 200) { ox = pb.x; oy = pb.y; } // blink: no smear
    const opp = Object.assign({}, pb, { x: ox, y: oy });

    const players = [];
    players[me] = net.pred.players[me];
    players[o] = opp;

    // enemy projectiles: extrapolate from latest snapshot; ours come from prediction
    const since = Math.max(0, serverNow - m.time);
    const projs = net.pred.projs.slice();
    for (const p of m.projs) {
      if (p.o === me) continue;
      const adv = Math.min(since, 0.25) * C.Q_SPEED;
      if (p.d + adv >= C.Q_RANGE) continue;
      projs.push({ ...p, x: p.x + p.dx * adv, y: p.y + p.dy * adv, d: p.d + adv });
    }
    return { phase: m.phase, timer: m.timer - (now - net.lastRecv), wins: m.wins, round: m.round, winner: m.winner, players, projs };
  }

  // ---------------------------------------------------------------- menus
  function hideAll() { ['menu', 'wait', 'end'].forEach(id => $(id).classList.add('hidden')); }
  function resetFx() { fx.parts = []; fx.banner = null; fx.marker = null; fx.shake = 0; }
  function toMenu(keepSocket) {
    if (mode === 'online' && ws && ws.readyState === 1 && !keepSocket) ws.send(JSON.stringify({ t: 'leave' }));
    mode = null; solo = null; net = null; rmb = false;
    hideAll(); $('menu').classList.remove('hidden'); $('menuMsg').textContent = '';
  }
  function showEnd(w) {
    const win = w === me;
    $('endTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('endTitle').style.color = win ? '#7dffb0' : '#ff7070';
    setTimeout(() => {
      if (!mode) return;
      const s = mode === 'solo' ? solo.s : net.last;
      $('endSub').textContent = `Final score ${s.wins[me]} – ${s.wins[1 - me]}` + (mode === 'solo' ? ` vs ${solo.level} bot` : '');
      $('endMsg').textContent = '';
      $('end').classList.remove('hidden');
    }, 1200);
    beep(win ? 660 : 220, 0.5, 'triangle', 0.08, win ? 400 : -100);
  }

  document.querySelectorAll('[data-bot]').forEach(b => b.onclick = () => startSolo(b.dataset.bot));
  $('quick').onclick = () => connect(() => ws.send(JSON.stringify({ t: 'quick' })));
  $('create').onclick = () => connect(() => ws.send(JSON.stringify({ t: 'create' })));
  $('join').onclick = () => {
    const code = $('code').value.trim();
    if (code.length !== 4) { $('menuMsg').textContent = 'Enter a 4-letter room code.'; return; }
    connect(() => ws.send(JSON.stringify({ t: 'join', code })));
  };
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join').click(); });
  $('cancel').onclick = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' })); toMenu(true); };
  $('toMenu').onclick = () => toMenu();
  $('rematch').onclick = () => {
    if (mode === 'solo') startSolo(solo.level);
    else if (mode === 'online' && ws) { ws.send(JSON.stringify({ t: 'rematch' })); $('endMsg').textContent = 'Waiting for opponent…'; }
  };

  // ---------------------------------------------------------------- rendering
  function drawArena() {
    const g = ctx.createLinearGradient(0, 0, C.W, 0);
    g.addColorStop(0, '#132235'); g.addColorStop(0.5, '#0f1a26'); g.addColorStop(1, '#2a1620');
    ctx.fillStyle = g; ctx.fillRect(0, 0, C.W, C.H);
    // tiles
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
    for (let x = 0; x <= C.W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, C.H); ctx.stroke(); }
    for (let y = 0; y <= C.H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(C.W, y); ctx.stroke(); }
    // own side highlight
    ctx.fillStyle = 'rgba(79,179,255,0.04)';
    ctx.fillRect(me === 0 ? 0 : C.W / 2, 0, C.W / 2, C.H);
    // center barrier
    const t = performance.now() / 1000;
    ctx.save();
    ctx.shadowColor = '#7fd4ff'; ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(127,212,255,${0.55 + Math.sin(t * 3) * 0.15})`; ctx.lineWidth = 3;
    ctx.setLineDash([22, 14]); ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.moveTo(C.W / 2, 0); ctx.lineTo(C.W / 2, C.H); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#2e4562'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, C.W - 4, C.H - 4);
  }

  function drawPlayer(p, i, s) {
    const isMe = i === me;
    const ring = isMe ? '#4fb3ff' : '#ff5a5a';
    ctx.save();
    ctx.translate(p.x, p.y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, C.R * 0.7, C.R, C.R * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // casting glow
    if (p.cast > 0) {
      ctx.fillStyle = 'rgba(255,214,107,0.25)';
      ctx.beginPath(); ctx.arc(0, 0, C.R + 14, 0, Math.PI * 2); ctx.fill();
    }
    // team ring
    ctx.strokeStyle = ring; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, C.R, 0, Math.PI * 2); ctx.stroke();
    // body (Ezreal: blue coat, gold trim, blond hair)
    ctx.rotate(p.face);
    ctx.fillStyle = '#2c5ea8'; ctx.beginPath(); ctx.arc(0, 0, C.R - 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c45a'; ctx.beginPath(); ctx.arc(-3, 0, C.R - 14, 0, Math.PI * 2); ctx.fill();
    // gauntlet
    ctx.fillStyle = '#ffe9a8'; ctx.shadowColor = '#ffd66b'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(C.R - 6, 9, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(C.R + 4, 0); ctx.lineTo(C.R - 8, -7); ctx.lineTo(C.R - 8, 7); ctx.fill();
    ctx.rotate(-p.face);
    if (p.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,80,80,${p.hitFlash * 2})`;
      ctx.beginPath(); ctx.arc(0, 0, C.R + 2, 0, Math.PI * 2); ctx.fill();
    }
    // health pips
    const n = C.LIVES, w = 12, gap = 3, tot = n * w + (n - 1) * gap;
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = k < p.lives ? (isMe ? '#5fd38a' : '#ff6464') : 'rgba(255,255,255,0.15)';
      ctx.fillRect(-tot / 2 + k * (w + gap), -C.R - 22, w, 7);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '600 13px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(isMe ? 'YOU' : (mode === 'solo' ? 'BOT' : 'ENEMY'), 0, -C.R - 28);
    ctx.restore();
  }

  function drawProj(p) {
    const len = 110;
    ctx.save();
    const tx = p.x - p.dx * Math.min(len, p.d + 20), ty = p.y - p.dy * Math.min(len, p.d + 20);
    const g = ctx.createLinearGradient(tx, ty, p.x, p.y);
    const col = p.o === me ? '255,214,107' : '255,150,90';
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.9)`);
    ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = C.Q_W * 1.3;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = 25;
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath(); ctx.arc(p.x, p.y, C.Q_W * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawAim(p) {
    if (p.qcd > 0 || p.cast > 0) return;
    const a = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    ctx.save();
    ctx.globalAlpha = 0.12; ctx.fillStyle = '#9fd8ff';
    ctx.translate(p.x, p.y); ctx.rotate(a);
    ctx.fillRect(C.R, -C.Q_W, C.Q_RANGE, C.Q_W * 2);
    ctx.restore();
  }

  function abilityBox(x, y, key, cd, max, label) {
    const s = 58;
    ctx.fillStyle = '#0d1622'; ctx.strokeStyle = cd > 0 ? '#36557c' : '#f2c45a'; ctx.lineWidth = 2;
    ctx.fillRect(x, y, s, s); ctx.strokeRect(x, y, s, s);
    ctx.fillStyle = cd > 0 ? '#5d6b7e' : '#f2c45a';
    ctx.font = '700 26px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(key, x + s / 2, y + s / 2);
    if (cd > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.moveTo(x + s / 2, y + s / 2);
      ctx.arc(x + s / 2, y + s / 2, s * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (cd / max));
      ctx.save(); ctx.clip(new Path2D(`M${x} ${y}h${s}v${s}h-${s}z`)); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = '700 18px Segoe UI, sans-serif';
      ctx.fillText(cd < 1 ? cd.toFixed(1) : Math.ceil(cd), x + s / 2, y + s / 2);
    }
    ctx.fillStyle = '#9fb0c6'; ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(label, x + s / 2, y + s + 12);
    ctx.textBaseline = 'alphabetic';
  }

  function drawHud(s) {
    ctx.textAlign = 'center';
    // score
    ctx.fillStyle = 'rgba(10,16,26,0.8)'; ctx.fillRect(C.W / 2 - 130, 8, 260, 50);
    ctx.fillStyle = '#9fb0c6'; ctx.font = '600 13px Segoe UI, sans-serif';
    ctx.fillText(`ROUND ${s.round}  ·  BEST OF 3`, C.W / 2, 26);
    for (let i = 0; i < 2; i++) {
      for (let k = 0; k < C.WINS; k++) {
        const x = C.W / 2 + (i === 0 ? -1 : 1) * (40 + k * 22);
        ctx.fillStyle = k < s.wins[i] ? (i === me ? '#4fb3ff' : '#ff5a5a') : 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.arc(x, 42, 7, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#f2c45a'; ctx.font = '700 15px Segoe UI, sans-serif'; ctx.fillText('VS', C.W / 2, 47);
    // abilities
    const p = s.players[me];
    abilityBox(C.W / 2 - 66, C.H - 84, 'Q', p.qcd, C.Q_CD, 'Mystic Shot');
    abilityBox(C.W / 2 + 8, C.H - 84, 'E', p.ecd, C.E_CD, 'Arcane Shift');
    // ping
    if (mode === 'online') {
      ctx.textAlign = 'right'; ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillStyle = rtt < 80 ? '#7dffb0' : rtt < 150 ? '#f2c45a' : '#ff7070';
      ctx.fillText(`${Math.round(rtt)} ms`, C.W - 16, 28);
    }
    // countdown / banners
    if (s.phase === 'countdown') {
      const n = Math.ceil(s.timer);
      ctx.save(); ctx.textAlign = 'center';
      ctx.font = '800 120px Segoe UI, sans-serif'; ctx.fillStyle = 'rgba(242,196,90,0.9)';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 20;
      ctx.fillText(n > 0 ? n : '', C.W / 2, C.H / 2 + 40);
      ctx.restore();
    }
    if (fx.banner) {
      const b = fx.banner, a = Math.min(1, b.t / 0.3, (b.max - b.t) / 0.15 + 0.2);
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.textAlign = 'center';
      ctx.font = '800 72px Segoe UI, sans-serif'; ctx.fillStyle = b.color;
      ctx.shadowColor = '#000'; ctx.shadowBlur = 24;
      ctx.fillText(b.text, C.W / 2, C.H / 2 - 120);
      if (b.sub) { ctx.font = '600 24px Segoe UI, sans-serif'; ctx.fillStyle = '#e8eef6'; ctx.fillText(b.sub, C.W / 2, C.H / 2 - 80); }
      ctx.restore();
    }
  }

  function render(s, dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05080e'; ctx.fillRect(0, 0, cv.width, cv.height);
    const d = view.dpr;
    let sx = 0, sy = 0;
    if (fx.shake > 0) { sx = (Math.random() - 0.5) * 16 * fx.shake; sy = (Math.random() - 0.5) * 16 * fx.shake; }
    ctx.setTransform(view.scale * d, 0, 0, view.scale * d, (view.ox + sx) * d, (view.oy + sy) * d);
    drawArena();
    if (!s) return;
    const p = s.players[me];
    if (s.phase === 'play') drawAim(p);
    if (fx.marker) {
      const m = fx.marker;
      ctx.strokeStyle = `rgba(95,211,138,${m.t / 0.4})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, 6 + 18 * (m.t / 0.4), 0, Math.PI * 2); ctx.stroke();
    }
    s.players.forEach((pl, i) => drawPlayer(pl, i, s));
    s.projs.forEach(drawProj);
    for (const q of fx.parts) {
      ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawHud(s);
  }

  function updateFx(dt) {
    fx.shake = Math.max(0, fx.shake - dt);
    if (fx.marker && (fx.marker.t -= dt) <= 0) fx.marker = null;
    if (fx.banner && (fx.banner.t -= dt) <= 0) fx.banner = null;
    for (const q of fx.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy *= 0.92; q.life -= dt; }
    fx.parts = fx.parts.filter(q => q.life > 0);
  }

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (mode && rmb && now - lastMoveSend > 90) moveCmd(false);
    let s = null;
    if (mode === 'solo') { updateSolo(dt); s = solo.s; }
    else if (mode === 'online' && net) { updateOnline(dt); s = onlineView(); }
    updateFx(dt);
    render(s, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
