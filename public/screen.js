'use strict';
// ============================================================
//  זירה – המסך הגדול. כל המשחקים רצים כאן; הטלפונים רק שולחים קלט.
// ============================================================
(() => {
const socket = io({ transports: ['websocket', 'polling'] });
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const VW = 1600, VH = 900;           // עולם וירטואלי – מותאם לכל מסך
let S = 1, OX = 0, OY = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr);
  S = Math.min(cv.width / VW, cv.height / VH);
  OX = (cv.width - VW * S) / 2; OY = (cv.height - VH * S) / 2;
}
addEventListener('resize', resize); resize();
document.getElementById('fs').onclick = (e) => {
  e.stopPropagation();
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
};

const FONT = '"Rubik","Segoe UI",Arial,sans-serif';
const PC = ['#ff4d6d', '#2ec5ff'];
const PC_DARK = ['#9e1d3a', '#0b6a96'];
const GOLD = '#ffd60a';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapAng = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const G = { code: null, players: [null, null], wins: [0, 0], scene: null, sceneName: '', slowT: 0, shake: 0, t: 0 };
const inp = [mkInp(), mkInp()];
function mkInp() { return { steer: 0, gas: false, brake: false, x: 0.5, y: 0.5, down: false, block: false, jx: 0, jy: 0, l: false, r: false }; }
const isBot = (i) => !G.players[i];
const pname = (i) => (G.players[i] ? G.players[i].name : 'המחשב');

// ---------------- סאונד ----------------
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (AC.state === 'suspended') AC.resume();
}
addEventListener('pointerdown', audio); addEventListener('keydown', audio);
function tone(f, d = 0.12, type = 'square', vol = 0.08, slide = 0) {
  if (!AC || AC.state !== 'running') return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.02);
}
let noiseBuf = null;
function noise(d = 0.15, vol = 0.2, freq = 1200) {
  if (!AC || AC.state !== 'running') return;
  if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f).connect(g).connect(AC.destination); s.start(t); s.stop(t + d);
}
const seq = (notes, gap, d, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, d, type, vol), i * gap));
const SFX = {
  join: () => seq([523, 784], 90, 0.15),
  beep: () => tone(440, 0.18, 'square', 0.06),
  go: () => tone(880, 0.4, 'square', 0.07),
  hit: () => { noise(0.14, 0.35, 900); tone(130, 0.14, 'sine', 0.25, -70); },
  bighit: () => { noise(0.3, 0.45, 700); tone(90, 0.3, 'sine', 0.3, -50); },
  block: () => tone(320, 0.06, 'square', 0.05),
  whoosh: () => noise(0.12, 0.08, 2500),
  puck: () => tone(980, 0.04, 'square', 0.05),
  wall: () => tone(600, 0.03, 'square', 0.03),
  goal: () => seq([523, 659, 784, 1047], 90, 0.2),
  win: () => seq([392, 523, 659, 784, 1047], 120, 0.28),
  bump: () => noise(0.1, 0.2, 400),
};

// ---------------- אפקטים ----------------
const parts = [], floats = [];
function burst(x, y, col, n = 14, sp = 300, size = 6, life = 0.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rnd(sp * 0.3, sp);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.5, life), max: life, col, size: rnd(size * 0.5, size), g: 0 });
  }
}
function floatText(s, x, y, col, size = 48) { floats.push({ s, x, y, col, size, life: 1.2, max: 1.2 }); }
function updFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
  }
  for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.life -= dt; f.y -= 50 * dt; if (f.life <= 0) floats.splice(i, 1); }
  G.shake = Math.max(0, G.shake - dt * 45);
}
function drawFx() {
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const f of floats) {
    const k = f.life / f.max, pop = 1 + Math.max(0, (k - 0.85)) * 3;
    ctx.globalAlpha = clamp(k * 2, 0, 1);
    txt(f.s, f.x, f.y, f.size * pop, f.col, 'center', 900, 8);
  }
  ctx.globalAlpha = 1;
}

// ---------------- ציור בסיסי ----------------
function txt(s, x, y, size, col = '#fff', align = 'center', weight = 800, stroke = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.direction = /[\u0590-\u05FF]/.test(s) ? 'rtl' : 'ltr';
  if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function panel(x, y, w, h, r = 24, fill = 'rgba(255,255,255,.05)', line = 'rgba(255,255,255,.1)') {
  rr(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = line; ctx.stroke();
}
function bar(x, y, w, h, v, col, back = 'rgba(0,0,0,.45)', fromRight = false) {
  rr(x, y, w, h, h / 2); ctx.fillStyle = back; ctx.fill();
  const fw = Math.max(0, w * clamp(v, 0, 1));
  if (fw > 1) { rr(fromRight ? x + w - fw : x, y, fw, h, h / 2); ctx.fillStyle = col; ctx.fill(); }
}
function bgGrad(c1, c2) {
  const g = ctx.createLinearGradient(0, 0, 0, VH); g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
}
function codeBadge() {
  if (!G.code) return;
  panel(VW / 2 - 110, VH - 46, 220, 36, 18, 'rgba(0,0,0,.5)', 'rgba(255,255,255,.12)');
  txt(`קוד חדר: ${G.code}`, VW / 2, VH - 28, 18, '#c9cdf0', 'center', 700);
}

// ---------------- רשת ----------------
function setScene(name, sc) {
  G.sceneName = name; G.scene = sc; parts.length = 0; floats.length = 0;
  if (sc.enter) sc.enter();
  socket.emit('host:state', Object.assign({ mode: name }, sc.stateExtra || {}));
}
function toPlayer(slot, ev, d) { if (G.players[slot]) socket.emit('host:to', { slot, ev, d }); }

const qrImg = new Image();
function loadQR() { qrImg.src = '/qr?u=' + encodeURIComponent(location.origin + '/play?c=' + G.code); }

socket.on('connect', () => {
  socket.emit('host:create', (r) => {
    G.code = r.code; G.players = [null, null]; loadQR(); setScene('menu', Menu);
  });
});
socket.on('player:away', ({ slot }) => { if (G.players[slot]) G.players[slot].away = true; inp[slot] = mkInp(); });
socket.on('player:joined', ({ slot, name, back }) => {
  G.players[slot] = { name }; inp[slot] = mkInp(); SFX.join();
  if (back) return;
  if (G.sceneName === 'menu') burst(slot ? 1220 : 380, 330, PC[slot], 30, 400, 7, 0.8);
});
socket.on('player:left', ({ slot }) => { G.players[slot] = null; inp[slot] = mkInp(); });
socket.on('axis', ({ slot, d }) => {
  const p = inp[slot]; if (!p || !d) return;
  if (typeof d.steer === 'number' && isFinite(d.steer)) p.steer = clamp(d.steer, -1, 1);
  if ('gas' in d) p.gas = !!d.gas;
  if ('brake' in d) p.brake = !!d.brake;
  if (typeof d.x === 'number' && isFinite(d.x)) p.x = clamp(d.x, 0, 1);
  if (typeof d.y === 'number' && isFinite(d.y)) p.y = clamp(d.y, 0, 1);
  if ('down' in d) p.down = !!d.down;
  if (typeof d.jx === 'number' && isFinite(d.jx)) p.jx = clamp(d.jx, -1, 1);
  if (typeof d.jy === 'number' && isFinite(d.jy)) p.jy = clamp(d.jy, -1, 1);
  if ('l' in d) p.l = !!d.l;
  if ('r' in d) p.r = !!d.r;
});
socket.on('input', ({ slot, d }) => {
  if (!d || !G.scene) return;
  if (d.t === 'quit') { if (G.sceneName !== 'menu') setScene('menu', Menu); return; }
  if (G.scene.onInput) G.scene.onInput(slot, d);
});

// ---------------- מקלדת ועכבר במסך ----------------
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && G.sceneName !== 'menu') setScene('menu', Menu);
  if (G.sceneName === 'menu' && /^[1-8]$/.test(e.key)) startGame(GAMES[+e.key - 1].id);
  if (G.sceneName === 'menu' && (e.key === 't' || e.key === 'T' || e.key === 'א')) startTour();
  if (G.sceneName === 'results' && (e.key === 'Enter' || e.key === ' ')) Results.advance();
});
cv.addEventListener('pointerdown', (e) => {
  const x = (e.clientX * (cv.width / innerWidth) - OX) / S, y = (e.clientY * (cv.height / innerHeight) - OY) / S;
  const inR = (c) => x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h;
  if (G.sceneName === 'menu') { GAMES.forEach((g, i) => { if (inR(cardRect(i))) startGame(g.id); }); if (inR(TOUR_RECT)) startTour(); }
  else if (G.sceneName === 'results' && Results.t > 0.8) Results.advance();
});

// ============================================================
//  תפריט / לובי
// ============================================================
const GAMES = [
  { id: 'race', name: 'מרוץ', desc: 'הטו את הטלפון כמו הגה', col: '#ffb703' },
  { id: 'box', name: 'אגרוף', desc: 'ג׳אב, הוק, בלוק, נוקאאוט', col: '#ff4d6d' },
  { id: 'hockey', name: 'הוקי אוויר', desc: 'גררו את האצבע ותבקיעו', col: '#2ec5ff' },
  { id: 'soccer', name: 'כדורגל ראשים', desc: 'קפיצות, נגיחות ובעיטות', col: '#6bff8a' },
  { id: 'tanks', name: 'טנקים', desc: 'פגזים שקופצים מהקירות', col: '#a3e635' },
  { id: 'volley', name: 'כדורעף', desc: 'קפיצות והנחתות מעל הרשת', col: '#facc15' },
  { id: 'sumo', name: 'סומו', desc: 'דחפו את היריב מהזירה', col: '#fb923c' },
  { id: 'bomb', name: 'פצצה חמה', desc: 'תעבירו לפני שהיא מתפוצצת', col: '#f87171' },
];
const gameName = (id) => (GAMES.find((g) => g.id === id) || {}).name || '';
function cardRect(i) {
  const w = 232, h = 205, gx = 18, gy = 18, col = i % 4, row = Math.floor(i / 4);
  return { x: 60 + (3 - col) * (w + gx), y: 318 + row * (h + gy), w, h };
}
const TOUR_RECT = { x: 60, y: 768, w: 982, h: 66 };
function startGame(id) {
  const map = { race: Race, box: Box, hockey: Hockey, soccer: Soccer, tanks: Tanks, volley: Volley, sumo: Sumo, bomb: Bomb };
  if (id === 'tour') return startTour();
  if (map[id]) setScene(id, map[id]);
}
function startTour() {
  const ids = GAMES.map((g) => g.id).sort(() => Math.random() - 0.5).slice(0, 5);
  G.tour = { list: ids, k: 0, pts: [0, 0] };
  startGame(ids[0]);
}
function drawIcon(id, cx, cy, k = 1) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
  if (id === 'race') {
    ctx.rotate(-0.25);
    ctx.fillStyle = '#111'; [[-34, -26], [14, -26], [-34, 18], [14, 18]].forEach(([x, y]) => { rr(x, y, 22, 9, 3); ctx.fill(); });
    rr(-44, -20, 88, 40, 14); ctx.fillStyle = '#ffb703'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(-44, -4, 88, 8);
    rr(-10, -15, 28, 30, 6); ctx.fillStyle = '#7a4b00'; ctx.fill();
    rr(10, -13, 12, 26, 4); ctx.fillStyle = '#bfe9ff'; ctx.fill();
  } else if (id === 'box') {
    ctx.rotate(-0.4);
    rr(-22, 26, 44, 30, 8); ctx.fillStyle = '#f1f1f1'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 44, 40, 0, 0, Math.PI * 2); ctx.fillStyle = '#ff4d6d'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-34, 6, 18, 22, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-12, -14, 18, 12, -0.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
  } else if (id === 'hockey') {
    ctx.beginPath(); ctx.ellipse(-26, 18, 34, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#20243f'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-26, 12, 34, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#3a3f66'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -4, 38, 22, 0, 0, Math.PI * 2); ctx.fillStyle = '#0b6a96'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -10, 38, 22, 0, 0, Math.PI * 2); ctx.fillStyle = '#2ec5ff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -22, 16, 12, 0, 0, Math.PI * 2); ctx.fillStyle = '#e8f8ff'; ctx.fill();
  } else if (id === 'soccer') {
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#1b1f3b';
    polygon(0, 0, 14, 5, -Math.PI / 2); ctx.fill();
    for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + j * Math.PI * 2 / 5; polygon(Math.cos(a) * 36, Math.sin(a) * 36, 12, 5, a + Math.PI / 2); ctx.fill(); }
    ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke();
  } else if (id === 'tanks') {
    ctx.rotate(-0.35);
    ctx.fillStyle = '#1d1f1a'; rr(-42, -36, 84, 18, 6); ctx.fill(); rr(-42, 18, 84, 18, 6); ctx.fill();
    rr(-34, -24, 68, 48, 10); ctx.fillStyle = '#a3e635'; ctx.fill();
    rr(8, -7, 52, 14, 4); ctx.fillStyle = '#4d7c0f'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'volley') {
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.ellipse(-22, 0, 22, 48, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.ellipse(26, -10, 18, 44, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke();
  } else if (id === 'sumo') {
    ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fillStyle = '#ead7a8'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = '#bfa064'; ctx.stroke();
    ctx.beginPath(); ctx.arc(-16, 4, 17, 0, Math.PI * 2); ctx.fillStyle = PC[0]; ctx.fill();
    ctx.beginPath(); ctx.arc(17, -4, 17, 0, Math.PI * 2); ctx.fillStyle = PC[1]; ctx.fill();
  } else if (id === 'bomb') {
    ctx.beginPath(); ctx.arc(0, 8, 38, 0, Math.PI * 2); ctx.fillStyle = '#1b1b24'; ctx.fill();
    ctx.beginPath(); ctx.arc(-12, -4, 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
    ctx.fillStyle = '#555'; ctx.fillRect(-9, -38, 18, 12);
    ctx.strokeStyle = '#c9a46b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -38); ctx.quadraticCurveTo(14, -52, 24, -48); ctx.stroke();
    ctx.fillStyle = GOLD; star(26, -48, 14, 5, 6); ctx.fill();
  }
  ctx.restore();
}
function polygon(x, y, r, n, rot = 0) { ctx.beginPath(); for (let j = 0; j < n; j++) { const a = rot + j * Math.PI * 2 / n; j ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
function star(x, y, r1, r2, n) { ctx.beginPath(); for (let j = 0; j < n * 2; j++) { const a = -Math.PI / 2 + j * Math.PI / n, r = j % 2 ? r2 : r1; j ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }

const Menu = {
  enter() { this.t = 0; G.tour = null; },
  update(dt) { this.t += dt; },
  onInput(slot, d) { if (d.t === 'menu') startGame(d.g); },
  draw() {
    bgGrad('#14183a', '#07081a');
    for (let i = 0; i < 9; i++) {
      const x = (i * 211 + this.t * (12 + i * 3)) % (VW + 300) - 150, y = 120 + ((i * 137) % 700);
      ctx.beginPath(); ctx.arc(x, y, 60 + (i % 3) * 40, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? 'rgba(255,77,109,.05)' : 'rgba(46,197,255,.05)'; ctx.fill();
    }
    const tg = ctx.createLinearGradient(600, 0, 1000, 0); tg.addColorStop(0, PC[1]); tg.addColorStop(1, PC[0]);
    txt('זירה', VW / 2, 74, 100, tg, 'center', 900);
    txt('המסך הוא הזירה · הטלפונים הם השלטים · שמונה משחקים', VW / 2, 140, 26, '#a9afd8', 'center', 600);

    // שחקנים
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 560 : 60, y = 180, w = 482, h = 112, pl = G.players[i], on = !!pl;
      panel(x, y, w, h, 20, on ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.25)', on ? PC[i] : 'rgba(255,255,255,.1)');
      ctx.beginPath(); ctx.arc(x + w - 58, y + h / 2, 34, 0, Math.PI * 2);
      ctx.fillStyle = on ? PC[i] : 'rgba(255,255,255,.08)'; ctx.fill();
      txt(String(i + 1), x + w - 58, y + h / 2 + 2, 34, on ? '#fff' : 'rgba(255,255,255,.3)', 'center', 900);
      if (on) {
        txt(pname(i), x + w - 110, y + 40, 32, '#fff', 'right', 800);
        txt(pl.away ? 'מתחבר מחדש…' : `ניצחונות: ${G.wins[i]}`, x + w - 110, y + 80, 20, pl.away ? GOLD : '#a9afd8', 'right', 600);
      } else {
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(this.t * 3 + i); txt('ממתין לשחקן…', x + w - 110, y + 40, 28, '#fff', 'right', 700); ctx.globalAlpha = 1;
        txt('בינתיים המחשב ישחק', x + w - 110, y + 80, 19, '#7d84b3', 'right', 600);
      }
    }
    // משחקים
    GAMES.forEach((g, i) => {
      const c = cardRect(i), bob = Math.sin(this.t * 2 + i * 0.8) * 3;
      panel(c.x, c.y + bob, c.w, c.h, 22, 'rgba(255,255,255,.06)', g.col);
      txt(String(i + 1), c.x + c.w - 22, c.y + 24 + bob, 18, g.col, 'center', 900);
      drawIcon(g.id, c.x + c.w / 2, c.y + 74 + bob, 0.82);
      txt(g.name, c.x + c.w / 2, c.y + 148 + bob, 30, '#fff', 'center', 900);
      txt(g.desc, c.x + c.w / 2, c.y + 182 + bob, 16, '#a9afd8', 'center', 600);
    });
    const T = TOUR_RECT, glow = 0.5 + 0.5 * Math.sin(this.t * 3);
    panel(T.x, T.y, T.w, T.h, 20, `rgba(255,214,10,${0.08 + glow * 0.06})`, GOLD);
    txt('טורניר · 5 משחקים אקראיים ברצף · מי שמנצח ביותר משחקים הוא האלוף', T.x + T.w / 2, T.y + T.h / 2, 24, GOLD, 'center', 800);
    txt('בחרו בטלפון, או לחצו על כרטיס', 551, 862, 20, '#7d84b3', 'center', 600);

    // הצטרפות
    panel(1080, 180, 460, 654);
    txt('הצטרפו מהטלפון', 1310, 222, 32, '#fff', 'center', 900);
    rr(1195, 256, 230, 230, 18); ctx.fillStyle = '#fff'; ctx.fill();
    if (qrImg.complete && qrImg.naturalWidth) ctx.drawImage(qrImg, 1203, 264, 214, 214);
    txt('סרקו, או היכנסו לכתובת:', 1310, 518, 20, '#a9afd8', 'center', 600);
    txt(location.host + '/play', 1310, 550, location.host.length > 22 ? 20 : 24, '#fff', 'center', 700);
    txt('קוד החדר', 1310, 600, 20, '#a9afd8', 'center', 600);
    const code = G.code || '····';
    for (let i = 0; i < 4; i++) {
      const x = 1310 + (i - 1.5) * 84;
      rr(x - 35, 622, 70, 64, 14); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
      txt(code[i], x, 656, 46, GOLD, 'center', 900);
    }
    txt('עד 2 שחקנים', 1310, 736, 22, '#c9cdf0', 'center', 700);
    txt('לבד? המחשב משחק נגדכם', 1310, 770, 20, '#7d84b3', 'center', 600);
  },
};

// ============================================================
//  תוצאות
// ============================================================
const Results = {
  enter() { this.t = 0; },
  update(dt) {
    this.t += dt;
    const w = this.final ? this.champ : this.w;
    if (w >= 0 && Math.random() < (this.final ? 0.9 : 0.6)) parts.push({ x: rnd(0, VW), y: -10, vx: rnd(-60, 60), vy: rnd(150, 320), g: 120, life: 4, max: 4, col: Math.random() < 0.5 ? PC[w] : GOLD, size: rnd(4, 8) });
    if (this.t > (this.final ? 20 : 15)) this.advance();
  },
  advance() {
    if (G.tour && !this.final) startGame(G.tour.list[G.tour.k]);
    else setScene('menu', Menu);
  },
  onInput(slot, d) {
    if (this.t < 0.8) return;
    if (d.t === 'again') { if (G.tour) this.advance(); else startGame(this.game); }
    else if (d.t === 'next') this.advance();
    else if (d.t === 'menu' && !G.tour) startGame(d.g);
  },
  draw() {
    bgGrad('#14183a', '#07081a');
    const w = this.final ? this.champ : this.w;
    const col = w >= 0 ? PC[w] : '#fff';
    const pop = 1 + Math.max(0, 0.4 - this.t) * 1.5;
    ctx.save(); ctx.translate(VW / 2, 250); ctx.scale(pop * (this.final ? 1.25 : 1), pop * (this.final ? 1.25 : 1));
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.moveTo(-80, -90); ctx.lineTo(80, -90); ctx.quadraticCurveTo(76, 20, 0, 40); ctx.quadraticCurveTo(-76, 20, -80, -90); ctx.fill();
    ctx.lineWidth = 14; ctx.strokeStyle = GOLD;
    ctx.beginPath(); ctx.arc(-84, -50, 34, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(84, -50, 34, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.fillRect(-14, 38, 28, 40); rr(-60, 74, 120, 26, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-36, -50, 12, 30, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (this.final) {
      txt('סוף הטורניר!', VW / 2, 420, 40, GOLD, 'center', 800, 6);
      txt(w >= 0 ? `${pname(w)} אלוף/ת הטורניר!` : 'תיקו בטורניר!', VW / 2, 490, 86 * pop, col, 'center', 900, 10);
      txt(`${this.tour.pts[0]} : ${this.tour.pts[1]}`, VW / 2, 570, 40, '#fff', 'center', 800);
    } else {
      txt(w >= 0 ? `${pname(w)} ניצח/ה!` : 'תיקו!', VW / 2, 450, 90 * pop, col, 'center', 900, 10);
      if (this.sub) txt(this.sub, VW / 2, 528, 30, '#c9cdf0', 'center', 700);
      if (this.tour) txt(`טורניר · אחרי ${this.tour.k} מתוך ${this.tour.n} · ${this.tour.pts[0]} : ${this.tour.pts[1]} · הבא: ${gameName(G.tour.list[G.tour.k])}`, VW / 2, 580, 24, GOLD, 'center', 700);
    }
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? VW / 2 + 40 : VW / 2 - 340;
      panel(x, 630, 300, 104, 22, 'rgba(255,255,255,.06)', PC[i]);
      txt(pname(i), x + 150, 660, 28, PC[i], 'center', 800);
      txt(`${G.wins[i]} ניצחונות`, x + 150, 704, 24, '#fff', 'center', 700);
    }
    txt(this.tour ? (this.final ? 'בטלפון: "לתפריט המשחקים"' : 'בטלפון: "למשחק הבא"') : 'בטלפון: "עוד סיבוב" או "לתפריט"', VW / 2, 800, 24, '#a9afd8', 'center', 600);
  },
};
function showResults(w, sub, game) {
  if (w >= 0) G.wins[w]++;
  let final = false, champ = -1, tour = null;
  if (G.tour) {
    if (w >= 0) G.tour.pts[w]++;
    G.tour.k++;
    final = G.tour.k >= G.tour.list.length;
    const p = G.tour.pts;
    if (final) champ = p[0] === p[1] ? -1 : p[0] > p[1] ? 0 : 1;
    tour = { k: G.tour.k, n: G.tour.list.length, pts: p.slice() };
  }
  Object.assign(Results, { w, sub, game, final, champ, tour });
  Results.stateExtra = { w, final, champ, tour, next: tour && !final ? gameName(G.tour.list[G.tour.k]) : '' };
  SFX.win();
  setScene('results', Results);
}

// ============================================================
//  משחק 1: מרוץ
// ============================================================
const LAPS = 4;
const TRACK = { pts: null, N: 0, hw: 60, path: null, trees: [], stands: [] };
function buildTrack() {
  const C = [[230, 470], [270, 230], [470, 140], [700, 220], [930, 140], [1200, 120], [1400, 220], [1430, 450],
    [1300, 600], [1070, 570], [870, 680], [630, 790], [410, 775], [260, 680]];
  const raw = [], n = C.length;
  for (let i = 0; i < n; i++) {
    const p0 = C[(i - 1 + n) % n], p1 = C[i], p2 = C[(i + 1) % n], p3 = C[(i + 2) % n];
    for (let s = 0; s < 30; s++) {
      const t = s / 30, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const SP = 8, pts = [raw[0]];
  let acc = 0;
  for (let i = 1; i <= raw.length; i++) {
    let a = raw[i - 1]; const b = raw[i % raw.length];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + seg >= SP) {
      const t = (SP - acc) / seg, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      pts.push(p); a = p; seg = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0;
    }
    acc += seg;
  }
  if (Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < SP * 0.6) pts.pop();
  TRACK.pts = pts; TRACK.N = pts.length;
  const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (const q of pts) p.lineTo(q[0], q[1]); p.closePath();
  TRACK.path = p;
  const R = seeded(7);
  const minD = (x, y) => { let m = 1e9; for (let i = 0; i < pts.length; i += 2) m = Math.min(m, Math.hypot(pts[i][0] - x, pts[i][1] - y)); return m; };
  for (let k = 0; k < 400 && TRACK.trees.length < 46; k++) {
    const x = 30 + R() * (VW - 60), y = 110 + R() * (VH - 140);
    if (minD(x, y) > TRACK.hw + 50) TRACK.trees.push([x, y, 16 + R() * 14, R()]);
  }
}
function nearest(x, y, hint) {
  const N = TRACK.N; let best = 1e12, bi = hint;
  for (let k = -40; k <= 40; k++) {
    const i = (hint + k + N) % N, p = TRACK.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  if (best > (TRACK.hw * 3) ** 2) {
    for (let i = 0; i < N; i++) { const p = TRACK.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < best) { best = d; bi = i; } }
  }
  return [bi, Math.sqrt(best)];
}
function mkCar(i) {
  const N = TRACK.N, idx = N - 9, p = TRACK.pts[idx], q = TRACK.pts[(idx + 1) % N];
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]), nx = -Math.sin(a), ny = Math.cos(a), off = i === 0 ? -24 : 24;
  return { i, x: p[0] + nx * off, y: p[1] + ny * off, a, v: 0, idx, prog: -9, lap: 0, done: false, time: 0, off: false, bump: 0, boost: 0.6, boostT: 0, sentB: -1 };
}
function raceAI(c) {
  const N = TRACK.N, look = Math.round(10 + Math.abs(c.v) / 35), t = TRACK.pts[(c.idx + look) % N], t2 = TRACK.pts[(c.idx + look + 1) % N];
  const ta = Math.atan2(t2[1] - t[1], t2[0] - t[0]), lane = c.i ? 22 : -22, tx = t[0] - Math.sin(ta) * lane, ty = t[1] + Math.cos(ta) * lane;
  const want = Math.atan2(ty - c.y, tx - c.x), diff = wrapAng(want - c.a);
  return [clamp(diff * (c.i ? 2.2 : 2.6), -1, 1), c.v < (c.i ? 455 : 480), Math.abs(diff) > 0.85 && c.v > 300];
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const Race = {
  enter() {
    if (!TRACK.pts) buildTrack();
    this.cars = [mkCar(0), mkCar(1)]; this.state = 'count'; this.count = 3.6; this.lastBeep = 4;
    this.raceT = 0; this.finish = []; this.endT = 0; this.goT = 0; this.skids = [];
  },
  onInput(slot, d) { if (d.t === 'boost') this.useBoost(this.cars[slot]); },
  useBoost(c) {
    if (!c || this.state === 'count' || c.done || c.boost < 1) return;
    c.boost = 0; c.boostT = 1.4; tone(260, 0.6, 'sawtooth', 0.06, 600); toPlayer(c.i, 'vibe', [30, 30, 30]);
    floatText('טורבו!', c.x, c.y - 50, GOLD, 34);
  },
  update(dt) {
    if (this.state === 'count') {
      this.count -= dt; const c = Math.ceil(this.count);
      if (c < this.lastBeep && c > 0) { this.lastBeep = c; SFX.beep(); }
      if (this.count <= 0) { this.state = 'go'; this.goT = 0.9; SFX.go(); }
    }
    const racing = this.state !== 'count';
    if (racing) this.raceT += dt;
    this.goT = Math.max(0, this.goT - dt);
    const N = TRACK.N;
    for (const c of this.cars) {
      let steer, gas, brake;
      if (isBot(c.i)) [steer, gas, brake] = raceAI(c);
      else { const p = inp[c.i]; steer = p.steer; gas = p.gas; brake = p.brake; }
      if (c.done) { gas = false; brake = true; }
      if (!racing) { gas = false; brake = false; steer = 0; }
      if (racing && !c.done) c.boost = Math.min(1, c.boost + dt / 8);
      if (isBot(c.i) && c.boost >= 1 && Math.abs(steer) < 0.15 && c.v > 300) this.useBoost(c);
      c.boostT = Math.max(0, c.boostT - dt);
      const bq = Math.floor(c.boost * 10); if (bq !== c.sentB) { c.sentB = bq; toPlayer(c.i, 'boost', { v: c.boost }); }
      const max = c.off ? 220 : c.boostT > 0 ? 780 : 540;
      if (gas) c.v += 470 * dt;
      if (c.boostT > 0) { c.v += 900 * dt; for (let k = 0; k < 2; k++) parts.push({ x: c.x - Math.cos(c.a) * 26, y: c.y - Math.sin(c.a) * 26, vx: -Math.cos(c.a) * 200 + rnd(-40, 40), vy: -Math.sin(c.a) * 200 + rnd(-40, 40), life: 0.3, max: 0.3, col: Math.random() < 0.5 ? '#ffb703' : '#ff5e3a', size: rnd(4, 8), g: 0 }); }
      if (brake) { if (c.v > 20) c.v -= 950 * dt; else if (!c.done) c.v = Math.max(-150, c.v - 300 * dt); else c.v = 0; }
      c.v -= c.v * (c.off ? 1.8 : 0.42) * dt;
      if (c.v > max) c.v = lerp(c.v, max, 4 * dt);
      const grip = clamp(Math.abs(c.v) / 150, 0, 1) * (c.v < 0 ? -1 : 1);
      c.a += steer * 2.8 * grip * dt;
      c.x += Math.cos(c.a) * c.v * dt; c.y += Math.sin(c.a) * c.v * dt;
      c.x = clamp(c.x, 20, VW - 20); c.y = clamp(c.y, 110, VH - 20);
      const [ni, d] = nearest(c.x, c.y, c.idx);
      let di = ni - c.idx; if (di > N / 2) di -= N; if (di < -N / 2) di += N;
      c.prog += di; c.idx = ni; c.off = d > TRACK.hw;
      if (c.off && Math.abs(c.v) > 90 && Math.random() < 0.6)
        parts.push({ x: c.x - Math.cos(c.a) * 20, y: c.y - Math.sin(c.a) * 20, vx: rnd(-40, 40), vy: rnd(-40, 40), life: 0.6, max: 0.6, col: 'rgba(120,90,40,.55)', size: rnd(5, 10), g: 0 });
      if (!c.off && Math.abs(steer) > 0.8 && c.v > 380 && Math.random() < 0.5) this.skids.push([c.x, c.y, 1.4]);
      const lap = Math.floor(c.prog / N);
      if (!c.done && lap > c.lap && lap < LAPS) {
        c.lap = lap; floatText(lap === LAPS - 1 ? 'הקפה אחרונה!' : `הקפה ${lap + 1}`, c.x, c.y - 50, PC[c.i], 36); SFX.beep(); toPlayer(c.i, 'vibe', 60);
      }
      if (!c.done && c.prog >= LAPS * N) {
        c.done = true; c.time = this.raceT; this.finish.push(c.i);
        burst(c.x, c.y, PC[c.i], 40, 450, 7, 0.9); toPlayer(c.i, 'vibe', [150, 80, 150]);
        if (this.finish.length === 1) { this.state = 'finish'; this.endT = 0; SFX.goal(); }
      }
    }
    for (const s of this.skids) s[2] -= dt;
    this.skids = this.skids.filter((s) => s[2] > 0);
    // התנגשות בין המכוניות
    const A = this.cars[0], B = this.cars[1], dx = B.x - A.x, dy = B.y - A.y, dd = Math.hypot(dx, dy);
    if (dd < 40 && dd > 0.01) {
      const push = (40 - dd) / 2, nx = dx / dd, ny = dy / dd;
      A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
      if (Math.abs(A.v - B.v) > 60 || Math.max(A.v, B.v) > 250) {
        if (A.bump <= 0) { SFX.bump(); G.shake = Math.max(G.shake, 7); burst((A.x + B.x) / 2, (A.y + B.y) / 2, GOLD, 10, 250, 4, 0.35); toPlayer(0, 'vibe', 40); toPlayer(1, 'vibe', 40); }
        A.bump = B.bump = 0.4;
      }
      A.v -= A.v * 0.6 * (1 / 120); B.v -= B.v * 0.6 * (1 / 120);
    }
    A.bump -= dt; B.bump -= dt;
    if (this.state === 'finish') {
      this.endT += dt;
      if (this.finish.length === 2 || this.endT > 8) {
        const w = this.finish[0], loser = this.cars[1 - w];
        const sub = loser.done ? `${fmtTime(this.cars[w].time)} · פער של ${(loser.time - this.cars[w].time).toFixed(2)} שניות` : `זמן: ${fmtTime(this.cars[w].time)}`;
        showResults(w, sub, 'race');
      }
    }
  },
  position(i) {
    const a = this.cars[i], b = this.cars[1 - i];
    if (a.done && b.done) return this.finish.indexOf(i) + 1;
    if (a.done) return 1; if (b.done) return 2;
    return a.prog >= b.prog ? 1 : 2;
  },
  draw() {
    ctx.fillStyle = '#2f7d3a'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#2b7335'; for (let x = 0; x < VW; x += 100) ctx.fillRect(x, 0, 50, VH);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = TRACK.hw * 2 + 34; ctx.stroke(TRACK.path);
    ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = TRACK.hw * 2 + 18; ctx.stroke(TRACK.path);
    ctx.lineCap = 'butt'; ctx.setLineDash([22, 22]); ctx.strokeStyle = '#e63946'; ctx.stroke(TRACK.path); ctx.setLineDash([]); ctx.lineCap = 'round';
    ctx.strokeStyle = '#3b3f4f'; ctx.lineWidth = TRACK.hw * 2; ctx.stroke(TRACK.path);
    ctx.lineCap = 'butt'; ctx.setLineDash([26, 30]); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 4; ctx.stroke(TRACK.path); ctx.setLineDash([]); ctx.lineCap = 'round';
    // קו זינוק
    { const p = TRACK.pts[0], q = TRACK.pts[1], a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
      const sq = 10, rows = Math.ceil((TRACK.hw * 2) / sq);
      for (let r = 0; r < rows; r++) for (let k = 0; k < 2; k++) { ctx.fillStyle = (r + k) % 2 ? '#111' : '#fff'; ctx.fillRect(-sq + k * sq, -TRACK.hw + r * sq, sq, sq); }
      ctx.restore(); }
    for (const s of this.skids) { ctx.globalAlpha = s[2] / 1.4 * 0.35; ctx.fillStyle = '#111'; ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6); }
    ctx.globalAlpha = 1;
    // עצים
    for (const [x, y, r, k] of TRACK.trees) {
      ctx.beginPath(); ctx.arc(x + 5, y + 6, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = k > 0.5 ? '#1f5e2a' : '#246b30'; ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
    }
    for (const c of this.cars) drawCar(c);
    drawFx();
    // HUD
    for (let i = 0; i < 2; i++) {
      const c = this.cars[i], x = i === 0 ? 24 : VW - 344, pos = this.position(i);
      panel(x, 18, 320, 76, 38, 'rgba(10,12,30,.78)', PC[i]);
      ctx.beginPath(); ctx.arc(x + 282, 56, 26, 0, Math.PI * 2); ctx.fillStyle = PC[i]; ctx.fill();
      txt(String(pos), x + 282, 58, 30, '#fff', 'center', 900);
      txt(pname(i), x + 240, 42, 24, '#fff', 'right', 800);
      const lapShow = c.done ? 'סיים!' : `הקפה ${clamp(Math.floor(c.prog / TRACK.N) + 1, 1, LAPS)}/${LAPS}`;
      txt(lapShow, x + 240, 74, 20, '#c9cdf0', 'right', 600);
      bar(x + 24, 62, 110, 9, Math.max(0, c.v) / 780, PC[i]);
      bar(x + 24, 76, 110, 6, c.boost, c.boost >= 1 ? GOLD : 'rgba(255,214,10,.5)');
      txt(`${Math.round(Math.max(0, c.v) / 3)} קמ״ש`, x + 79, 42, 18, '#c9cdf0', 'center', 700);
    }
    if (this.raceT > 0) txt(fmtTime(this.raceT), VW / 2, 50, 30, '#fff', 'center', 800, 6);
    if (this.state === 'count') {
      const c = Math.ceil(this.count), f = this.count - Math.floor(this.count);
      if (c <= 3) txt(String(c), VW / 2, VH / 2, 200 * (0.8 + f * 0.4), GOLD, 'center', 900, 16);
      else txt('היכונו…', VW / 2, VH / 2, 110, '#fff', 'center', 900, 14);
      txt('הטו את הטלפון כדי לנווט · "גז" לנסיעה · "טורבו" כשהוא מלא', VW / 2, VH / 2 + 150, 30, '#fff', 'center', 700, 8);
    }
    if (this.goT > 0) { ctx.globalAlpha = Math.min(1, this.goT * 2); txt('סעו!', VW / 2, VH / 2, 220, '#6bff8a', 'center', 900, 16); ctx.globalAlpha = 1; }
    if (this.state === 'finish') txt(`${pname(this.finish[0])} חצה ראשון!`, VW / 2, VH / 2, 90, PC[this.finish[0]], 'center', 900, 12);
    codeBadge();
  },
};
function drawCar(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  rr(-22, -10, 48, 26, 9); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  ctx.fillStyle = '#111'; [[-19, -16], [8, -16], [-19, 11], [8, 11]].forEach(([x, y]) => { rr(x, y, 13, 5, 2); ctx.fill(); });
  rr(-25, -13, 50, 26, 9); ctx.fillStyle = PC[c.i]; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-25, -2.5, 50, 5);
  rr(-8, -10, 18, 20, 5); ctx.fillStyle = PC_DARK[c.i]; ctx.fill();
  rr(5, -9, 8, 18, 3); ctx.fillStyle = '#c4ecff'; ctx.fill();
  ctx.fillStyle = '#fff6b0'; ctx.fillRect(21, -10, 4, 5); ctx.fillRect(21, 5, 4, 5);
  ctx.restore();
  txt(pname(c.i), c.x, c.y - 30, 16, '#fff', 'center', 800, 4);
}

// ============================================================
//  משחק 2: אגרוף
// ============================================================
const MOVES = {
  jab: { w: 0.09, h: 0.13, e: 0.32, dmg: 6, sta: 9 },
  hook: { w: 0.30, h: 0.35, e: 0.62, dmg: 14, sta: 20 },
  super: { w: 0.36, h: 0.44, e: 0.85, dmg: 26, sta: 0 },
};
const FIGHT_TIME = 90;
const crowd = (() => { const R = seeded(3), a = []; for (let row = 0; row < 4; row++) for (let i = 0; i < 34; i++) a.push([i * 49 + (row % 2) * 24 + R() * 10, 330 + row * 46, 20 + R() * 6, R() * 6, R()]); return a; })();
const Box = {
  enter() {
    this.b = [0, 1].map((i) => ({ i, x: i ? 905 : 695, dir: i ? -1 : 1, hp: 100, shownHp: 100, sta: 100, meter: 0, act: 'idle', t: 0, did: false, blk: false, dodgeCd: 0, hitT: 0, flash: 0, ai: { t: 1.2, blk: 0, reacted: false }, landed: 0, thrown: 0, last: [] }));
    this.time = FIGHT_TIME; this.state = 'intro'; this.it = 2.4; this.endT = 0; this.winner = -1; this.reason = ''; this.t = 0;
    this.sent = [null, null];
  },
  onInput(slot, d) {
    const b = this.b[slot]; if (!b) return;
    if (d.t === 'block') { b.blk = !!d.v; return; }
    if (this.state === 'fight') this.act(b, d.t);
  },
  act(b, m) {
    if (b.act !== 'idle' || b.hitT > 0) return;
    if (m === 'dodge') {
      if (b.dodgeCd > 0 || b.sta < 12) return;
      b.sta -= 12; b.act = 'dodge'; b.t = 0; b.dodgeCd = 0.75; SFX.whoosh(); return;
    }
    const mv = MOVES[m]; if (!mv) return;
    if (m === 'super') { if (b.meter < 100) return; b.meter = 0; floatText('סופר!', b.x, 250, GOLD, 64); tone(200, 0.45, 'sawtooth', 0.06, 600); }
    else if (b.sta < mv.sta) { floatText('אין כוח!', b.x, 270, '#9aa1c9', 28); return; }
    b.sta -= mv.sta; b.act = m; b.t = 0; b.did = false; b.thrown++;
    if (m !== 'super') SFX.whoosh();
  },
  ai(b, o, dt) {
    const A = b.ai; A.t -= dt;
    const oMv = MOVES[o.act];
    if (oMv && !A.reacted) {
      A.reacted = true; const r = Math.random();
      if (o.act !== 'jab' && r < 0.35) this.act(b, 'dodge');
      else if (r < 0.55) { b.blk = true; A.blk = 0.55; }
    }
    if (!oMv) A.reacted = false;
    if (A.blk > 0) { A.blk -= dt; if (A.blk <= 0) b.blk = false; }
    if (A.t <= 0) {
      A.t = rnd(0.5, 1.15);
      if (b.meter >= 100) this.act(b, 'super');
      else { const r = Math.random(); if (r < 0.55) this.act(b, 'jab'); else if (r < 0.8) this.act(b, 'hook'); else { b.blk = true; A.blk = rnd(0.4, 0.9); } }
    }
  },
  resolve(a, o, m, mv) {
    if (this.state !== 'fight') return;
    const hx = o.x - o.dir * 6, hy = m === 'super' ? 330 : 350;
    if (o.act === 'dodge' && o.t > 0.03 && o.t < 0.4) {
      floatText('התחמקות!', o.x, 280, '#bde0fe', 34); tone(500, 0.08, 'sine', 0.05, -200);
      o.sta = Math.min(100, o.sta + 10); o.meter = Math.min(100, o.meter + 6); return;
    }
    let dmg = mv.dmg, counter = false;
    const oMv = MOVES[o.act];
    if (oMv && !o.did && o.t < oMv.h) { dmg *= 1.5; counter = true; o.act = 'idle'; o.t = 0; }
    const blocking = o.blk && o.act === 'idle' && o.hitT <= 0;
    if (blocking && !counter) {
      if (m !== 'super') {
        o.hp = Math.max(0, o.hp - dmg * 0.15); o.sta = Math.max(0, o.sta - 8);
        a.meter = Math.min(100, a.meter + 3); o.meter = Math.min(100, o.meter + 4);
        SFX.block(); burst(hx, hy, '#cfd8ff', 8, 220, 5, 0.3); floatText('בלוק', o.x, 280, '#cfd8ff', 28);
        toPlayer(o.i, 'vibe', 20); this.checkKO(a, o); return;
      }
      dmg *= 0.5;
    }
    o.hp = Math.max(0, o.hp - dmg); o.hitT = m === 'jab' ? 0.22 : 0.4; o.flash = 0.15;
    if (o.act !== 'ko') { o.act = 'idle'; o.t = 0; }
    a.meter = Math.min(100, a.meter + dmg * 2.2); o.meter = Math.min(100, o.meter + dmg * 0.8); a.landed++;
    const big = m !== 'jab';
    big ? SFX.bighit() : SFX.hit();
    G.shake = Math.max(G.shake, m === 'jab' ? 6 : m === 'hook' ? 13 : 24);
    burst(hx, hy, '#fff', m === 'super' ? 40 : 16, m === 'super' ? 600 : 350, 6, 0.45);
    burst(hx, hy, PC[a.i], m === 'super' ? 24 : 8, 300, 5, 0.4);
    floatText(counter ? 'קאונטר!' : `-${Math.round(dmg)}`, o.x, counter ? 240 : 270, counter ? GOLD : '#fff', counter ? 46 : 34);
    if (m === 'super') G.slowT = 0.45;
    toPlayer(o.i, 'vibe', m === 'jab' ? 40 : m === 'hook' ? 90 : [120, 60, 180]);
    this.checkKO(a, o);
  },
  checkKO(a, o) {
    if (o.hp <= 0 && this.state === 'fight') {
      o.hp = 0; o.act = 'ko'; o.t = 0; this.state = 'ko'; this.endT = 0; this.winner = a.i; this.reason = 'נוקאאוט!';
      G.slowT = 1.3; floatText('נוקאאוט!', VW / 2, 230, GOLD, 120); toPlayer(o.i, 'vibe', [300, 100, 300]);
    }
  },
  update(dt) {
    this.t += dt;
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'fight'; SFX.go(); tone(660, 0.6, 'triangle', 0.08); } }
    else if (this.state === 'fight') {
      this.time -= dt;
      if (this.time <= 0) {
        this.time = 0; const [p, q] = this.b; this.state = 'ko'; this.endT = 0; this.reason = 'הכרעת שופטים';
        this.winner = Math.abs(p.hp - q.hp) < 0.5 ? -1 : p.hp > q.hp ? 0 : 1; tone(300, 0.8, 'sawtooth', 0.06);
      }
    }
    for (const b of this.b) {
      const o = this.b[1 - b.i];
      b.shownHp = lerp(b.shownHp, b.hp, 3 * dt);
      if (isBot(b.i) && this.state === 'fight') this.ai(b, o, dt);
      b.dodgeCd = Math.max(0, b.dodgeCd - dt); b.hitT = Math.max(0, b.hitT - dt); b.flash = Math.max(0, b.flash - dt);
      if (b.act === 'ko') { b.t += dt; continue; }
      if (b.act === 'idle' && b.hitT <= 0) b.sta = Math.min(100, b.sta + (b.blk ? 9 : 24) * dt);
      if (b.act !== 'idle') {
        b.t += dt; const mv = MOVES[b.act];
        if (mv) { if (!b.did && b.t >= mv.h) { b.did = true; this.resolve(b, o, b.act, mv); } if (b.t >= mv.e && b.act !== 'ko') { b.act = 'idle'; b.t = 0; } }
        else if (b.act === 'dodge' && b.t >= 0.45) { b.act = 'idle'; b.t = 0; }
      }
      const snap = [Math.floor(b.meter / 5), Math.floor(b.sta / 10)].join();
      if (snap !== this.sent[b.i]) { this.sent[b.i] = snap; toPlayer(b.i, 'meter', { v: Math.round(b.meter), sta: Math.round(b.sta) }); }
    }
    if (this.state === 'ko') {
      this.endT += dt;
      if (this.endT > 2.8) {
        const w = this.winner, sub = w >= 0 ? `${this.reason} · ${this.b[w].landed} מכות שנחתו` : 'אותה כמות חיים בדיוק!';
        showResults(w, sub, 'box');
      }
    }
  },
  draw() {
    // זירה ורקע
    bgGrad('#1a1030', '#050409');
    for (const [x, y, r, ph, k] of crowd) {
      const bob = Math.sin(this.t * (4 + k * 3) + ph) * (this.state === 'ko' ? 9 : 3);
      ctx.fillStyle = `rgba(${30 + k * 30},${20 + k * 20},${50 + k * 30},1)`;
      ctx.beginPath(); ctx.arc(x, y + bob, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - r * 1.1, y + bob + r * 0.7, r * 2.2, 40);
    }
    // פלאשים של מצלמות
    if (Math.random() < 0.08) { const x = rnd(0, VW), y = rnd(320, 470); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
    // אורות במה
    for (const sx of [500, 1100]) {
      const g = ctx.createRadialGradient(sx, 0, 10, sx, 600, 520);
      g.addColorStop(0, 'rgba(255,240,200,.22)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - 40, 0); ctx.lineTo(sx + 40, 0); ctx.lineTo(sx + 380, 820); ctx.lineTo(sx - 380, 820); ctx.fill();
    }
    // רצפת הזירה
    ctx.fillStyle = '#2b2f5c'; ctx.beginPath(); ctx.moveTo(130, 600); ctx.lineTo(1470, 600); ctx.lineTo(1580, 840); ctx.lineTo(20, 840); ctx.fill();
    ctx.fillStyle = '#3a3f7a'; ctx.beginPath(); ctx.moveTo(150, 605); ctx.lineTo(1450, 605); ctx.lineTo(1540, 800); ctx.lineTo(60, 800); ctx.fill();
    ctx.fillStyle = '#1b1e3d'; ctx.fillRect(20, 840, 1560, 60);
    const fg = ctx.createRadialGradient(800, 700, 20, 800, 700, 500); fg.addColorStop(0, 'rgba(255,255,255,.12)'); fg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = fg; ctx.fillRect(0, 600, VW, 240);
    // חבלים אחוריים
    const ropes = (ys, w) => { for (const [y, c] of ys) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(150, y); ctx.lineTo(1450, y); ctx.stroke(); } };
    ropes([[470, '#c1121f'], [515, '#f1f1f1'], [560, '#1d4ed8']], 7);
    for (const x of [150, 1450]) { rr(x - 14, 440, 28, 170, 8); ctx.fillStyle = '#d6d6e6'; ctx.fill(); }
    // מתאגרפים (צל + גוף)
    for (const b of this.b) { ctx.beginPath(); ctx.ellipse(b.x, 712, 90, 16, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(); }
    const order = this.b[0].act === 'ko' ? [0, 1] : [1, 0];
    for (const k of order) drawBoxer(this.b[k], this.t);
    // חבל קדמי
    ctx.globalAlpha = 0.85; ropes([[640, '#c1121f']], 9); ctx.globalAlpha = 1;
    for (const x of [60, 1540]) { rr(x - 16, 600, 32, 240, 8); ctx.fillStyle = '#e8e8f4'; ctx.fill(); }
    drawFx();
    // HUD
    for (let i = 0; i < 2; i++) {
      const b = this.b[i], left = i === 0, x = left ? 40 : 920, w = 640;
      txt(pname(i), left ? x : x + w, 28, 28, PC[i], left ? 'left' : 'right', 900, 6);
      bar(x, 50, w, 34, b.shownHp / 100, 'rgba(255,255,255,.35)', 'rgba(0,0,0,.6)', left);
      bar(x, 50, w, 34, b.hp / 100, b.hp > 30 ? PC[i] : '#ff2a2a', 'rgba(0,0,0,0)', left);
      rr(x, 50, w, 34, 17); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
      bar(left ? x + w - 300 : x, 92, 300, 10, b.sta / 100, '#6bff8a', 'rgba(0,0,0,.55)', left);
      bar(left ? x + w - 300 : x, 108, 300, 10, b.meter / 100, b.meter >= 100 ? (Math.sin(this.t * 12) > 0 ? GOLD : '#fff') : GOLD, 'rgba(0,0,0,.55)', left);
      txt(b.meter >= 100 ? 'סופר מוכן!' : 'כוח · סופר', left ? x + w - 310 : x + 310, 100, 15, b.meter >= 100 ? GOLD : '#9aa1c9', left ? 'right' : 'left', 700);
    }
    ctx.beginPath(); ctx.arc(VW / 2, 70, 50, 0, Math.PI * 2); ctx.fillStyle = 'rgba(10,10,25,.9)'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = this.time < 10 ? '#ff2a2a' : GOLD; ctx.stroke();
    txt(String(Math.ceil(this.time)), VW / 2, 72, 44, '#fff', 'center', 900);
    if (this.state === 'intro') {
      const k = this.it > 1.2 ? 'מוכנים?' : 'קרב!';
      txt(k, VW / 2, VH / 2 - 60, 170, k === 'קרב!' ? GOLD : '#fff', 'center', 900, 16);
      txt('ג׳אב מהיר · הוק חזק · בלוק · התחמקות · מלאו את הסופר', VW / 2, VH / 2 + 70, 30, '#fff', 'center', 700, 8);
    }
    if (this.state === 'ko' && this.reason === 'הכרעת שופטים') txt('הזמן נגמר!', VW / 2, VH / 2 - 60, 120, '#fff', 'center', 900, 14);
    codeBadge();
  },
};
function ext(b) {
  const mv = MOVES[b.act]; if (!mv) return 0; const t = b.t;
  if (t < mv.w) return -0.2 * (t / mv.w);
  if (t < mv.h) return lerp(-0.2, 1, (t - mv.w) / (mv.h - mv.w));
  return Math.max(0, 1 - (t - mv.h) / (mv.e - mv.h));
}
function drawBoxer(b, T) {
  const d = b.dir, skin = '#e0a96d', skinD = '#b97f45', col = PC[b.i], colD = PC_DARK[b.i];
  let bx = b.x, lean = 0, drop = 0, rot = 0;
  const bob = b.act === 'ko' ? 0 : Math.sin(T * 7 + b.i * 2) * 4;
  if (b.act === 'dodge') { const k = Math.sin(Math.min(1, b.t / 0.45) * Math.PI); bx -= d * 55 * k; drop = 38 * k; lean = -0.25 * k; }
  if (b.hitT > 0) { const k = b.hitT / 0.4; bx -= d * 18 * k; lean = -0.18 * k; }
  if (b.act === 'ko') { const k = Math.min(1, b.t * 2.2); rot = -d * 1.45 * k; bx -= d * 60 * k; drop = 20 * k; }
  if (MOVES[b.act]) lean = 0.12 * Math.max(0, ext(b));
  ctx.save();
  ctx.translate(bx, 700); ctx.rotate(rot); ctx.translate(0, -700 + drop + bob);
  // רגליים
  ctx.lineCap = 'round'; ctx.strokeStyle = skinD; ctx.lineWidth = 24;
  ctx.beginPath(); ctx.moveTo(-18 * d, 560); ctx.lineTo(-44 * d, 690); ctx.moveTo(18 * d, 560); ctx.lineTo(40 * d, 690); ctx.stroke();
  ctx.fillStyle = '#16162a'; rr(-62 * d - (d < 0 ? 40 : 0), 682, 40, 18, 8); ctx.fill(); rr(26 * d - (d < 0 ? 40 : 0), 682, 40, 18, 8); ctx.fill();
  // גוף נוטה
  ctx.save(); ctx.translate(0, 560); ctx.rotate(lean * d); ctx.translate(0, -560);
  rr(-40, 520, 80, 62, 14); ctx.fillStyle = col; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(-40, 524, 80, 8);
  ctx.beginPath(); ctx.moveTo(-44, 420); ctx.quadraticCurveTo(0, 405, 44, 420); ctx.lineTo(36, 528); ctx.lineTo(-36, 528); ctx.closePath(); ctx.fillStyle = skin; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 440); ctx.lineTo(0, 500); ctx.stroke();
  // ראש
  const hx = 8 * d, hy = 370;
  ctx.beginPath(); ctx.arc(hx, hy, 36, 0, Math.PI * 2); ctx.fillStyle = skin; ctx.fill();
  ctx.beginPath(); ctx.arc(hx - 4 * d, hy - 8, 37, Math.PI * 1.05, Math.PI * 1.95); ctx.fillStyle = '#2a1a10'; ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(hx - 37, hy - 16, 74, 9);
  if (b.act === 'ko') { ctx.strokeStyle = '#111'; ctx.lineWidth = 3; const ex = hx + 16 * d; ctx.beginPath(); ctx.moveTo(ex - 6, hy - 4); ctx.lineTo(ex + 6, hy + 6); ctx.moveTo(ex + 6, hy - 4); ctx.lineTo(ex - 6, hy + 6); ctx.stroke(); }
  else { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx + 18 * d, hy + 2, 4.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#7a3b2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx + 14 * d, hy + 20); ctx.lineTo(hx + 26 * d, hy + (b.hitT > 0 ? 24 : 18)); ctx.stroke();
  if (b.flash > 0) { ctx.globalAlpha = b.flash / 0.15 * 0.7; ctx.beginPath(); ctx.arc(hx, hy, 38, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.globalAlpha = 1; }
  // ידיים
  const shF = [14 * d, 430], shR = [-16 * d, 432];
  let gF = [62 * d, 382], gR = [34 * d, 400];
  const blockingNow = b.blk && b.act === 'idle' && b.hitT <= 0;
  if (blockingNow) { gF = [44 * d, 350]; gR = [30 * d, 382]; }
  if (b.act === 'jab') { const e = ext(b); gF = [lerp(62, 230, e) * d, 382 - 20 * e]; }
  if (b.act === 'hook') { const e = ext(b); gR = [lerp(34, 210, e) * d, 400 - 50 * Math.sin(Math.PI * clamp(e, 0, 1)) - 20 * e]; }
  if (b.act === 'super') { const e = ext(b); gR = [lerp(34, 200, Math.max(0, e)) * d, lerp(470, 330, Math.max(0, e))]; }
  if (b.act === 'ko') { gF = [70 * d, 470]; gR = [-40 * d, 480]; }
  const arm = (s, g, back) => {
    ctx.strokeStyle = back ? skinD : skin; ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(s[0], s[1]);
    ctx.quadraticCurveTo((s[0] + g[0]) / 2, Math.max(s[1], g[1]) + 22, g[0], g[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(g[0], g[1], 27, 0, Math.PI * 2); ctx.fillStyle = back ? colD : col; ctx.fill();
    ctx.beginPath(); ctx.arc(g[0] - 7, g[1] - 9, 9, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    ctx.fillStyle = '#f1f1f1'; ctx.beginPath(); ctx.arc(g[0] - 20 * d, g[1] + 8, 9, 0, Math.PI * 2); ctx.fill();
  };
  arm(shR, gR, true); arm(shF, gF, false);
  if (b.act === 'super' && ext(b) > 0.4) { ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(gR[0], gR[1], 46, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.restore();
  ctx.restore();
  if (b.act === 'ko') for (let k = 0; k < 4; k++) { const a = T * 4 + k * 1.57; txt('★', bx - d * 120 + Math.cos(a) * 46, 640 + Math.sin(a) * 14, 26, GOLD, 'center', 900); }
}

// ============================================================
//  משחק 3: הוקי אוויר
// ============================================================
const RINK = { x0: 120, y0: 110, x1: 1480, y1: 830, gy0: 360, gy1: 580, pr: 22, mr: 42 };
const WIN_GOALS = 7;
const Hockey = {
  enter() {
    const cy = (RINK.y0 + RINK.y1) / 2;
    this.m = [0, 1].map((i) => ({ i, x: i ? 1300 : 300, y: cy, vx: 0, vy: 0, tx: i ? 1300 : 300, ty: cy }));
    this.score = [0, 0]; this.state = 'intro'; this.it = 1.8; this.goalT = 0; this.scorer = -1; this.trail = [];
    this.resetPuck(Math.random() < 0.5 ? 0 : 1); this.endT = 0;
    inp[0].x = 0.2; inp[1].x = 0.8; inp[0].y = inp[1].y = 0.5;
  },
  resetPuck(toward) { const cy = (RINK.y0 + RINK.y1) / 2; this.p = { x: toward === 0 ? 640 : 960, y: cy, vx: 0, vy: 0 }; },
  half(i) { const cx = (RINK.x0 + RINK.x1) / 2, r = RINK.mr; return i === 0 ? [RINK.x0 + r, cx - r] : [cx + r, RINK.x1 - r]; },
  ai(m) {
    const p = this.p, [mn, mx] = this.half(m.i), home = m.i === 0 ? RINK.x0 + 90 : RINK.x1 - 90, mine = m.i === 0 ? p.x < 800 : p.x > 800;
    const towardMe = m.i === 0 ? p.vx < 50 : p.vx > -50;
    if (mine && towardMe) { m.tx = p.x - (m.i === 0 ? 40 : -40); m.ty = p.y + (p.y > m.y ? 8 : -8); }
    else if (mine) { m.tx = p.x - (m.i === 0 ? 30 : -30); m.ty = p.y; }
    else { m.tx = home + (m.i === 0 ? 60 : -60); m.ty = lerp((RINK.y0 + RINK.y1) / 2, p.y, 0.6); }
    m.tx = clamp(m.tx, mn, mx); m.ty = clamp(m.ty, RINK.y0 + RINK.mr, RINK.y1 - RINK.mr);
  },
  update(dt) {
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'play'; SFX.go(); } }
    for (const m of this.m) {
      const [mn, mx] = this.half(m.i);
      if (isBot(m.i)) this.ai(m);
      else { const k = inp[m.i]; m.tx = lerp(mn, mx, k.x); m.ty = lerp(RINK.y0 + RINK.mr, RINK.y1 - RINK.mr, k.y); }
      const dx = m.tx - m.x, dy = m.ty - m.y, dist = Math.hypot(dx, dy), maxS = isBot(m.i) ? 950 : 2200, step = Math.min(dist, maxS * dt);
      const ox = m.x, oy = m.y;
      if (dist > 0.01) { m.x += dx / dist * step; m.y += dy / dist * step; }
      m.x = clamp(m.x, mn, mx); m.y = clamp(m.y, RINK.y0 + RINK.mr, RINK.y1 - RINK.mr);
      m.vx = (m.x - ox) / dt; m.vy = (m.y - oy) / dt;
    }
    if (this.state === 'goal') {
      this.goalT -= dt;
      if (this.goalT <= 0) {
        if (this.score[this.scorer] >= WIN_GOALS) { this.state = 'over'; this.endT = 0; }
        else { this.resetPuck(1 - this.scorer); this.state = 'play'; }
      }
      return;
    }
    if (this.state === 'over') {
      this.endT += dt;
      if (this.endT > 1.2) { const w = this.score[0] > this.score[1] ? 0 : 1; showResults(w, `${this.score[Math.max(0, w)]} : ${this.score[1 - w]}`, 'hockey'); }
      return;
    }
    if (this.state !== 'play') return;
    const p = this.p, R = RINK, pr = R.pr;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const f = 1 - 0.22 * dt; p.vx *= f; p.vy *= f;
    const sp = Math.hypot(p.vx, p.vy), MAXP = 1900; if (sp > MAXP) { p.vx *= MAXP / sp; p.vy *= MAXP / sp; }
    if (this.walls(sp)) return;
    for (const m of this.m) {
      const dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy), minD = pr + R.mr;
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        p.x = m.x + nx * minD; p.y = m.y + ny * minD;
        const rvx = p.vx - m.vx, rvy = p.vy - m.vy, vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          p.vx -= 1.85 * vn * nx; p.vy -= 1.85 * vn * ny;
          const hit = Math.abs(vn);
          if (hit > 200) { SFX.puck(); burst(p.x - nx * pr, p.y - ny * pr, PC[m.i], Math.min(16, hit / 80), 220, 4, 0.3); if (hit > 900) { G.shake = Math.max(G.shake, 5); toPlayer(m.i, 'vibe', 25); } }
        }
      }
    }
    if (this.walls(0)) return;
    const near = (Math.min(p.x - R.x0, R.x1 - p.x) < 90) && (Math.min(p.y - R.y0, R.y1 - p.y) < 90);
    const slow = Math.hypot(p.vx, p.vy) < 250;
    this.stuck = (near || slow) && Math.hypot(p.vx, p.vy) < 250 ? (this.stuck || 0) + dt : 0;
    if (this.stuck > (near ? 1.2 : 4)) { const a = Math.atan2((R.y0 + R.y1) / 2 - p.y, 800 - p.x); p.vx = Math.cos(a) * 450; p.vy = Math.sin(a) * 450; this.stuck = 0; }
    this.trail.push([p.x, p.y]); if (this.trail.length > 14) this.trail.shift();
  },
  walls(sp) {
    const p = this.p, R = RINK, pr = R.pr;
    if (p.y < R.y0 + pr) { p.y = R.y0 + pr; p.vy = Math.abs(p.vy) * 0.92; if (sp > 120) SFX.wall(); }
    if (p.y > R.y1 - pr) { p.y = R.y1 - pr; p.vy = -Math.abs(p.vy) * 0.92; if (sp > 120) SFX.wall(); }
    const inMouth = p.y > R.gy0 + 4 && p.y < R.gy1 - 4;
    if (p.x < R.x0 + pr && !inMouth) { p.x = R.x0 + pr; p.vx = Math.abs(p.vx) * 0.92; if (sp > 120) SFX.wall(); }
    if (p.x > R.x1 - pr && !inMouth) { p.x = R.x1 - pr; p.vx = -Math.abs(p.vx) * 0.92; if (sp > 120) SFX.wall(); }
    if (p.x < R.x0 - pr) { this.goal(1); return true; }
    if (p.x > R.x1 + pr) { this.goal(0); return true; }
    return false;
  },
  goal(scorer) {
    this.score[scorer]++; this.scorer = scorer; this.state = 'goal'; this.goalT = 1.6; this.trail = [];
    SFX.goal(); G.shake = 14; burst(scorer === 0 ? RINK.x1 : RINK.x0, (RINK.gy0 + RINK.gy1) / 2, PC[scorer], 50, 600, 8, 1);
    toPlayer(scorer, 'vibe', [80, 50, 80]); toPlayer(1 - scorer, 'vibe', 250);
    this.p.vx = this.p.vy = 0; this.p.x = -999;
  },
  draw() {
    bgGrad('#0f1330', '#05060f');
    const R = RINK, cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
    // מסגרת ושולחן
    rr(R.x0 - 26, R.y0 - 26, R.x1 - R.x0 + 52, R.y1 - R.y0 + 52, 60); ctx.fillStyle = '#23284d'; ctx.fill();
    rr(R.x0 - 26, R.y0 - 26, R.x1 - R.x0 + 52, R.y1 - R.y0 + 52, 60); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
    const ice = ctx.createRadialGradient(cx, cy, 50, cx, cy, 800); ice.addColorStop(0, '#f4fbff'); ice.addColorStop(1, '#cfe3f5');
    rr(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 40); ctx.fillStyle = ice; ctx.fill();
    // סימונים
    ctx.save(); rr(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 40); ctx.clip();
    ctx.fillStyle = 'rgba(255,77,109,.06)'; ctx.fillRect(R.x0, R.y0, cx - R.x0, R.y1 - R.y0);
    ctx.fillStyle = 'rgba(46,197,255,.07)'; ctx.fillRect(cx, R.y0, R.x1 - cx, R.y1 - R.y0);
    ctx.strokeStyle = 'rgba(30,40,90,.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(cx, R.y0); ctx.lineTo(cx, R.y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 120, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(30,40,90,.35)'; ctx.fill();
    for (const [x, i] of [[R.x0, 0], [R.x1, 1]]) { ctx.strokeStyle = PC[i]; ctx.globalAlpha = 0.45; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, cy, 150, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    // נקודות אוויר
    ctx.fillStyle = 'rgba(30,40,90,.08)'; for (let x = R.x0 + 40; x < R.x1; x += 40) for (let y = R.y0 + 40; y < R.y1; y += 40) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore();
    // שערים
    for (const [x, i] of [[R.x0, 0], [R.x1, 1]]) {
      const w = 34; rr(i === 0 ? x - w : x, R.gy0, w, R.gy1 - R.gy0, 10); ctx.fillStyle = '#07081a'; ctx.fill();
      ctx.fillStyle = PC[i]; ctx.fillRect(x - 5, R.gy0 - 12, 10, 16); ctx.fillRect(x - 5, R.gy1 - 4, 10, 16);
    }
    // שובל ודיסקית
    const p = this.p;
    this.trail.forEach(([x, y], k) => { ctx.globalAlpha = (k / this.trail.length) * 0.25; ctx.beginPath(); ctx.arc(x, y, R.pr * (0.4 + 0.6 * k / this.trail.length), 0, Math.PI * 2); ctx.fillStyle = '#1b1f3b'; ctx.fill(); });
    ctx.globalAlpha = 1;
    if (p.x > -100) {
      ctx.beginPath(); ctx.arc(p.x + 4, p.y + 6, R.pr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,30,.2)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, R.pr, 0, Math.PI * 2); ctx.fillStyle = '#1b1f3b'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, R.pr * 0.62, 0, Math.PI * 2); ctx.strokeStyle = '#3a4070'; ctx.lineWidth = 3; ctx.stroke();
    }
    // מחבטים
    for (const m of this.m) {
      ctx.beginPath(); ctx.arc(m.x + 5, m.y + 8, R.mr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,30,.22)'; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y, R.mr, 0, Math.PI * 2); ctx.fillStyle = PC_DARK[m.i]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y - 3, R.mr - 5, 0, Math.PI * 2); ctx.fillStyle = PC[m.i]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y - 6, R.mr * 0.45, 0, Math.PI * 2); ctx.fillStyle = PC_DARK[m.i]; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x - 4, m.y - 10, R.mr * 0.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
    }
    drawFx();
    // ניקוד
    panel(cx - 170, 18, 340, 70, 35, 'rgba(10,12,30,.85)', 'rgba(255,255,255,.15)');
    txt(String(this.score[0]), cx - 60, 55, 50, PC[0], 'center', 900);
    txt(':', cx, 52, 44, '#fff', 'center', 900);
    txt(String(this.score[1]), cx + 60, 55, 50, PC[1], 'center', 900);
    txt(pname(0), cx - 200, 55, 26, PC[0], 'right', 800);
    txt(pname(1), cx + 200, 55, 26, PC[1], 'left', 800);
    if (this.state === 'intro') { txt('הוקי אוויר', cx, cy - 40, 120, '#1b1f3b', 'center', 900); txt(`גררו את האצבע על הטלפון · ראשון ל־${WIN_GOALS} גולים`, cx, cy + 60, 34, '#3a4070', 'center', 700); }
    if (this.state === 'goal') { const k = 1 + Math.max(0, this.goalT - 1.3) * 2; txt('גול!', cx, cy, 200 * k, PC[this.scorer], 'center', 900, 16); }
    codeBadge();
  },
};

// ============================================================
//  עזרים משותפים למשחקי סבבים
// ============================================================
function scoreTop(score, extra) {
  const cx = VW / 2;
  panel(cx - 170, 18, 340, 70, 35, 'rgba(10,12,30,.85)', 'rgba(255,255,255,.15)');
  txt(String(score[0]), cx - 60, 55, 50, PC[0], 'center', 900);
  txt(':', cx, 52, 44, '#fff', 'center', 900);
  txt(String(score[1]), cx + 60, 55, 50, PC[1], 'center', 900);
  txt(pname(0), cx - 200, 55, 26, PC[0], 'right', 800, 5);
  txt(pname(1), cx + 200, 55, 26, PC[1], 'left', 800, 5);
  if (extra) txt(extra, cx, 104, 18, '#e3e6ff', 'center', 700, 5);
}
function banner(title, sub, col = '#fff', size = 130) {
  txt(title, VW / 2, VH / 2 - 30, size, col, 'center', 900, 14);
  if (sub) txt(sub, VW / 2, VH / 2 + 70, 30, '#fff', 'center', 700, 8);
}
// מהלך סבבים: intro → play → roundEnd → (סבב הבא | תוצאות)
function rounds(sc, dt, target, game) {
  if (sc.state === 'intro') { sc.it -= dt; if (sc.it <= 0) { sc.state = 'play'; SFX.go(); if (sc.onPlay) sc.onPlay(); } }
  else if (sc.state === 'roundEnd') {
    sc.rt -= dt;
    if (sc.rt <= 0) {
      if (Math.max(sc.score[0], sc.score[1]) >= target) { const w = sc.score[0] > sc.score[1] ? 0 : 1; showResults(w, `${sc.score[w]} : ${sc.score[1 - w]} בסיבובים`, game); }
      else { sc.round++; sc.reset(); sc.state = 'intro'; sc.it = 1.5; }
    }
  }
}
function endRound(sc, winner, msg) {
  if (sc.state !== 'play') return;
  sc.state = 'roundEnd'; sc.rt = 2.4; sc.roundWinner = winner; sc.roundMsg = msg || '';
  if (winner >= 0) { sc.score[winner]++; toPlayer(winner, 'vibe', [80, 40, 80]); SFX.goal(); }
  else tone(260, 0.5, 'triangle', 0.08);
}
function roundOverlay(sc, title, sub) {
  if (sc.state === 'intro') {
    if (sc.round === 1) banner(title, sub, '#fff', 120);
    else banner(`סיבוב ${sc.round}`, '', '#fff', 120);
  } else if (sc.state === 'roundEnd') {
    if (sc.roundWinner >= 0) banner(`${pname(sc.roundWinner)} לוקח/ת את הסיבוב!`, sc.roundMsg, PC[sc.roundWinner], 76);
    else banner('תיקו בסיבוב!', sc.roundMsg, '#fff', 90);
  }
}
function circRect(cx, cy, r, R) {
  const nx = clamp(cx, R[0], R[0] + R[2]), ny = clamp(cy, R[1], R[1] + R[3]);
  const dx = cx - nx, dy = cy - ny, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 < 1e-6) {
    const l = cx - R[0], rt = R[0] + R[2] - cx, t = cy - R[1], b = R[1] + R[3] - cy, m = Math.min(l, rt, t, b);
    if (m === l) return [-(l + r), 0]; if (m === rt) return [rt + r, 0]; if (m === t) return [0, -(t + r)]; return [0, b + r];
  }
  const d = Math.sqrt(d2), k = (r - d) / d;
  return [dx * k, dy * k];
}
const stickOf = (i) => [inp[i].jx || 0, inp[i].jy || 0];

// ============================================================
//  משחק 4: טנקים
// ============================================================
const TA = { x0: 60, y0: 126, x1: 1540, y1: 858 };
const TWALLS = [[740, 432, 120, 120], [420, 222, 50, 180], [420, 582, 50, 180], [1130, 222, 50, 180], [1130, 582, 50, 180], [620, 242, 360, 40], [620, 702, 360, 40]];
const TANK_R = 28, TANK_HP = 3, TANK_WIN = 3;
function clearLine(x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 18);
  for (let k = 1; k < n; k++) {
    const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n;
    for (const w of TWALLS) if (x > w[0] - 6 && x < w[0] + w[2] + 6 && y > w[1] - 6 && y < w[1] + w[3] + 6) return false;
  }
  return true;
}
const Tanks = {
  enter() { this.score = [0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 2.8; },
  reset() {
    this.t = [0, 1].map((i) => ({ i, x: i ? 1440 : 160, y: 492, a: i ? Math.PI : 0, hp: TANK_HP, cd: 0, inv: 0, fire: false, dead: false, recoil: 0, ai: { t: 0, sx: 0, sy: 0, aimT: 0 } }));
    this.bullets = []; this.wreck = [];
  },
  onInput(slot, d) { if (d.t === 'act' && this.t[slot]) this.t[slot].fire = true; },
  ai(me, o, dt) {
    const A = me.ai; A.t -= dt; A.aimT -= dt;
    const dx = o.x - me.x, dy = o.y - me.y, d = Math.hypot(dx, dy) || 1;
    const los = clearLine(me.x, me.y, o.x, o.y);
    if (A.t <= 0) { A.t = rnd(0.5, 1.3); const s = Math.random() < 0.5 ? 1 : -1; A.sx = -dy / d * s; A.sy = dx / d * s; }
    let mx, my;
    if (!los) { mx = dx / d + A.sx * 0.7; my = dy / d + A.sy * 0.7; }
    else if (d > 620) { mx = dx / d; my = dy / d; }
    else if (d < 260) { mx = -dx / d + A.sx; my = -dy / d + A.sy; }
    else { mx = A.sx; my = A.sy; }
    for (const b of this.bullets) {
      if (b.o === me.i && b.bn === 0) continue;
      const bx = me.x - b.x, by = me.y - b.y, bd = Math.hypot(bx, by);
      if (bd < 240 && b.vx * bx + b.vy * by > 0) { const sp = Math.hypot(b.vx, b.vy); mx += -b.vy / sp * 1.3; my += b.vx / sp * 1.3; }
    }
    if (los && d < 950 && me.cd <= 0 && o.inv <= 0) {
      if (A.aimT <= 0 && Math.random() < dt * 2.6) A.aimT = 0.45;
      if (A.aimT > 0) {
        const want = Math.atan2(dy, dx); mx = Math.cos(want) * 0.25; my = Math.sin(want) * 0.25;
        if (Math.abs(wrapAng(want - me.a)) < 0.1) { me.fire = true; A.aimT = 0; }
      }
    }
    const m = Math.hypot(mx, my); return m > 1 ? [mx / m, my / m] : [mx, my];
  },
  shoot(me) {
    if (me.cd > 0 || this.bullets.filter((b) => b.o === me.i).length >= 3) return;
    const bx = me.x + Math.cos(me.a) * 44, by = me.y + Math.sin(me.a) * 44;
    if (TWALLS.some((w) => bx > w[0] && bx < w[0] + w[2] && by > w[1] && by < w[1] + w[3])) return;
    me.cd = 0.38; me.recoil = 0.12;
    this.bullets.push({ x: bx, y: by, vx: Math.cos(me.a) * 760, vy: Math.sin(me.a) * 760, o: me.i, bn: 0, life: 3.6, trail: [] });
    tone(170, 0.12, 'square', 0.06, -90); burst(bx, by, '#ffd166', 6, 160, 4, 0.25);
  },
  hit(me, b) {
    me.hp--; me.inv = 0.9; G.shake = Math.max(G.shake, 10); SFX.bighit();
    burst(me.x, me.y, '#ffb703', 18, 380, 6, 0.5); burst(me.x, me.y, PC[me.i], 10, 260, 5, 0.4);
    toPlayer(me.i, 'vibe', 120);
    floatText(b.o === me.i ? 'פגעת בעצמך!' : '-1', me.x, me.y - 60, '#fff', 32);
    if (me.hp <= 0) { me.dead = true; burst(me.x, me.y, '#ff6b35', 50, 600, 9, 1); burst(me.x, me.y, '#333', 26, 300, 10, 1.2); G.shake = 22; this.wreck.push([me.x, me.y]); }
  },
  update(dt) {
    rounds(this, dt, TANK_WIN, 'tanks');
    const playing = this.state === 'play';
    for (const me of this.t) {
      const o = this.t[1 - me.i];
      me.cd = Math.max(0, me.cd - dt); me.inv = Math.max(0, me.inv - dt); me.recoil = Math.max(0, me.recoil - dt);
      if (me.dead) continue;
      let jx = 0, jy = 0;
      if (playing) { if (isBot(me.i)) [jx, jy] = this.ai(me, o, dt); else [jx, jy] = stickOf(me.i); }
      const m = Math.min(1, Math.hypot(jx, jy));
      if (m > 0.15) {
        const want = Math.atan2(jy, jx), diff = wrapAng(want - me.a);
        me.a += clamp(diff, -9 * dt, 9 * dt);
        const sp = 290 * m; me.x += Math.cos(want) * sp * dt; me.y += Math.sin(want) * sp * dt;
        if (Math.random() < 0.25) parts.push({ x: me.x - Math.cos(me.a) * 28, y: me.y - Math.sin(me.a) * 28, vx: 0, vy: 0, life: 0.6, max: 0.6, col: 'rgba(30,25,15,.35)', size: 5, g: 0 });
      }
      me.x = clamp(me.x, TA.x0 + TANK_R, TA.x1 - TANK_R); me.y = clamp(me.y, TA.y0 + TANK_R, TA.y1 - TANK_R);
      for (const w of TWALLS) { const p = circRect(me.x, me.y, TANK_R, w); if (p) { me.x += p[0]; me.y += p[1]; } }
      if (me.fire) { me.fire = false; if (playing) this.shoot(me); }
    }
    const [A, B] = this.t;
    if (!A.dead && !B.dead) {
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), md = TANK_R * 2;
      if (d < md && d > 0.01) { const k = (md - d) / 2 / d; A.x -= dx * k; A.y -= dy * k; B.x += dx * k; B.y += dy * k; }
    }
    for (let k = this.bullets.length - 1; k >= 0; k--) {
      const b = this.bullets[k]; b.life -= dt;
      const px = b.x, py = b.y; b.x += b.vx * dt; b.y += b.vy * dt;
      let hitW = false;
      if (b.x < TA.x0) { b.x = TA.x0; b.vx = Math.abs(b.vx); hitW = true; }
      if (b.x > TA.x1) { b.x = TA.x1; b.vx = -Math.abs(b.vx); hitW = true; }
      if (b.y < TA.y0) { b.y = TA.y0; b.vy = Math.abs(b.vy); hitW = true; }
      if (b.y > TA.y1) { b.y = TA.y1; b.vy = -Math.abs(b.vy); hitW = true; }
      for (const w of TWALLS) if (b.x > w[0] && b.x < w[0] + w[2] && b.y > w[1] && b.y < w[1] + w[3]) {
        if (px <= w[0] || px >= w[0] + w[2]) { b.vx = -b.vx; b.x = px; } else { b.vy = -b.vy; b.y = py; }
        hitW = true;
      }
      if (hitW) { b.bn++; SFX.wall(); burst(b.x, b.y, '#ffe8a3', 4, 120, 3, 0.2); }
      if (b.bn > 2 || b.life <= 0) { this.bullets.splice(k, 1); continue; }
      b.trail.push([b.x, b.y]); if (b.trail.length > 7) b.trail.shift();
      if (!playing) continue;
      for (const me of this.t) {
        if (me.dead || me.inv > 0 || (me.i === b.o && b.bn === 0)) continue;
        if (Math.hypot(me.x - b.x, me.y - b.y) < TANK_R + 5) { this.bullets.splice(k, 1); this.hit(me, b); break; }
      }
    }
    if (playing) {
      const alive = this.t.filter((x) => !x.dead);
      if (alive.length < 2) endRound(this, alive.length ? alive[0].i : -1, alive.length ? '' : 'שני הטנקים הושמדו!');
    }
  },
  draw() {
    ctx.fillStyle = '#23261d'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#4b5341'; ctx.fillRect(TA.x0, TA.y0, TA.x1 - TA.x0, TA.y1 - TA.y0);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2;
    for (let x = TA.x0; x <= TA.x1; x += 74) { ctx.beginPath(); ctx.moveTo(x, TA.y0); ctx.lineTo(x, TA.y1); ctx.stroke(); }
    for (let y = TA.y0; y <= TA.y1; y += 74) { ctx.beginPath(); ctx.moveTo(TA.x0, y); ctx.lineTo(TA.x1, y); ctx.stroke(); }
    for (const [x, y] of this.wreck) { const g = ctx.createRadialGradient(x, y, 5, x, y, 70); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - 70, y - 70, 140, 140); }
    ctx.lineWidth = 10; ctx.strokeStyle = '#15170f'; ctx.strokeRect(TA.x0 - 5, TA.y0 - 5, TA.x1 - TA.x0 + 10, TA.y1 - TA.y0 + 10);
    for (const w of TWALLS) {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(w[0] + 6, w[1] + 8, w[2], w[3]);
      ctx.fillStyle = '#8b917a'; ctx.fillRect(w[0], w[1], w[2], w[3]);
      ctx.fillStyle = '#a7ad94'; ctx.fillRect(w[0], w[1], w[2], 7);
      ctx.strokeStyle = '#5b6050'; ctx.lineWidth = 3; ctx.strokeRect(w[0], w[1], w[2], w[3]);
      ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 2;
      for (let s = 20; s < w[2] + w[3]; s += 22) { ctx.beginPath(); ctx.moveTo(w[0] + Math.min(s, w[2]), w[1] + Math.max(0, s - w[2])); ctx.lineTo(w[0] + Math.max(0, s - w[3]), w[1] + Math.min(s, w[3])); ctx.stroke(); }
    }
    for (const b of this.bullets) {
      ctx.strokeStyle = PC[b.o]; ctx.globalAlpha = 0.45; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); b.trail.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, Math.PI * 2); ctx.fillStyle = PC[b.o]; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    }
    for (const me of this.t) if (!me.dead) drawTank(me);
    drawFx();
    scoreTop(this.score, `ראשון ל־${TANK_WIN} סיבובים`);
    roundOverlay(this, 'טנקים', 'ג׳ויסטיק לתנועה · "אש" יורה לכיוון התנועה · הפגזים קופצים מהקירות!');
    codeBadge();
  },
};
function drawTank(me) {
  const blink = me.inv > 0 && Math.floor(me.inv * 12) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;
  ctx.save(); ctx.translate(me.x, me.y); ctx.rotate(me.a);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(-25, -21, 60, 56, 10); ctx.fill();
  ctx.fillStyle = '#1d1f1a'; rr(-32, -30, 64, 15, 5); ctx.fill(); rr(-32, 15, 64, 15, 5); ctx.fill();
  ctx.fillStyle = '#3a3d33'; for (let k = -28; k < 30; k += 9) { ctx.fillRect(k, -28, 3, 11); ctx.fillRect(k, 17, 3, 11); }
  rr(-26, -18, 52, 36, 9); ctx.fillStyle = PC[me.i]; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; rr(-24, -16, 48, 10, 6); ctx.fill();
  const rc = me.recoil * 60;
  ctx.fillStyle = PC_DARK[me.i]; rr(4 - rc, -6, 42, 12, 4); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-3, -3, 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
  for (let k = 0; k < TANK_HP; k++) {
    ctx.beginPath(); ctx.arc(me.x - 20 + k * 20, me.y - 50, 7, 0, Math.PI * 2);
    ctx.fillStyle = k < me.hp ? PC[me.i] : 'rgba(0,0,0,.4)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

// ============================================================
//  משחק 6: כדורגל ראשים
// ============================================================
const SC = { gy: 790, top: 150, bar: 520, gw: 104, hr: 50, br: 28, time: 75 };
const SC_HEADY = SC.gy - SC.hr - 30;
const crowd2 = (() => { const R = seeded(11), a = []; for (let row = 0; row < 5; row++) for (let i = 0; i < 40; i++) a.push([i * 41 + (row % 2) * 20 + R() * 8, 330 + row * 44, 16 + R() * 5, R() * 6, R()]); return a; })();
const Soccer = {
  enter() { this.score = [0, 0]; this.time = SC.time; this.state = 'intro'; this.it = 2.6; this.t = 0; this.kickoff(-1); },
  kickoff(toward) {
    this.pl = [0, 1].map((i) => ({ i, x: i ? 1180 : 420, y: SC_HEADY, vx: 0, vy: 0, dir: i ? -1 : 1, ground: true, kt: 0, kicked: false, jq: false, kq: false }));
    this.b = { x: 800, y: 300, vx: toward === 0 ? -80 : toward === 1 ? 80 : 0, vy: 0, rot: 0 };
  },
  onInput(slot, d) { const p = this.pl[slot]; if (!p) return; if (d.t === 'jump') p.jq = true; if (d.t === 'kick') p.kq = true; },
  foot(p) { const k = p.kt > 0 ? Math.sin((1 - p.kt / 0.26) * Math.PI) : 0; return [p.x + p.dir * (26 + 46 * k), p.y + SC.hr + 12 - 24 * k, k]; },
  ai(p) {
    const b = this.b, dir = p.dir, own = p.i === 0 ? 0 : VW;
    let tx = b.x - dir * 55;
    if ((b.x - p.x) * dir < -10) tx = b.x - dir * 95;
    if (Math.abs(b.x - own) < 380 && b.vx * dir < 0) tx = b.x - dir * 40;
    const dx = tx - p.x;
    if (Math.abs(b.x - p.x) < 160 && b.y < p.y - 30 && b.vy > -300 && p.ground && Math.random() < 0.07) p.jq = true;
    const f = this.foot(p);
    if (Math.hypot(b.x - f[0], b.y - f[1]) < 80 && (b.x - p.x) * dir > 0 && Math.random() < 0.3) p.kq = true;
    return [dx < -18, dx > 18];
  },
  bounce(cx, cy, r, vx, vy, e, head) {
    const b = this.b, dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), md = r + SC.br;
    if (d >= md || d < 0.01) return;
    const nx = dx / d, ny = dy / d; b.x = cx + nx * md; b.y = cy + ny * md;
    const vn = (b.vx - vx) * nx + (b.vy - vy) * ny;
    if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; if (head) { if (Math.abs(vn) > 250) SFX.puck(); if (ny < -0.5) b.vy -= 120; } }
  },
  goal(s) {
    this.score[s]++; this.scorer = s; this.state = 'goal'; this.goalT = 1.9;
    SFX.goal(); G.shake = 14; burst(this.b.x, this.b.y, PC[s], 50, 600, 8, 1);
    toPlayer(s, 'vibe', [80, 50, 80]); toPlayer(1 - s, 'vibe', 250);
  },
  ballStep(dt) {
    const b = this.b, R = SC.br;
    b.vy += 1500 * dt; b.vx *= 1 - 0.12 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vx * dt / R;
    if (b.y > SC.gy - R) { b.y = SC.gy - R; if (b.vy > 0) { if (b.vy > 220) SFX.wall(); b.vy = -b.vy * 0.68; } b.vx *= 0.985; if (Math.abs(b.vy) < 40) b.vy = 0; }
    if (b.y < SC.top + R) { b.y = SC.top + R; b.vy = Math.abs(b.vy) * 0.7; }
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.7; }
    if (b.x > VW - R) { b.x = VW - R; b.vx = -Math.abs(b.vx) * 0.7; }
    for (const bar of [[0, SC.bar, SC.gw, 14], [VW - SC.gw, SC.bar, SC.gw, 14]]) {
      const p = circRect(b.x, b.y, R, bar);
      if (p) { b.x += p[0]; b.y += p[1]; const m = Math.hypot(p[0], p[1]) || 1, nx = p[0] / m, ny = p[1] / m, vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 1.75 * vn * nx; b.vy -= 1.75 * vn * ny; SFX.wall(); } }
    }
    if (b.x < SC.gw - R * 0.3 && b.y > SC.bar + 7) return this.goal(1);
    if (b.x > VW - SC.gw + R * 0.3 && b.y > SC.bar + 7) return this.goal(0);
    for (const p of this.pl) {
      this.bounce(p.x, p.y, SC.hr, p.vx, p.vy, 0.9, true);
      const f = this.foot(p);
      if (p.kt > 0 && !p.kicked && Math.hypot(b.x - f[0], b.y - f[1]) < R + 32) {
        p.kicked = true; b.vx = p.dir * 1150 + p.vx * 0.3; b.vy = -460 - Math.random() * 220;
        SFX.hit(); G.shake = Math.max(G.shake, 5); burst(b.x, b.y, '#fff', 8, 220, 4, 0.3); toPlayer(p.i, 'vibe', 30);
      } else this.bounce(f[0], f[1], 18, p.vx, p.vy, 0.6, false);
    }
    const sp = Math.hypot(b.vx, b.vy); if (sp > 1600) { b.vx *= 1600 / sp; b.vy *= 1600 / sp; }
  },
  update(dt) {
    this.t += dt;
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'play'; tone(1500, 0.35, 'square', 0.05); } }
    else if (this.state === 'play') { this.time -= dt; if (this.time <= 0) { this.time = 0; this.state = 'over'; this.ot = 2.2; tone(1500, 0.9, 'square', 0.05); } }
    else if (this.state === 'goal') { this.goalT -= dt; if (this.goalT <= 0) { this.kickoff(1 - this.scorer); this.state = 'play'; tone(1500, 0.25, 'square', 0.05); } }
    else if (this.state === 'over') { this.ot -= dt; if (this.ot <= 0) { const [a, b] = this.score; showResults(a === b ? -1 : a > b ? 0 : 1, `${Math.max(a, b)} : ${Math.min(a, b)}`, 'soccer'); } return; }
    const live = this.state === 'play';
    for (const p of this.pl) {
      let l = false, r = false;
      if (live) { if (isBot(p.i)) [l, r] = this.ai(p); else { l = inp[p.i].l; r = inp[p.i].r; } }
      else p.jq = p.kq = false;
      p.vx = lerp(p.vx, ((r ? 1 : 0) - (l ? 1 : 0)) * 440, Math.min(1, 14 * dt));
      if (p.jq) { p.jq = false; if (p.ground) { p.vy = -980; p.ground = false; tone(380, 0.09, 'sine', 0.05, 300); } }
      if (p.kq) { p.kq = false; if (p.kt <= 0) { p.kt = 0.26; p.kicked = false; SFX.whoosh(); } }
      p.kt = Math.max(0, p.kt - dt);
      p.vy += 2600 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y >= SC_HEADY) { p.y = SC_HEADY; p.vy = 0; p.ground = true; }
      p.x = clamp(p.x, 60 + SC.hr, VW - 60 - SC.hr);
    }
    const [a, b] = this.pl, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = SC.hr * 2;
    if (d < md && d > 0.01) { const k = (md - d) / 2 / d; a.x -= dx * k; b.x += dx * k; if (dy < -40) { b.y = Math.min(b.y, a.y - md + 4); b.vy = Math.min(b.vy, 0); b.ground = true; } else if (dy > 40) { a.y = Math.min(a.y, b.y - md + 4); a.vy = Math.min(a.vy, 0); a.ground = true; } }
    if (live) this.ballStep(dt);
  },
  drawGoal(left, front) {
    const x0 = left ? 0 : VW - SC.gw, w = SC.gw, postX = left ? SC.gw : VW - SC.gw;
    if (!front) {
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x0, SC.bar, w, SC.gy - SC.bar);
      ctx.save(); ctx.beginPath(); ctx.rect(x0, SC.bar, w, SC.gy - SC.bar); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
      for (let s = -300; s < 400; s += 16) { ctx.beginPath(); ctx.moveTo(x0 + s, SC.bar); ctx.lineTo(x0 + s + 270, SC.gy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x0 + s + 270, SC.bar); ctx.lineTo(x0 + s, SC.gy); ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x0, SC.bar, w, 14);
      ctx.fillRect(postX - 6, SC.bar, 12, SC.gy - SC.bar);
    }
  },
  draw() {
    bgGrad('#0b1633', '#1d3a6b');
    for (const x of [230, 1370]) {
      const g = ctx.createRadialGradient(x, 120, 10, x, 300, 420); g.addColorStop(0, 'rgba(255,255,230,.35)'); g.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 420, 0, 840, 600);
      ctx.fillStyle = '#c9cbd6'; ctx.fillRect(x - 3, 130, 6, 200); rr(x - 50, 104, 100, 30, 6); ctx.fillStyle = '#f7f8ff'; ctx.fill();
    }
    ctx.fillStyle = '#121d42'; ctx.fillRect(0, 320, VW, 250);
    for (const [x, y, r, ph, k] of crowd2) {
      const bob = Math.sin(this.t * (4 + k * 3) + ph) * (this.state === 'goal' ? 10 : 2);
      ctx.fillStyle = k < 0.25 ? PC_DARK[0] : k < 0.5 ? PC_DARK[1] : `rgb(${40 + k * 40},${45 + k * 40},${80 + k * 50})`;
      ctx.beginPath(); ctx.arc(x, y + bob, r, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - r, y + bob + r * 0.6, r * 2, 30);
    }
    ctx.fillStyle = '#0a1330'; ctx.fillRect(0, 556, VW, 50);
    for (let x = 40; x < VW; x += 320) txt('זירה', x + 120, 581, 26, 'rgba(255,255,255,.55)', 'center', 900);
    for (let x = 0; x < VW; x += 100) { ctx.fillStyle = (x / 100) % 2 ? '#2f8f3a' : '#33a043'; ctx.fillRect(x, 606, 100, SC.gy - 606); }
    ctx.fillStyle = '#25762e'; ctx.fillRect(0, SC.gy, VW, VH - SC.gy);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(VW / 2 - 3, 606, 6, SC.gy - 606);
    this.drawGoal(true, false); this.drawGoal(false, false);
    const b = this.b, hk = clamp(1 - (SC.gy - b.y) / 600, 0.25, 1);
    ctx.beginPath(); ctx.ellipse(b.x, SC.gy + 4, 30 * hk, 8 * hk, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
    for (const p of this.pl) drawHead(p, b, this.foot(p));
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
    ctx.beginPath(); ctx.arc(0, 0, SC.br, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#1b1f3b'; polygon(0, 0, 9, 5); ctx.fill();
    for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + j * Math.PI * 2 / 5; polygon(Math.cos(a) * 24, Math.sin(a) * 24, 8, 5, a + Math.PI / 2); ctx.fill(); }
    ctx.restore(); ctx.lineWidth = 2; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, SC.br, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    this.drawGoal(true, true); this.drawGoal(false, true);
    drawFx();
    const s = Math.ceil(this.time);
    scoreTop(this.score, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    if (this.state === 'intro') banner('כדורגל ראשים', '◀ ▶ לזוז · קפיצה לנגיחה · בעיטה כשהכדור ליד הרגל', '#fff', 110);
    if (this.state === 'goal') banner('גול!', `${pname(this.scorer)} הבקיע/ה`, PC[this.scorer], 200);
    if (this.state === 'over') banner('שריקת סיום!', '', '#fff', 110);
    codeBadge();
  },
};
function drawHead(p, b, f) {
  const x = p.x, y = p.y, r = SC.hr, d = p.dir;
  ctx.beginPath(); ctx.ellipse(x, SC.gy + 4, 46, 10, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  rr(x - 28, y + r - 14, 56, 34, 14); ctx.fillStyle = PC[p.i]; ctx.fill();
  ctx.save(); ctx.translate(f[0], f[1]); ctx.rotate(-d * f[2] * 0.6);
  rr(-22, -11, 44, 22, 10); ctx.fillStyle = '#16162a'; ctx.fill();
  ctx.fillStyle = PC[p.i]; ctx.fillRect(-8, -11, 5, 22);
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#e8b48a'; ctx.fill();
  ctx.beginPath(); ctx.arc(x - d * 4, y - 6, r + 1, Math.PI * 1.02, Math.PI * 1.98); ctx.fillStyle = PC_DARK[p.i]; ctx.fill();
  ctx.fillStyle = PC[p.i]; ctx.fillRect(x - r, y - 14, r * 2, 9);
  const ex = x + d * 20, ey = y + 2;
  ctx.beginPath(); ctx.arc(ex, ey, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  const ea = Math.atan2(b.y - ey, b.x - ex);
  ctx.beginPath(); ctx.arc(ex + Math.cos(ea) * 6, ey + Math.sin(ea) * 6, 6, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  ctx.strokeStyle = '#3a2416'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ex - 12, ey - 18 + d * 2); ctx.lineTo(ex + 12, ey - 18 - d * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + d * (r - 4), y + 10, 9, 0, Math.PI * 2); ctx.fillStyle = '#d99c70'; ctx.fill();
  ctx.strokeStyle = '#7a3b2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + d * 18, y + 26, 10, d > 0 ? 0.2 : Math.PI - 1.4, d > 0 ? 1.4 : Math.PI - 0.2); ctx.stroke();
}

// ============================================================
//  משחק 7: סומו
// ============================================================
const SU = { cx: 800, cy: 500, r0: 330, rMin: 200, pr: 46, win: 3 };
const Sumo = {
  enter() { this.score = [0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 2.8; },
  reset() {
    this.R = SU.r0; this.playT = 0; this.outT = 0;
    this.p = [0, 1].map((i) => ({ i, x: SU.cx + (i ? 150 : -150), y: SU.cy, vx: 0, vy: 0, face: i ? Math.PI : 0, dcd: 0, dt: 0, out: false, ft: 0, act: false }));
  },
  onInput(slot, d) { if (d.t === 'act' && this.p[slot]) this.p[slot].act = true; },
  ai(p, o) {
    const dcx = p.x - SU.cx, dcy = p.y - SU.cy, dc = Math.hypot(dcx, dcy) || 1;
    const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 1;
    let mx = dx / d, my = dy / d;
    const ox = o.x - SU.cx, oy = o.y - SU.cy, od = Math.hypot(ox, oy) || 1;
    if (d > 150) { const qx = o.x - ox / od * 80 - p.x, qy = o.y - oy / od * 80 - p.y, q = Math.hypot(qx, qy) || 1; mx = qx / q; my = qy / q; }
    if (dc > this.R - 95) { mx = -dcx / dc; my = -dcy / dc; }
    if (d < 210 && p.dcd <= 0 && dc < this.R - 70 && Math.random() < 0.05) p.act = true;
    return [mx * 0.88, my * 0.88];
  },
  update(dt) {
    rounds(this, dt, SU.win, 'sumo');
    const live = this.state === 'play';
    if (live) { this.playT += dt; if (this.playT > 10) this.R = Math.max(SU.rMin, this.R - dt * 6); }
    for (const p of this.p) {
      p.dcd = Math.max(0, p.dcd - dt); p.dt = Math.max(0, p.dt - dt);
      if (p.out) { p.ft += dt; p.x += p.vx * dt * 0.4; p.y += p.vy * dt * 0.4; continue; }
      let jx = 0, jy = 0;
      if (live) { if (isBot(p.i)) [jx, jy] = this.ai(p, this.p[1 - p.i]); else [jx, jy] = stickOf(p.i); }
      const m = Math.min(1, Math.hypot(jx, jy));
      if (m > 0.12) { const a = Math.atan2(jy, jx); p.vx += Math.cos(a) * m * 1500 * dt; p.vy += Math.sin(a) * m * 1500 * dt; p.face = a; }
      if (p.act) {
        p.act = false;
        if (live && p.dcd <= 0) { const a = m > 0.2 ? Math.atan2(jy, jx) : p.face; p.vx += Math.cos(a) * 900; p.vy += Math.sin(a) * 900; p.dt = 0.28; p.dcd = 1.1; p.face = a; SFX.whoosh(); tone(160, 0.15, 'sawtooth', 0.05, -60); toPlayer(p.i, 'vibe', 25); }
      }
      p.vx *= 1 - 2.4 * dt; p.vy *= 1 - 2.4 * dt;
      const sp = Math.hypot(p.vx, p.vy), mx = p.dt > 0 ? 1300 : 430; if (sp > mx) { p.vx *= mx / sp; p.vy *= mx / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    const [a, b] = this.p;
    if (!a.out && !b.out) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = SU.pr * 2;
      if (d < md && d > 0.01) {
        const nx = dx / d, ny = dy / d, ov = (md - d) / 2; a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          const j = -(1 + 0.85) * vn / 2; a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny;
          if (a.dt > 0) { b.vx += nx * 340; b.vy += ny * 340; }
          if (b.dt > 0) { a.vx -= nx * 340; a.vy -= ny * 340; }
          if (Math.abs(vn) > 200) { SFX.bump(); G.shake = Math.max(G.shake, Math.min(14, Math.abs(vn) / 60)); burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#fff3c4', 10, 260, 5, 0.35); toPlayer(0, 'vibe', 40); toPlayer(1, 'vibe', 40); }
        }
      }
    }
    if (live) {
      for (const p of this.p) if (!p.out && Math.hypot(p.x - SU.cx, p.y - SU.cy) > this.R + 6) { p.out = true; p.ft = 0; SFX.bighit(); burst(p.x, p.y, '#e8d5a3', 30, 400, 7, 0.8); toPlayer(p.i, 'vibe', 300); }
      const out = this.p.filter((p) => p.out);
      if (out.length) { this.outT += dt; if (out.length === 2 || this.outT > 0.15) endRound(this, out.length === 2 ? -1 : 1 - out[0].i, out.length === 2 ? 'שניכם עפתם החוצה!' : 'מחוץ לזירה!'); }
    }
  },
  draw() {
    for (let y = 0; y < VH; y += 60) { ctx.fillStyle = (y / 60) % 2 ? '#432a1a' : '#3b2416'; ctx.fillRect(0, y, VW, 60); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, y, VW, 2); }
    const cx = SU.cx, cy = SU.cy;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(cx - 366, cy - 360, 760, 760);
    ctx.fillStyle = '#c9a46b'; ctx.fillRect(cx - 380, cy - 380, 760, 760);
    ctx.fillStyle = '#b08b52'; ctx.fillRect(cx - 380, cy + 368, 760, 12);
    ctx.beginPath(); ctx.arc(cx, cy, SU.r0 + 34, 0, Math.PI * 2); ctx.fillStyle = '#d9bd85'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, SU.r0, 0, Math.PI * 2); ctx.fillStyle = '#ecdcae'; ctx.fill();
    ctx.lineWidth = 18; ctx.strokeStyle = '#bfa064'; ctx.beginPath(); ctx.arc(cx, cy, SU.r0 + 9, 0, Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.setLineDash([6, 14]); ctx.strokeStyle = '#9f7f43'; ctx.stroke(); ctx.setLineDash([]);
    if (this.R < SU.r0 - 1) {
      ctx.beginPath(); ctx.arc(cx, cy, SU.r0, 0, Math.PI * 2); ctx.arc(cx, cy, this.R, 0, Math.PI * 2, true); ctx.fillStyle = 'rgba(190,40,40,.28)'; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = `rgba(230,50,50,${0.6 + 0.4 * Math.sin(G.t * 10)})`; ctx.beginPath(); ctx.arc(cx, cy, this.R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.fillRect(cx - 94, cy - 40, 8, 80); ctx.fillRect(cx + 86, cy - 40, 8, 80);
    for (const p of this.p) drawSumo(p);
    drawFx();
    scoreTop(this.score, `ראשון ל־${SU.win} סיבובים`);
    roundOverlay(this, 'סומו', 'ג׳ויסטיק לתנועה · "הדיפה" לדחיפה חזקה · הזירה מתכווצת!');
    codeBadge();
  },
};
function drawSumo(p) {
  const s = p.out ? Math.max(0.25, 1 - p.ft * 1.1) : 1;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, s); ctx.rotate(p.face);
  ctx.globalAlpha = p.out ? Math.max(0, 1 - p.ft) : 1;
  ctx.beginPath(); ctx.arc(7, 9, SU.pr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
  if (p.dt > 0) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 4; for (const o of [-24, 0, 24]) { ctx.beginPath(); ctx.moveTo(-58, o); ctx.lineTo(-92, o); ctx.stroke(); } }
  ctx.fillStyle = '#e2ad7d';
  ctx.beginPath(); ctx.arc(16, -42, 16, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(16, 42, 16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, SU.pr, 0, Math.PI * 2); ctx.fillStyle = '#efbd90'; ctx.fill();
  ctx.lineWidth = 12; ctx.strokeStyle = PC[p.i]; ctx.beginPath(); ctx.arc(0, 0, SU.pr - 6, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(20, 0, 20, 0, Math.PI * 2); ctx.fillStyle = '#e5ae82'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(12, 0, 12, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#1b1b1b'; ctx.fill();
  ctx.beginPath(); ctx.arc(3, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore(); ctx.globalAlpha = 1;
  if (!p.out) {
    txt(pname(p.i), p.x, p.y - SU.pr - 20, 18, '#fff', 'center', 800, 4);
    if (p.dcd <= 0) { ctx.beginPath(); ctx.arc(p.x, p.y, SU.pr + 8, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,214,10,.6)'; ctx.stroke(); }
  }
}

// ============================================================
//  משחק: כדורעף
// ============================================================
const VB = { gy: 800, netX: 800, netTop: 548, netW: 18, pr: 64, br: 26, win: 7, top: 110 };
const Volley = {
  enter() { this.score = [0, 0]; this.state = 'intro'; this.it = 2.6; this.t = 0; this.server = Math.random() < 0.5 ? 0 : 1; this.reset(); },
  reset() {
    this.pl = [0, 1].map((i) => ({ i, x: i ? 1200 : 400, y: VB.gy, vx: 0, vy: 0, ground: true, jq: false, kq: false, scd: 0, spikeT: 0 }));
    this.b = { x: this.server ? 1200 : 400, y: 300, vx: 0, vy: 0, rot: 0 };
    this.trail = []; this.spd = 1; this.err = [rnd(-30, 30), rnd(-30, 30)]; this.side = -1;
  },
  onInput(slot, d) { const p = this.pl[slot]; if (!p) return; if (d.t === 'jump') p.jq = true; if (d.t === 'kick') p.kq = true; },
  range(i) { const h = VB.netW / 2; return i === 0 ? [40 + VB.pr, VB.netX - h - VB.pr * 0.6] : [VB.netX + h + VB.pr * 0.6, VW - 40 - VB.pr]; },
  predict() {
    // לאן הכדור ייפול (בגובה ראש השחקן) – בשביל המחשב
    let { x, y, vx, vy } = this.b; const h = VB.gy - VB.pr - VB.br * 0.4;
    for (let k = 0; k < 300; k++) {
      vy += 1000 / 60; x += vx / 60; y += vy / 60;
      if (x < VB.br) { x = VB.br; vx = Math.abs(vx); } if (x > VW - VB.br) { x = VW - VB.br; vx = -Math.abs(vx); }
      if (vy > 0 && y >= h) break;
    }
    return x;
  },
  ai(p) {
    const b = this.b, toNet = p.i === 0 ? 1 : -1, [mn, mx] = this.range(p.i);
    const mine = (x) => (p.i === 0 ? x < VB.netX : x > VB.netX);
    const lx = this.predict();
    let tx = mine(lx) ? lx - toNet * 24 + this.err[p.i] : (p.i ? 1200 : 400);
    tx = clamp(tx, mn, mx);
    const dx = tx - p.x;
    if (mine(b.x) && p.ground && Math.abs(b.x - p.x) < 90 && b.vy > 0 && b.y > VB.gy - 330 && b.y < VB.gy - 170 && Math.abs(b.x - VB.netX) < 330 && Math.random() < 0.5) p.jq = true;
    if (!p.ground && mine(b.x) && Math.hypot(b.x - p.x, b.y - p.y) < VB.pr + VB.br + 60 && b.y < p.y && Math.random() < 0.25) p.kq = true;
    return [dx < -10, dx > 10];
  },
  point(winner) {
    this.score[winner]++; this.scorer = winner; this.server = 1 - winner;
    this.state = 'point'; this.pt = 1.6; SFX.goal(); G.shake = 10;
    burst(this.b.x, VB.gy - 10, '#f5deb3', 30, 400, 7, 0.8); burst(this.b.x, VB.gy - 10, PC[winner], 20, 350, 6, 0.7);
    toPlayer(winner, 'vibe', [80, 40, 80]); toPlayer(1 - winner, 'vibe', 220);
  },
  ballStep(dt) {
    const b = this.b, R = VB.br;
    const side = b.x < VB.netX ? 0 : 1;
    if (side !== this.side) { this.side = side; this.err[side] = rnd(-34, 34) * (Math.random() < 0.15 ? 2.6 : 1); }
    dt *= this.spd;
    b.vy += 1000 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vx * dt / R;
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.9; SFX.wall(); }
    if (b.x > VW - R) { b.x = VW - R; b.vx = -Math.abs(b.vx) * 0.9; SFX.wall(); }
    if (b.y < VB.top + R) { b.y = VB.top + R; b.vy = Math.abs(b.vy) * 0.8; }
    const net = [VB.netX - VB.netW / 2, VB.netTop, VB.netW, VB.gy - VB.netTop];
    const pn = circRect(b.x, b.y, R, net);
    if (pn) {
      b.x += pn[0]; b.y += pn[1];
      const m = Math.hypot(pn[0], pn[1]) || 1, nx = pn[0] / m, ny = pn[1] / m, vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny; SFX.wall(); }
      if (ny < -0.5) { b.vx += (b.x < VB.netX ? -1 : 1) * 160; b.vy = Math.min(b.vy, -260); }
    }
    for (const p of this.pl) {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), md = VB.pr + R;
      if (d < md && d > 0.01 && b.y < p.y + 4) {
        const nx = dx / d, ny = dy / d;
        b.x = p.x + nx * md; b.y = p.y + ny * md;
        const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
        if (vn < 0) {
          b.vx -= 1.9 * vn * nx; b.vy -= 1.9 * vn * ny;
          b.vx += p.vx * 0.3; b.vy += Math.min(0, p.vy) * 0.35;
          if (ny < -0.2) b.vy = Math.min(b.vy, -780);
          if (Math.abs(b.vx) < 150) b.vx = (p.i === 0 ? 1 : -1) * 150;
          this.spd = Math.min(1.55, this.spd + 0.035);
          SFX.puck(); burst(b.x - nx * R, b.y - ny * R, PC[p.i], 6, 180, 4, 0.25); toPlayer(p.i, 'vibe', 15);
        }
      }
      if (p.kq) {
        p.kq = false;
        const near = Math.hypot(b.x - p.x, b.y - p.y) < VB.pr + R + 75;
        if (p.scd <= 0 && !p.ground && near && b.y < p.y) {
          const toNet = p.i === 0 ? 1 : -1;
          b.vx = toNet * 1050; b.vy = b.y > VB.netTop - 70 ? -260 : 320;
          p.scd = 0.8; p.spikeT = 0.25;
          SFX.hit(); G.shake = Math.max(G.shake, 8); burst(b.x, b.y, '#fff', 14, 320, 5, 0.35); floatText('הנחתה!', b.x, b.y - 50, GOLD, 34);
          toPlayer(p.i, 'vibe', 40);
        }
      }
    }
    const sp = Math.hypot(b.vx, b.vy); if (sp > 1450) { b.vx *= 1450 / sp; b.vy *= 1450 / sp; }
    this.trail.push([b.x, b.y]); if (this.trail.length > 10) this.trail.shift();
    if (b.y >= VB.gy - R) { b.y = VB.gy - R; this.point(b.x < VB.netX ? 1 : 0); }
  },
  update(dt) {
    this.t += dt;
    if (this.state === 'intro') { this.it -= dt; if (this.it <= 0) { this.state = 'play'; SFX.go(); } }
    else if (this.state === 'point') {
      this.pt -= dt;
      if (this.pt <= 0) {
        if (Math.max(this.score[0], this.score[1]) >= VB.win) { this.state = 'over'; this.ot = 1.2; }
        else { this.reset(); this.state = 'play'; tone(900, 0.15, 'square', 0.05); }
      }
    } else if (this.state === 'over') {
      this.ot -= dt;
      if (this.ot <= 0) { const w = this.score[0] > this.score[1] ? 0 : 1; showResults(w, `${this.score[w]} : ${this.score[1 - w]}`, 'volley'); }
      return;
    }
    const live = this.state === 'play';
    for (const p of this.pl) {
      let l = false, r = false;
      if (live) { if (isBot(p.i)) [l, r] = this.ai(p); else { l = inp[p.i].l; r = inp[p.i].r; } }
      else p.jq = p.kq = false;
      const sp = isBot(p.i) ? 500 : 560;
      p.vx = lerp(p.vx, ((r ? 1 : 0) - (l ? 1 : 0)) * sp, Math.min(1, 14 * dt));
      if (p.jq) { p.jq = false; if (p.ground) { p.vy = -900; p.ground = false; tone(380, 0.09, 'sine', 0.05, 300); } }
      p.scd = Math.max(0, p.scd - dt); p.spikeT = Math.max(0, p.spikeT - dt);
      p.vy += 2400 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y >= VB.gy) { p.y = VB.gy; p.vy = 0; p.ground = true; }
      const [mn, mx] = this.range(p.i); p.x = clamp(p.x, mn, mx);
    }
    if (live) this.ballStep(dt); else p0kq(this);
  },
  draw() {
    const sky = ctx.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, '#3aa0e8'); sky.addColorStop(1, '#bfe8ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, VW, 600);
    ctx.beginPath(); ctx.arc(1330, 210, 80, 0, Math.PI * 2); ctx.fillStyle = '#fff3b0'; ctx.fill();
    for (const [x, y, s] of [[230, 220, 1], [620, 160, 0.8], [1050, 250, 0.7]]) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const [ox, oy, r] of [[0, 0, 40], [44, -12, 50], [92, 0, 40], [46, 14, 44]]) { ctx.beginPath(); ctx.arc(x + ox * s + ((this.t * 8) % VW), y + oy * s, r * s, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#1f7fbf'; ctx.fillRect(0, 560, VW, 80);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < VW; x += 90) ctx.fillRect((x + this.t * 20) % VW, 590 + (x % 3) * 12, 40, 3);
    ctx.fillStyle = '#f1d9a5'; ctx.fillRect(0, 630, VW, VH - 630);
    ctx.fillStyle = '#e6c88a'; for (let k = 0; k < 70; k++) ctx.fillRect((k * 263) % VW, 650 + ((k * 97) % 240), 6, 3);
    ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(0, VB.gy, VW, 4);
    // צל כדור
    const b = this.b, hk = clamp(1 - (VB.gy - b.y) / 700, 0.25, 1);
    ctx.beginPath(); ctx.ellipse(b.x, VB.gy + 4, 30 * hk, 8 * hk, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
    // רשת
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(VB.netX - 6, VB.netTop - 20, 12, VB.gy - VB.netTop + 20);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(VB.netX - VB.netW / 2, VB.netTop, VB.netW, VB.gy - VB.netTop - 60);
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
    for (let y = VB.netTop; y < VB.gy - 60; y += 16) { ctx.beginPath(); ctx.moveTo(VB.netX - VB.netW / 2, y); ctx.lineTo(VB.netX + VB.netW / 2, y); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.fillRect(VB.netX - VB.netW / 2 - 3, VB.netTop - 6, VB.netW + 6, 10);
    // שחקנים
    for (const p of this.pl) drawSlime(p, b);
    // שובל וכדור
    this.trail.forEach(([x, y], k) => { ctx.globalAlpha = (k / this.trail.length) * 0.25; ctx.beginPath(); ctx.arc(x, y, VB.br * (0.4 + 0.6 * k / this.trail.length), 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); });
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
    ctx.beginPath(); ctx.arc(0, 0, VB.br, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.ellipse(-14, 0, 14, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.ellipse(16, -6, 12, 28, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = '#1b1f3b'; ctx.beginPath(); ctx.arc(0, 0, VB.br, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-40, 0, 40, -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(40, 0, 40, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke();
    ctx.restore();
    drawFx();
    scoreTop(this.score, `ראשון ל־${VB.win} נקודות`);
    if (this.state === 'intro') banner('כדורעף', '◀ ▶ לזוז · קפיצה · "הנחתה" באוויר ליד הכדור', '#fff', 120);
    if (this.state === 'point') banner('נקודה!', pname(this.scorer), PC[this.scorer], 150);
    if (this.state === 'over') banner('סוף המשחק!', '', '#fff', 110);
    codeBadge();
  },
};
function p0kq(sc) { for (const p of sc.pl) p.kq = false; }
function drawSlime(p, b) {
  const r = VB.pr;
  ctx.beginPath(); ctx.ellipse(p.x, VB.gy + 4, r * 0.95, 12, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill();
  ctx.beginPath(); ctx.arc(p.x, p.y, r, Math.PI, 0); ctx.closePath(); ctx.fillStyle = PC_DARK[p.i]; ctx.fill();
  ctx.beginPath(); ctx.arc(p.x, p.y - 4, r - 5, Math.PI, 0); ctx.closePath(); ctx.fillStyle = PC[p.i]; ctx.fill();
  ctx.beginPath(); ctx.ellipse(p.x - r * 0.35, p.y - r * 0.6, r * 0.22, r * 0.1, -0.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
  const d = p.i === 0 ? 1 : -1, ex = p.x + d * r * 0.42, ey = p.y - r * 0.55;
  ctx.beginPath(); ctx.arc(ex, ey, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  const a = Math.atan2(b.y - ey, b.x - ex);
  ctx.beginPath(); ctx.arc(ex + Math.cos(a) * 6, ey + Math.sin(a) * 6, 6, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  if (p.spikeT > 0) { ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 10, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  txt(pname(p.i), p.x, VB.gy + 40, 22, PC_DARK[p.i], 'center', 800);
}

// ============================================================
//  משחק: פצצה חמה
// ============================================================
const BM = { x0: 80, y0: 140, x1: 1520, y1: 860, r: 34, win: 3 };
const PILLARS = [[560, 360, 46], [1040, 360, 46], [560, 640, 46], [1040, 640, 46]];
const Bomb = {
  enter() { this.score = [0, 0]; this.round = 1; this.reset(); this.state = 'intro'; this.it = 2.8; },
  reset() {
    this.p = [0, 1].map((i) => ({ i, x: i ? 1300 : 300, y: 500, vx: 0, vy: 0, face: i ? Math.PI : 0, dcd: 0, dt: 0, ddx: 0, ddy: 0, stun: 0, act: false, ai: { t: 0, sx: 0, sy: 0 } }));
    this.holder = Math.random() < 0.5 ? 0 : 1; this.fuse0 = rnd(13, 19); this.fuse = this.fuse0;
    this.passCd = 0; this.beepT = 0; this.boom = -1; this.scorch = null;
  },
  onInput(slot, d) { if (d.t === 'act' && this.p[slot]) this.p[slot].act = true; },
  avoid(me) {
    let ax = 0, ay = 0;
    for (const [px, py, pr] of PILLARS) { const dx = me.x - px, dy = me.y - py, d = Math.hypot(dx, dy) || 1; if (d < pr + 110) { const k = (pr + 110 - d) / 110; ax += dx / d * k * 1.6; ay += dy / d * k * 1.6; } }
    const m = 150;
    if (me.x < BM.x0 + m) ax += (BM.x0 + m - me.x) / m * 1.8; if (me.x > BM.x1 - m) ax -= (me.x - (BM.x1 - m)) / m * 1.8;
    if (me.y < BM.y0 + m) ay += (BM.y0 + m - me.y) / m * 1.8; if (me.y > BM.y1 - m) ay -= (me.y - (BM.y1 - m)) / m * 1.8;
    return [ax, ay];
  },
  ai(me, o, dt) {
    const A = me.ai; A.t -= dt;
    if (A.t <= 0) { A.t = rnd(0.6, 1.4); const s = Math.random() < 0.5 ? 1 : -1; A.sx = s; }
    let mx, my;
    const [ax, ay] = this.avoid(me);
    if (this.holder === me.i) {
      const tx = o.x + o.vx * 0.3, ty = o.y + o.vy * 0.3, dx = tx - me.x, dy = ty - me.y, d = Math.hypot(dx, dy) || 1;
      mx = dx / d + ax * 0.6; my = dy / d + ay * 0.6;
      if (d < 210 && me.dcd <= 0 && this.passCd <= 0 && Math.random() < 0.08) me.act = true;
    } else {
      const dx = me.x - o.x, dy = me.y - o.y, d = Math.hypot(dx, dy) || 1;
      mx = dx / d + (-dy / d) * A.sx * 0.6 + ax; my = dy / d + (dx / d) * A.sx * 0.6 + ay;
      if (d < 170 && me.dcd <= 0 && Math.random() < 0.1) me.act = true;
    }
    const m = Math.hypot(mx, my) || 1; return [mx / m, my / m];
  },
  explode() {
    const h = this.p[this.holder];
    this.boom = this.holder; this.scorch = [h.x, h.y];
    burst(h.x, h.y, '#ff6b35', 70, 750, 10, 1.1); burst(h.x, h.y, '#ffd60a', 40, 500, 8, 0.9); burst(h.x, h.y, '#333', 30, 350, 12, 1.4);
    G.shake = 26; noise(0.6, 0.6, 500); tone(70, 0.6, 'sine', 0.35, -40); toPlayer(this.holder, 'vibe', [400, 100, 400]);
    endRound(this, 1 - this.holder, `${pname(this.holder)} נשאר/ה עם הפצצה!`);
  },
  update(dt) {
    rounds(this, dt, BM.win, 'bomb');
    const live = this.state === 'play';
    if (live) {
      this.fuse -= dt; this.passCd = Math.max(0, this.passCd - dt);
      this.beepT -= dt;
      if (this.beepT <= 0) { const k = clamp(this.fuse / this.fuse0, 0, 1); this.beepT = 0.12 + 0.8 * k; tone(700 + (1 - k) * 700, 0.06, 'square', 0.04); }
      if (this.fuse <= 0) { this.explode(); }
    }
    for (const me of this.p) {
      const o = this.p[1 - me.i];
      me.dcd = Math.max(0, me.dcd - dt); me.dt = Math.max(0, me.dt - dt); me.stun = Math.max(0, me.stun - dt);
      if (this.boom === me.i) { me.vx = me.vy = 0; continue; }
      let jx = 0, jy = 0;
      if (live && me.stun <= 0) { if (isBot(me.i)) [jx, jy] = this.ai(me, o, dt); else [jx, jy] = stickOf(me.i); }
      const m = Math.min(1, Math.hypot(jx, jy));
      if (me.act) {
        me.act = false;
        if (live && me.stun <= 0 && me.dcd <= 0) {
          const a = m > 0.2 ? Math.atan2(jy, jx) : me.face;
          me.ddx = Math.cos(a); me.ddy = Math.sin(a); me.dt = 0.22; me.dcd = 1.5; me.face = a;
          SFX.whoosh(); toPlayer(me.i, 'vibe', 20);
        }
      }
      const base = (this.holder === me.i ? 370 : 335) * (isBot(me.i) ? 0.93 : 1);
      let tvx = 0, tvy = 0;
      if (me.dt > 0) { tvx = me.ddx * base * 2.6; tvy = me.ddy * base * 2.6; }
      else if (m > 0.12) { const a = Math.atan2(jy, jx); tvx = Math.cos(a) * base * m; tvy = Math.sin(a) * base * m; me.face = a; }
      const k = Math.min(1, (me.dt > 0 ? 30 : 10) * dt);
      me.vx = lerp(me.vx, tvx, k); me.vy = lerp(me.vy, tvy, k);
      me.x += me.vx * dt; me.y += me.vy * dt;
      me.x = clamp(me.x, BM.x0 + BM.r, BM.x1 - BM.r); me.y = clamp(me.y, BM.y0 + BM.r, BM.y1 - BM.r);
      for (const [px, py, pr] of PILLARS) {
        const dx = me.x - px, dy = me.y - py, d = Math.hypot(dx, dy), md = pr + BM.r;
        if (d < md && d > 0.01) { me.x = px + dx / d * md; me.y = py + dy / d * md; }
      }
      if (live && (Math.abs(me.vx) + Math.abs(me.vy) > 60) && Math.random() < 0.3) parts.push({ x: me.x + rnd(-10, 10), y: me.y + BM.r - 4, vx: 0, vy: -20, life: 0.4, max: 0.4, col: 'rgba(255,255,255,.18)', size: 4, g: 0 });
    }
    const [a, b] = this.p;
    if (this.boom < 0) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = BM.r * 2;
      if (d < md + 4 && live && this.passCd <= 0) {
        const nh = 1 - this.holder, newH = this.p[nh];
        this.holder = nh; this.passCd = 0.9; newH.stun = 0.4;
        SFX.hit(); G.shake = Math.max(G.shake, 7);
        burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffd60a', 16, 320, 5, 0.4);
        floatText('קיבלת פצצה!', newH.x, newH.y - 70, PC[nh], 30);
        toPlayer(nh, 'vibe', [60, 40, 60]); toPlayer(1 - nh, 'vibe', 20);
      }
      if (d < md && d > 0.01) { const k = (md - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
  },
  draw() {
    ctx.fillStyle = '#120f22'; ctx.fillRect(0, 0, VW, VH);
    for (let x = BM.x0; x < BM.x1; x += 80) for (let y = BM.y0; y < BM.y1; y += 80) {
      ctx.fillStyle = ((x - BM.x0) / 80 + (y - BM.y0) / 80) % 2 ? '#2a2347' : '#241e3e'; ctx.fillRect(x, y, 80, 80);
    }
    if (this.scorch) { const [x, y] = this.scorch, g = ctx.createRadialGradient(x, y, 5, x, y, 130); g.addColorStop(0, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - 130, y - 130, 260, 260); }
    ctx.lineWidth = 8; ctx.strokeStyle = '#ff4d6d'; ctx.globalAlpha = 0.5; ctx.strokeRect(BM.x0 - 4, BM.y0 - 4, BM.x1 - BM.x0 + 8, BM.y1 - BM.y0 + 8); ctx.globalAlpha = 1;
    for (const [px, py, pr] of PILLARS) {
      ctx.beginPath(); ctx.ellipse(px + 6, py + 12, pr, pr * 0.9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fillStyle = '#4a4170'; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py - 6, pr - 8, 0, Math.PI * 2); ctx.fillStyle = '#6a5fa0'; ctx.fill();
    }
    for (const me of this.p) if (this.boom !== me.i) drawRunner(me, this.holder === me.i, this.passCd);
    if (this.boom < 0) { const h = this.p[this.holder]; drawBombAt(h.x, h.y - 66, clamp(this.fuse / this.fuse0, 0, 1), G.t); }
    if (this.state === 'play' && this.fuse < 3) { const a = (0.5 + 0.5 * Math.sin(G.t * 18)) * 0.25; ctx.fillStyle = `rgba(255,30,30,${a})`; ctx.fillRect(0, 0, VW, VH); }
    drawFx();
    scoreTop(this.score, `ראשון ל־${BM.win} סיבובים`);
    roundOverlay(this, 'פצצה חמה', 'נגעו ביריב כדי להעביר לו את הפצצה · "ספרינט" לזינוק · מי שנשאר איתה – מתפוצץ!');
    codeBadge();
  },
};
function drawRunner(me, hold, passCd) {
  ctx.beginPath(); ctx.ellipse(me.x + 4, me.y + BM.r - 2, BM.r, 10, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  if (hold) { ctx.beginPath(); ctx.arc(me.x, me.y, BM.r + 10 + Math.sin(G.t * 14) * 3, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#ff5e3a'; ctx.stroke(); }
  if (me.stun > 0) ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(me.x, me.y, BM.r, 0, Math.PI * 2); ctx.fillStyle = PC_DARK[me.i]; ctx.fill();
  ctx.beginPath(); ctx.arc(me.x, me.y - 3, BM.r - 4, 0, Math.PI * 2); ctx.fillStyle = PC[me.i]; ctx.fill();
  const fx = Math.cos(me.face), fy = Math.sin(me.face);
  for (const s of [-1, 1]) {
    const ex = me.x + fx * 14 - fy * 10 * s, ey = me.y - 6 + fy * 10 + fx * 10 * s;
    ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + fx * 3, ey + fy * 3, 4, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (me.dt > 0) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 4; for (const o of [-14, 0, 14]) { ctx.beginPath(); ctx.moveTo(me.x - fx * 40 - fy * o, me.y - fy * 40 + fx * o); ctx.lineTo(me.x - fx * 75 - fy * o, me.y - fy * 75 + fx * o); ctx.stroke(); } }
  txt(pname(me.i), me.x, me.y + BM.r + 22, 18, '#fff', 'center', 800, 4);
}
function drawBombAt(x, y, k, T) {
  const pulse = 1 + (1 - k) * 0.25 * Math.max(0, Math.sin(T * (6 + (1 - k) * 20)));
  ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
  ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fillStyle = k < 0.25 ? '#5a1010' : '#1b1b24'; ctx.fill();
  ctx.beginPath(); ctx.arc(-8, -8, 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
  ctx.fillStyle = '#555'; ctx.fillRect(-6, -30, 12, 9);
  const L = 8 + 26 * k;
  ctx.strokeStyle = '#c9a46b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -30); ctx.quadraticCurveTo(L * 0.5, -30 - L * 0.4, L * 0.7, -30 - L * 0.8); ctx.stroke();
  const sx = L * 0.7, sy = -30 - L * 0.8;
  ctx.fillStyle = '#ffd60a'; star(sx, sy, 10 + Math.random() * 4, 4, 6); ctx.fill();
  ctx.fillStyle = '#ff5e3a'; star(sx, sy, 5, 2, 5); ctx.fill();
  ctx.restore();
}

// ============================================================
//  לולאה ראשית
// ============================================================
let last = performance.now(), acc = 0;
const STEP = 1 / 120;
function frame(t) {
  let dt = Math.min(0.1, (t - last) / 1000); last = t;
  G.t += dt;
  if (G.slowT > 0) { G.slowT -= dt; dt *= 0.3; }
  acc += dt;
  while (acc >= STEP) { if (G.scene) G.scene.update(STEP); updFx(STEP); acc -= STEP; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, cv.width, cv.height);
  const sx = G.shake ? rnd(-G.shake, G.shake) : 0, sy = G.shake ? rnd(-G.shake, G.shake) : 0;
  ctx.setTransform(S, 0, 0, S, OX + sx * S, OY + sy * S);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
  if (G.scene) G.scene.draw();
  if (G.sceneName === 'menu' || G.sceneName === 'results') drawFx();
  if (!AC || AC.state !== 'running') { panel(VW - 330, VH - 50, 310, 36, 18, 'rgba(255,214,10,.15)', GOLD); txt('לחצו על המסך כדי להפעיל סאונד', VW - 175, VH - 32, 17, GOLD, 'center', 700); }
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__zira = { G, inp, startGame, showResults };
})();
